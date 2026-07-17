export interface PullRequest {
  /** PR number (GitHub) or id (Bitbucket) */
  number: number;
  title: string;
  /** Browser URL of the PR */
  url: string;
  sourceBranch: string;
  targetBranch: string;
  provider: 'github' | 'bitbucket';
}

export interface PrProvider {
  readonly kind: 'github' | 'bitbucket';
  /** Find the open PR whose source (head) branch is `branch`, or undefined. */
  findOpenPr(branch: string): Promise<PullRequest | undefined>;
  /** Fetch the PR's unified diff text (fallback when local git diff is unavailable). */
  fetchDiff(pr: PullRequest): Promise<string>;
}

export type FetchLike = (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
}) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;
