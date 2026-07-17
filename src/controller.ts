import * as path from 'node:path';
import * as vscode from 'vscode';
import { BitbucketProvider } from './core/bitbucketProvider';
import { FileChanges, parseUnifiedDiff } from './core/diff';
import {
  diffAgainstBase,
  getCurrentBranch,
  getFileAtCommit,
  getMergeBase,
  getRemoteUrl,
  getRepoRoot,
  GitError,
} from './core/git';
import { GitHubProvider } from './core/githubProvider';
import { parseRemoteUrl } from './core/remoteParse';
import { PrProvider, PullRequest } from './core/types';
import { GutterDecorator } from './decorations';
import { PrStatusBar } from './statusBar';

const BITBUCKET_USERNAME_KEY = 'prGlow.bitbucket.username';
const BITBUCKET_APP_PASSWORD_KEY = 'prGlow.bitbucket.appPassword';

/** URI scheme under which PR-base file contents are served for diffing. */
export const BASE_SCHEME = 'prglow-base';

export class PrHighlightController implements vscode.Disposable {
  private readonly decorator = new GutterDecorator();
  private readonly statusBar = new PrStatusBar();
  private readonly output: vscode.LogOutputChannel;
  private readonly disposables: vscode.Disposable[] = [];
  private currentPr: PullRequest | undefined;
  private lastChangedFileCount = 0;
  private refreshChain: Promise<void> = Promise.resolve();
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private repoRoot: string | undefined;
  private baseCommit: string | undefined;
  private changes: FileChanges = new Map();
  private scm: vscode.SourceControl | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.output = vscode.window.createOutputChannel('PR Glow', { log: true });
    this.disposables.push(this.decorator, this.statusBar, this.output);
    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(BASE_SCHEME, {
        provideTextDocumentContent: async (uri) => {
          const params = new URLSearchParams(uri.query);
          const repo = params.get('repo');
          const commit = params.get('commit');
          const rel = params.get('path');
          if (!repo || !commit || !rel) {
            return '';
          }
          return (await getFileAtCommit(repo, commit, rel)) ?? '';
        },
      }),
    );
    this.registerListeners();
  }

  /**
   * URI serving `uri`'s content at the PR merge-base, or undefined when the
   * file isn't part of the PR diff (or no local base is available). Used both
   * by the quick diff provider (click a gutter mark → inline diff peek, like
   * the built-in git decorations) and by the openFileDiff command.
   */
  private baseUriFor(uri: vscode.Uri): vscode.Uri | undefined {
    if (!this.repoRoot || !this.baseCommit || uri.scheme !== 'file') {
      return undefined;
    }
    const prefix = this.repoRoot.endsWith('/') ? this.repoRoot : `${this.repoRoot}/`;
    if (!uri.fsPath.startsWith(prefix)) {
      return undefined;
    }
    const rel = uri.fsPath.slice(prefix.length);
    if (!this.changes.has(rel)) {
      return undefined;
    }
    const query = new URLSearchParams({ repo: this.repoRoot, commit: this.baseCommit, path: rel });
    return uri.with({ scheme: BASE_SCHEME, query: query.toString() });
  }

  private ensureScm(repoRoot: string): void {
    if (this.scm) {
      return;
    }
    this.scm = vscode.scm.createSourceControl('prGlow', 'PR Glow', vscode.Uri.file(repoRoot));
    this.scm.inputBox.visible = false;
    this.scm.count = 0;
    this.scm.quickDiffProvider = {
      provideOriginalResource: (uri) => this.baseUriFor(uri),
    };
    this.disposables.push(this.scm);
  }

  private registerListeners(): void {
    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors(() => this.decorator.applyToVisibleEditors()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh('workspace folders changed')),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('prGlow.gutterColor')) {
          this.decorator.reloadColors();
        } else if (e.affectsConfiguration('prGlow')) {
          this.refresh('configuration changed');
        }
      }),
    );

    // Watch git state in each workspace folder:
    //  - .git/HEAD changes on branch checkout
    //  - .git/logs/HEAD is appended on every HEAD move (commit, merge, reset,
    //    pull), which .git/HEAD alone misses
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      for (const glob of ['.git/HEAD', '.git/logs/HEAD']) {
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(folder, glob),
        );
        const onGitChange = () => this.scheduleRefresh(`git state changed (${glob})`);
        watcher.onDidChange(onGitChange, undefined, this.disposables);
        watcher.onDidCreate(onGitChange, undefined, this.disposables);
        this.disposables.push(watcher);
      }
    }
  }

  /** Debounced refresh: a checkout or commit touches several git files at once. */
  private scheduleRefresh(reason: string): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh(reason);
    }, 400);
  }

  /** Serialized refresh: runs after any in-flight refresh; the returned promise resolves when THIS refresh has completed. */
  refresh(reason: string): Promise<void> {
    const run = this.refreshChain.then(async () => {
      try {
        this.output.info(`refresh: ${reason}`);
        await this.doRefresh();
      } catch (err) {
        this.output.error(`refresh failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    this.refreshChain = run;
    return run;
  }

  private async doRefresh(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('prGlow');
    if (!cfg.get<boolean>('enabled', true)) {
      this.setPr(undefined, undefined, new Map());
      return;
    }

    const repoRoot = await this.findRepoRoot();
    if (!repoRoot) {
      this.output.info('no git repository in workspace');
      this.setPr(undefined, undefined, new Map());
      return;
    }

    const branch = await getCurrentBranch(repoRoot);
    if (!branch) {
      this.output.info('detached HEAD — skipping');
      this.setPr(undefined, repoRoot, new Map());
      return;
    }

    const remoteName = cfg.get<string>('remoteName', 'origin');
    const remoteUrl = await getRemoteUrl(repoRoot, remoteName);
    if (!remoteUrl) {
      this.output.info(`remote "${remoteName}" not found`);
      this.setPr(undefined, repoRoot, new Map());
      return;
    }

    const enterpriseUrl = cfg.get<string>('githubEnterpriseUrl', '');
    const enterpriseHost = enterpriseUrl ? safeHost(enterpriseUrl) : undefined;
    const parsed = parseRemoteUrl(remoteUrl, enterpriseHost);
    if (!parsed || parsed.kind === 'unknown') {
      this.output.info(`unsupported remote: ${remoteUrl}`);
      this.setPr(undefined, repoRoot, new Map());
      return;
    }

    const provider = await this.buildProvider(parsed.kind, parsed.owner, parsed.repo, enterpriseUrl);
    if (!provider) {
      this.setPr(undefined, repoRoot, new Map());
      return;
    }

    let pr: PullRequest | undefined;
    try {
      pr = await provider.findOpenPr(branch);
    } catch (err) {
      this.output.warn(`PR lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      this.setPr(undefined, repoRoot, new Map());
      return;
    }

    if (!pr) {
      this.output.info(`no open PR for branch "${branch}"`);
      this.setPr(undefined, repoRoot, new Map());
      return;
    }

    this.output.info(`found ${pr.provider} PR #${pr.number} "${pr.title}" (${pr.sourceBranch} → ${pr.targetBranch})`);
    const { changes, baseCommit } = await this.computeChanges(repoRoot, remoteName, provider, pr);
    this.output.info(`highlighting ${changes.size} changed file(s)${baseCommit ? `, quick diff vs ${baseCommit.slice(0, 8)}` : ' (no local base — quick diff unavailable)'}`);
    this.setPr(pr, repoRoot, changes, baseCommit);
  }

  private async computeChanges(
    repoRoot: string,
    remoteName: string,
    provider: PrProvider,
    pr: PullRequest,
  ): Promise<{ changes: FileChanges; baseCommit?: string }> {
    try {
      const baseCommit = await getMergeBase(repoRoot, remoteName, pr.targetBranch);
      const diff = await diffAgainstBase(repoRoot, baseCommit);
      return { changes: parseUnifiedDiff(diff), baseCommit };
    } catch (err) {
      if (err instanceof GitError) {
        this.output.warn(`local diff unavailable (${err.message}); falling back to provider diff API`);
        const diff = await provider.fetchDiff(pr);
        return { changes: parseUnifiedDiff(diff) };
      }
      throw err;
    }
  }

  private async buildProvider(
    kind: 'github' | 'bitbucket',
    owner: string,
    repo: string,
    enterpriseUrl: string,
  ): Promise<PrProvider | undefined> {
    if (kind === 'github') {
      const token = await this.getGitHubToken(false);
      return new GitHubProvider({ owner, repo, token, enterpriseBaseUrl: enterpriseUrl || undefined });
    }
    const username = await this.context.secrets.get(BITBUCKET_USERNAME_KEY);
    const appPassword = await this.context.secrets.get(BITBUCKET_APP_PASSWORD_KEY);
    if (!username || !appPassword) {
      this.output.warn('Bitbucket credentials not set — run "PR Glow: Set Bitbucket Credentials". Trying unauthenticated (public repos only).');
    }
    return new BitbucketProvider({ workspace: owner, repo, username, appPassword });
  }

  private async getGitHubToken(interactive: boolean): Promise<string | undefined> {
    try {
      const session = await vscode.authentication.getSession('github', ['repo'], {
        createIfNone: interactive,
        silent: !interactive ? true : undefined,
      });
      return session?.accessToken;
    } catch {
      return undefined;
    }
  }

  private async findRepoRoot(): Promise<string | undefined> {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (folder.uri.scheme !== 'file') {
        continue;
      }
      const root = await getRepoRoot(folder.uri.fsPath);
      if (root) {
        return path.normalize(root);
      }
    }
    return undefined;
  }

  private setPr(
    pr: PullRequest | undefined,
    repoRoot: string | undefined,
    changes: FileChanges,
    baseCommit?: string,
  ): void {
    this.currentPr = pr;
    this.repoRoot = repoRoot;
    this.changes = pr ? changes : new Map();
    this.baseCommit = pr ? baseCommit : undefined;
    this.lastChangedFileCount = this.changes.size;
    this.statusBar.setPr(pr);
    if (repoRoot) {
      this.ensureScm(repoRoot);
    }
    this.decorator.setChanges(pr ? repoRoot : undefined, this.changes, pr);
  }

  /** State snapshot for integration tests. */
  getStateForTests(): { pr: PullRequest | undefined; changedFileCount: number; quickDiffReady: boolean } {
    return {
      pr: this.currentPr,
      changedFileCount: this.lastChangedFileCount,
      quickDiffReady: this.baseCommit !== undefined,
    };
  }

  // ---- commands ----

  async commandSignInGitHub(): Promise<void> {
    const token = await this.getGitHubToken(true);
    if (token) {
      vscode.window.showInformationMessage('PR Glow: signed in to GitHub.');
      await this.refresh('GitHub sign-in');
    } else {
      vscode.window.showWarningMessage('PR Glow: GitHub sign-in was not completed.');
    }
  }

  async commandSetBitbucketCredentials(): Promise<void> {
    const username = await vscode.window.showInputBox({
      prompt: 'Bitbucket username (from bitbucket.org/account/settings)',
      ignoreFocusOut: true,
    });
    if (username === undefined) {
      return;
    }
    const appPassword = await vscode.window.showInputBox({
      prompt: 'Bitbucket app password / API token (needs "Pull requests: Read" scope)',
      password: true,
      ignoreFocusOut: true,
    });
    if (appPassword === undefined) {
      return;
    }
    await this.context.secrets.store(BITBUCKET_USERNAME_KEY, username);
    await this.context.secrets.store(BITBUCKET_APP_PASSWORD_KEY, appPassword);
    vscode.window.showInformationMessage('PR Glow: Bitbucket credentials saved.');
    await this.refresh('Bitbucket credentials updated');
  }

  async commandOpenFileDiff(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.currentPr) {
      vscode.window.showInformationMessage('PR Glow: no active pull request detected.');
      return;
    }
    const baseUri = this.baseUriFor(editor.document.uri);
    if (!baseUri) {
      vscode.window.showInformationMessage(
        'PR Glow: this file is not part of the PR diff, or the PR base is not available locally.',
      );
      return;
    }
    const name = path.basename(editor.document.uri.fsPath);
    await vscode.commands.executeCommand(
      'vscode.diff',
      baseUri,
      editor.document.uri,
      `${name} (PR #${this.currentPr.number} base ↔ working tree)`,
    );
  }

  async commandOpenPr(): Promise<void> {
    if (this.currentPr) {
      await vscode.env.openExternal(vscode.Uri.parse(this.currentPr.url));
    } else {
      vscode.window.showInformationMessage('PR Glow: no active pull request detected.');
    }
  }

  dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}
