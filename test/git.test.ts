import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diffAgainstBase, getFileAtCommit, getMergeBase, GitError } from '../src/core/git';
import { parseUnifiedDiff } from '../src/core/diff';

let repo: string;

function git(...args: string[]): string {
  return execFileSync(
    'git',
    ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args],
    { encoding: 'utf8' },
  ).trim();
}

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-glow-git-test-'));
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'pipe' });
  fs.writeFileSync(path.join(repo, 'a.txt'), 'line1\nline2\nline3\n');
  git('add', '-A');
  git('commit', '-m', 'base');
  // simulate a fetched remote-tracking ref for the PR target branch
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  // feature branch: modify a.txt, add b.txt
  git('checkout', '-b', 'feature');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'line1\nCHANGED\nline3\nline4\n');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'new file\n');
  git('add', '-A');
  git('commit', '-m', 'feature work');
});

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('git helpers (real repo)', () => {
  it('resolves the merge-base against the remote-tracking target ref', async () => {
    const base = await getMergeBase(repo, 'origin', 'main');
    expect(base).toBe(git('rev-parse', 'refs/remotes/origin/main'));
  });

  it('throws GitError when the target ref cannot be resolved', async () => {
    await expect(getMergeBase(repo, 'origin', 'does-not-exist')).rejects.toThrow(GitError);
  });

  it('diffs HEAD against the base and maps to changed lines', async () => {
    const base = await getMergeBase(repo, 'origin', 'main');
    const changes = parseUnifiedDiff(await diffAgainstBase(repo, base));
    expect(changes.get('a.txt')).toEqual([
      { start: 2, end: 2 },
      { start: 4, end: 4 },
    ]);
    expect(changes.get('b.txt')).toEqual([{ start: 1, end: 1 }]);
  });

  it('reads file content at the base commit', async () => {
    const base = await getMergeBase(repo, 'origin', 'main');
    expect(await getFileAtCommit(repo, base, 'a.txt')).toBe('line1\nline2\nline3\n');
  });

  it('returns undefined for files that did not exist at the base commit', async () => {
    const base = await getMergeBase(repo, 'origin', 'main');
    expect(await getFileAtCommit(repo, base, 'b.txt')).toBeUndefined();
  });
});
