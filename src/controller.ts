import * as path from 'node:path';
import * as vscode from 'vscode';
import { BitbucketProvider } from './core/bitbucketProvider';
import { FileChanges, parseUnifiedDiff } from './core/diff';
import { diffAgainstTarget, getCurrentBranch, getRemoteUrl, getRepoRoot, GitError } from './core/git';
import { GitHubProvider } from './core/githubProvider';
import { parseRemoteUrl } from './core/remoteParse';
import { PrProvider, PullRequest } from './core/types';
import { GutterDecorator } from './decorations';
import { PrStatusBar } from './statusBar';

const BITBUCKET_USERNAME_KEY = 'prGutterHighlight.bitbucket.username';
const BITBUCKET_APP_PASSWORD_KEY = 'prGutterHighlight.bitbucket.appPassword';

export class PrHighlightController implements vscode.Disposable {
  private readonly decorator = new GutterDecorator();
  private readonly statusBar = new PrStatusBar();
  private readonly output: vscode.LogOutputChannel;
  private readonly disposables: vscode.Disposable[] = [];
  private currentPr: PullRequest | undefined;
  private refreshing = false;
  private refreshQueued = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.output = vscode.window.createOutputChannel('PR Gutter Highlight', { log: true });
    this.disposables.push(this.decorator, this.statusBar, this.output);
    this.registerListeners();
  }

  private registerListeners(): void {
    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors(() => this.decorator.applyToVisibleEditors()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh('workspace folders changed')),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('prGutterHighlight.gutterColor')) {
          this.decorator.reloadColors();
        } else if (e.affectsConfiguration('prGutterHighlight')) {
          this.refresh('configuration changed');
        }
      }),
    );

    // Watch .git/HEAD in each workspace folder to detect branch checkouts.
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const pattern = new vscode.RelativePattern(folder, '.git/HEAD');
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      const onHeadChange = () => this.refresh('branch changed (.git/HEAD)');
      watcher.onDidChange(onHeadChange, undefined, this.disposables);
      watcher.onDidCreate(onHeadChange, undefined, this.disposables);
      this.disposables.push(watcher);
    }
  }

  /** Serialized refresh: a call during a running refresh queues exactly one follow-up. */
  async refresh(reason: string): Promise<void> {
    if (this.refreshing) {
      this.refreshQueued = true;
      return;
    }
    this.refreshing = true;
    try {
      this.output.info(`refresh: ${reason}`);
      await this.doRefresh();
    } catch (err) {
      this.output.error(`refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.refreshing = false;
      if (this.refreshQueued) {
        this.refreshQueued = false;
        void this.refresh('queued follow-up');
      }
    }
  }

  private async doRefresh(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('prGutterHighlight');
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
    const changes = await this.computeChanges(repoRoot, remoteName, provider, pr);
    this.output.info(`highlighting ${changes.size} changed file(s)`);
    this.setPr(pr, repoRoot, changes);
  }

  private async computeChanges(
    repoRoot: string,
    remoteName: string,
    provider: PrProvider,
    pr: PullRequest,
  ): Promise<FileChanges> {
    try {
      const diff = await diffAgainstTarget(repoRoot, remoteName, pr.targetBranch);
      return parseUnifiedDiff(diff);
    } catch (err) {
      if (err instanceof GitError) {
        this.output.warn(`local diff unavailable (${err.message}); falling back to provider diff API`);
        const diff = await provider.fetchDiff(pr);
        return parseUnifiedDiff(diff);
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
      this.output.warn('Bitbucket credentials not set — run "PR Highlight: Set Bitbucket Credentials". Trying unauthenticated (public repos only).');
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

  private setPr(pr: PullRequest | undefined, repoRoot: string | undefined, changes: FileChanges): void {
    this.currentPr = pr;
    this.statusBar.setPr(pr);
    this.decorator.setChanges(pr ? repoRoot : undefined, pr ? changes : new Map());
  }

  // ---- commands ----

  async commandSignInGitHub(): Promise<void> {
    const token = await this.getGitHubToken(true);
    if (token) {
      vscode.window.showInformationMessage('PR Gutter Highlight: signed in to GitHub.');
      await this.refresh('GitHub sign-in');
    } else {
      vscode.window.showWarningMessage('PR Gutter Highlight: GitHub sign-in was not completed.');
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
    vscode.window.showInformationMessage('PR Gutter Highlight: Bitbucket credentials saved.');
    await this.refresh('Bitbucket credentials updated');
  }

  async commandOpenPr(): Promise<void> {
    if (this.currentPr) {
      await vscode.env.openExternal(vscode.Uri.parse(this.currentPr.url));
    } else {
      vscode.window.showInformationMessage('PR Gutter Highlight: no active pull request detected.');
    }
  }

  dispose(): void {
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
