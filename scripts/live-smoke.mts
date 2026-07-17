/**
 * Read-only live smoke test of the PR providers against public repos.
 * No credentials required (subject to unauthenticated rate limits).
 * Run: npm run smoke
 *
 * For each provider it discovers a public repo with an open same-repo PR,
 * then verifies findOpenPr() locates that PR by branch name and that
 * fetchDiff() returns a parseable unified diff.
 */
import { GitHubProvider } from '../src/core/githubProvider';
import { BitbucketProvider } from '../src/core/bitbucketProvider';
import { parseUnifiedDiff } from '../src/core/diff';
import { resilientFetch as fetch } from '../src/core/resilientFetch';

const GITHUB_CANDIDATES = [
  ['microsoft', 'vscode'],
  ['facebook', 'react'],
  ['nodejs', 'node'],
];

async function githubSmoke(): Promise<void> {
  for (const [owner, repo] of GITHUB_CANDIDATES) {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=30`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'pr-gutter-highlight-smoke' },
    });
    if (!res.ok) continue;
    const prs = (await res.json()) as Array<{
      number: number;
      head: { ref: string; repo: { full_name: string } | null };
    }>;
    const sameRepoPr = prs.find((p) => p.head.repo?.full_name === `${owner}/${repo}`);
    if (!sameRepoPr) continue;

    const provider = new GitHubProvider({ owner, repo });
    const found = await provider.findOpenPr(sameRepoPr.head.ref);
    if (!found) throw new Error(`GitHub: findOpenPr missed PR #${sameRepoPr.number} (${owner}/${repo} branch ${sameRepoPr.head.ref})`);
    if (found.number !== sameRepoPr.number) throw new Error(`GitHub: expected PR #${sameRepoPr.number}, got #${found.number}`);

    const diff = await provider.fetchDiff(found);
    const files = parseUnifiedDiff(diff);
    console.log(`GitHub OK: ${owner}/${repo} PR #${found.number} "${found.title}" → ${files.size} changed file(s) parsed`);
    return;
  }
  throw new Error('GitHub: no candidate repo had an open same-repo PR');
}

async function bitbucketSmoke(): Promise<void> {
  // Discover public repos in well-known workspaces that have open PRs.
  for (const workspace of ['atlassian', 'blender', 'pypy']) {
    const reposRes = await fetch(
      `https://api.bitbucket.org/2.0/repositories/${workspace}?sort=-updated_on&pagelen=20`,
      { headers: { Accept: 'application/json', 'User-Agent': 'pr-gutter-highlight-smoke' } },
    );
    if (!reposRes.ok) continue;
    const repos = (await reposRes.json()) as { values?: Array<{ slug: string }> };
    for (const { slug } of repos.values ?? []) {
      const prsRes = await fetch(
        `https://api.bitbucket.org/2.0/repositories/${workspace}/${slug}/pullrequests?state=OPEN&pagelen=5`,
        { headers: { Accept: 'application/json', 'User-Agent': 'pr-gutter-highlight-smoke' } },
      );
      if (!prsRes.ok) continue;
      const prs = (await prsRes.json()) as {
        values?: Array<{ id: number; source: { branch: { name: string } } }>;
      };
      const pr = prs.values?.[0];
      if (!pr) continue;

      const provider = new BitbucketProvider({ workspace, repo: slug });
      const found = await provider.findOpenPr(pr.source.branch.name);
      if (!found) throw new Error(`Bitbucket: findOpenPr missed PR #${pr.id} (${workspace}/${slug} branch ${pr.source.branch.name})`);

      const diff = await provider.fetchDiff(found);
      const files = parseUnifiedDiff(diff);
      console.log(`Bitbucket OK: ${workspace}/${slug} PR #${found.number} "${found.title}" → ${files.size} changed file(s) parsed`);
      return;
    }
  }
  throw new Error('Bitbucket: no public repo with an open PR found in candidate workspaces');
}

let failed = false;
for (const [name, fn] of [['GitHub', githubSmoke], ['Bitbucket', bitbucketSmoke]] as const) {
  try {
    await fn();
  } catch (err) {
    failed = true;
    console.error(`${name} smoke FAILED:`, err instanceof Error ? err.message : err);
  }
}
process.exit(failed ? 1 : 0);
