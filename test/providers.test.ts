import { describe, expect, it, vi } from 'vitest';
import { BitbucketProvider } from '../src/core/bitbucketProvider';
import { GitHubProvider } from '../src/core/githubProvider';
import { FetchLike } from '../src/core/types';

function mockFetch(handler: (url: string, init?: Parameters<FetchLike>[1]) => { status: number; body: unknown }): FetchLike {
  return vi.fn(async (url: string, init?: Parameters<FetchLike>[1]) => {
    const { status, body } = handler(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  }) as unknown as FetchLike;
}

const GITHUB_PR = {
  number: 42,
  title: 'Add purple gutter',
  html_url: 'https://github.com/octocat/hello-world/pull/42',
  head: { ref: 'feature/gutter' },
  base: { ref: 'main' },
};

describe('GitHubProvider', () => {
  it('finds the open PR for a branch and maps fields', async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url).toBe(
        'https://api.github.com/repos/octocat/hello-world/pulls?state=open&head=octocat%3Afeature%2Fgutter&per_page=10',
      );
      return { status: 200, body: [GITHUB_PR] };
    });
    const provider = new GitHubProvider({ owner: 'octocat', repo: 'hello-world', fetchImpl });
    const pr = await provider.findOpenPr('feature/gutter');
    expect(pr).toEqual({
      number: 42,
      title: 'Add purple gutter',
      url: 'https://github.com/octocat/hello-world/pull/42',
      sourceBranch: 'feature/gutter',
      targetBranch: 'main',
      provider: 'github',
    });
  });

  it('returns undefined when no PR is open for the branch', async () => {
    const provider = new GitHubProvider({
      owner: 'octocat',
      repo: 'hello-world',
      fetchImpl: mockFetch(() => ({ status: 200, body: [] })),
    });
    expect(await provider.findOpenPr('no-pr-branch')).toBeUndefined();
  });

  it('sends the auth token when provided', async () => {
    let seenAuth: string | undefined;
    const provider = new GitHubProvider({
      owner: 'o',
      repo: 'r',
      token: 'tok123',
      fetchImpl: mockFetch((_url, init) => {
        seenAuth = init?.headers?.Authorization;
        return { status: 200, body: [] };
      }),
    });
    await provider.findOpenPr('b');
    expect(seenAuth).toBe('Bearer tok123');
  });

  it('uses the Enterprise API base when configured', async () => {
    let seenUrl = '';
    const provider = new GitHubProvider({
      owner: 'team',
      repo: 'repo',
      enterpriseBaseUrl: 'https://github.mycompany.com/',
      fetchImpl: mockFetch((url) => {
        seenUrl = url;
        return { status: 200, body: [] };
      }),
    });
    await provider.findOpenPr('b');
    expect(seenUrl.startsWith('https://github.mycompany.com/api/v3/repos/team/repo/pulls')).toBe(true);
  });

  it('throws a descriptive error on API failure', async () => {
    const provider = new GitHubProvider({
      owner: 'o',
      repo: 'r',
      fetchImpl: mockFetch(() => ({ status: 403, body: { message: 'rate limited' } })),
    });
    await expect(provider.findOpenPr('b')).rejects.toThrow(/GitHub API 403/);
  });

  it('fetches the PR diff with the diff media type', async () => {
    let seenAccept: string | undefined;
    const provider = new GitHubProvider({
      owner: 'o',
      repo: 'r',
      fetchImpl: mockFetch((_url, init) => {
        seenAccept = init?.headers?.Accept;
        return { status: 200, body: 'diff --git a/f b/f' };
      }),
    });
    const diff = await provider.fetchDiff({
      number: 1, title: '', url: '', sourceBranch: 'b', targetBranch: 'main', provider: 'github',
    });
    expect(seenAccept).toBe('application/vnd.github.diff');
    expect(diff).toContain('diff --git');
  });
});

const BITBUCKET_PR = {
  id: 7,
  title: 'Fix login',
  links: { html: { href: 'https://bitbucket.org/ws/repo/pull-requests/7' } },
  source: { branch: { name: 'bugfix/login' } },
  destination: { branch: { name: 'develop' } },
};

describe('BitbucketProvider', () => {
  it('queries by source branch and maps fields', async () => {
    let seenUrl = '';
    const provider = new BitbucketProvider({
      workspace: 'ws',
      repo: 'repo',
      fetchImpl: mockFetch((url) => {
        seenUrl = url;
        return { status: 200, body: { values: [BITBUCKET_PR] } };
      }),
    });
    const pr = await provider.findOpenPr('bugfix/login');
    expect(seenUrl).toContain('https://api.bitbucket.org/2.0/repositories/ws/repo/pullrequests?q=');
    expect(decodeURIComponent(seenUrl)).toContain('source.branch.name = "bugfix/login" AND state = "OPEN"');
    expect(pr).toEqual({
      number: 7,
      title: 'Fix login',
      url: 'https://bitbucket.org/ws/repo/pull-requests/7',
      sourceBranch: 'bugfix/login',
      targetBranch: 'develop',
      provider: 'bitbucket',
    });
  });

  it('returns undefined when no PR matches', async () => {
    const provider = new BitbucketProvider({
      workspace: 'ws',
      repo: 'repo',
      fetchImpl: mockFetch(() => ({ status: 200, body: { values: [] } })),
    });
    expect(await provider.findOpenPr('nothing')).toBeUndefined();
  });

  it('sends Basic auth when credentials are set', async () => {
    let seenAuth: string | undefined;
    const provider = new BitbucketProvider({
      workspace: 'ws',
      repo: 'repo',
      username: 'kevin',
      appPassword: 'secret',
      fetchImpl: mockFetch((_url, init) => {
        seenAuth = init?.headers?.Authorization;
        return { status: 200, body: { values: [] } };
      }),
    });
    await provider.findOpenPr('b');
    expect(seenAuth).toBe(`Basic ${Buffer.from('kevin:secret').toString('base64')}`);
  });

  it('throws a descriptive error on API failure', async () => {
    const provider = new BitbucketProvider({
      workspace: 'ws',
      repo: 'repo',
      fetchImpl: mockFetch(() => ({ status: 401, body: {} })),
    });
    await expect(provider.findOpenPr('b')).rejects.toThrow(/Bitbucket API 401/);
  });

  it('fetches the PR diff from the diff endpoint', async () => {
    let seenUrl = '';
    const provider = new BitbucketProvider({
      workspace: 'ws',
      repo: 'repo',
      fetchImpl: mockFetch((url) => {
        seenUrl = url;
        return { status: 200, body: 'diff --git a/f b/f' };
      }),
    });
    const diff = await provider.fetchDiff({
      number: 7, title: '', url: '', sourceBranch: 'b', targetBranch: 'develop', provider: 'bitbucket',
    });
    expect(seenUrl).toBe('https://api.bitbucket.org/2.0/repositories/ws/repo/pullrequests/7/diff');
    expect(diff).toContain('diff --git');
  });
});
