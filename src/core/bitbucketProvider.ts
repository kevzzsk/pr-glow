import { FetchLike, PrProvider, PullRequest } from './types';

export interface BitbucketProviderOptions {
  /** Bitbucket workspace (owner) */
  workspace: string;
  repo: string;
  /** Bitbucket username for Basic auth (app password / API token auth). */
  username?: string;
  /** App password or API token. */
  appPassword?: string;
  fetchImpl?: FetchLike;
}

interface BitbucketPr {
  id: number;
  title: string;
  links: { html: { href: string } };
  source: { branch: { name: string } };
  destination: { branch: { name: string } };
}

export class BitbucketProvider implements PrProvider {
  readonly kind = 'bitbucket' as const;
  private readonly apiBase = 'https://api.bitbucket.org/2.0';
  private readonly fetchImpl: FetchLike;

  constructor(private readonly opts: BitbucketProviderOptions) {
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'pr-gutter-highlight',
    };
    if (this.opts.username && this.opts.appPassword) {
      const basic = Buffer.from(`${this.opts.username}:${this.opts.appPassword}`).toString('base64');
      h.Authorization = `Basic ${basic}`;
    }
    return h;
  }

  async findOpenPr(branch: string): Promise<PullRequest | undefined> {
    const { workspace, repo } = this.opts;
    const q = encodeURIComponent(`source.branch.name = "${branch}" AND state = "OPEN"`);
    const url = `${this.apiBase}/repositories/${workspace}/${repo}/pullrequests?q=${q}`;
    const res = await this.fetchImpl(url, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`Bitbucket API ${res.status} ${res.statusText} for ${url}`);
    }
    const body = (await res.json()) as { values?: BitbucketPr[] };
    const pr = body.values?.find((p) => p.source.branch.name === branch) ?? body.values?.[0];
    if (!pr) {
      return undefined;
    }
    return {
      number: pr.id,
      title: pr.title,
      url: pr.links.html.href,
      sourceBranch: pr.source.branch.name,
      targetBranch: pr.destination.branch.name,
      provider: 'bitbucket',
    };
  }

  async fetchDiff(pr: PullRequest): Promise<string> {
    const { workspace, repo } = this.opts;
    const url = `${this.apiBase}/repositories/${workspace}/${repo}/pullrequests/${pr.number}/diff`;
    const res = await this.fetchImpl(url, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`Bitbucket diff API ${res.status} ${res.statusText}`);
    }
    return res.text();
  }
}
