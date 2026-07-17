import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class GitError extends Error {}

async function git(cwd: string, args: string[], timeoutMs = 15000): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return stdout;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new GitError(`git ${args.join(' ')} failed: ${message}`);
  }
}

export async function getRepoRoot(cwd: string): Promise<string | undefined> {
  try {
    return (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  } catch {
    return undefined;
  }
}

export async function getCurrentBranch(repoRoot: string): Promise<string | undefined> {
  const out = (await git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  return out === 'HEAD' ? undefined : out; // detached HEAD
}

export async function getRemoteUrl(repoRoot: string, remote: string): Promise<string | undefined> {
  try {
    return (await git(repoRoot, ['remote', 'get-url', remote])).trim();
  } catch {
    return undefined;
  }
}

/**
 * Resolve the merge-base of HEAD and the PR target branch. Tries the local
 * remote-tracking ref first; if absent, fetches the target branch once, then
 * retries. Throws GitError if no base can be resolved (caller falls back to
 * the provider's diff API).
 */
export async function getMergeBase(
  repoRoot: string,
  remote: string,
  targetBranch: string,
): Promise<string> {
  const ref = `refs/remotes/${remote}/${targetBranch}`;
  let hasRef = await refExists(repoRoot, ref);
  if (!hasRef) {
    try {
      await git(repoRoot, ['fetch', '--no-tags', remote, targetBranch], 30000);
      hasRef = await refExists(repoRoot, ref);
    } catch {
      // offline or auth failure — fall through
    }
  }
  if (!hasRef) {
    throw new GitError(`cannot resolve ${ref}`);
  }
  return (await git(repoRoot, ['merge-base', 'HEAD', ref])).trim();
}

/** Unified diff (zero context) of HEAD against the given merge-base commit. */
export async function diffAgainstBase(repoRoot: string, mergeBase: string): Promise<string> {
  return git(repoRoot, ['diff', '--unified=0', '--no-color', '--no-ext-diff', mergeBase, 'HEAD']);
}

/**
 * Content of a repo-relative file at the given commit. Returns undefined for
 * files that don't exist at that commit (e.g. files the PR added).
 */
export async function getFileAtCommit(
  repoRoot: string,
  commit: string,
  relPath: string,
): Promise<string | undefined> {
  try {
    return await git(repoRoot, ['show', `${commit}:${relPath}`]);
  } catch {
    return undefined;
  }
}

async function refExists(repoRoot: string, ref: string): Promise<boolean> {
  try {
    await git(repoRoot, ['rev-parse', '--verify', '--quiet', ref]);
    return true;
  } catch {
    return false;
  }
}
