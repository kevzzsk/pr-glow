import { resilientFetch } from './resilientFetch';
import { FetchLike, PrProvider, PullRequest } from './types';

export interface GitHubProviderOptions {
  owner: string;
  repo: string;
  /** OAuth/PAT token; undefined attempts unauthenticated requests (public repos). */
  token?: string;
  /** Base URL of a GitHub Enterprise instance (e.g. https://github.mycompany.com). Empty for github.com. */
  enterpriseBaseUrl?: string;
  fetchImpl?: FetchLike;
}

interface GitHubPr {
  number: number;
  title: string;
  html_url: string;
  head: { ref: string };
  base: { ref: string };
}

export class GitHubProvider implements PrProvider {
  readonly kind = 'github' as const;
  private readonly apiBase: string;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly opts: GitHubProviderOptions) {
    this.apiBase = opts.enterpriseBaseUrl
      ? `${opts.enterpriseBaseUrl.replace(/\/+$/, '')}/api/v3`
      : 'https://api.github.com';
    this.fetchImpl = opts.fetchImpl ?? resilientFetch;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'pr-gutter-highlight',
      ...extra,
    };
    if (this.opts.token) {
      h.Authorization = `Bearer ${this.opts.token}`;
    }
    return h;
  }

  async findOpenPr(branch: string): Promise<PullRequest | undefined> {
    const { owner, repo } = this.opts;
    const url = `${this.apiBase}/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=10`;
    const res = await this.fetchImpl(url, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`GitHub API ${res.status} ${res.statusText} for ${url}`);
    }
    const prs = (await res.json()) as GitHubPr[];
    const pr = prs.find((p) => p.head.ref === branch) ?? prs[0];
    if (!pr) {
      return undefined;
    }
    return {
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      sourceBranch: pr.head.ref,
      targetBranch: pr.base.ref,
      provider: 'github',
    };
  }

  async fetchDiff(pr: PullRequest): Promise<string> {
    const { owner, repo } = this.opts;
    const url = `${this.apiBase}/repos/${owner}/${repo}/pulls/${pr.number}`;
    const res = await this.fetchImpl(url, {
      headers: this.headers({ Accept: 'application/vnd.github.diff' }),
    });
    if (!res.ok) {
      throw new Error(`GitHub diff API ${res.status} ${res.statusText}`);
    }
    return res.text();
  }
}
