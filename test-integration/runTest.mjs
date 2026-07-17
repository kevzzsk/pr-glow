import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { runTests } from '@vscode/test-electron';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const suite = path.join(root, 'test-integration', 'suite', 'index.cjs');

// Prefer a locally installed VS Code (avoids the ~150MB download; also works
// on machines where the update CDN is unreachable).
const localVsCode = [
  '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
  path.join(os.homedir(), 'Applications/Visual Studio Code.app/Contents/MacOS/Electron'),
].find((p) => fs.existsSync(p));

/** Minimal IPv4-pinned GET returning parsed JSON (some VPNs blackhole IPv6). */
function getJson(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https
      .get(
        {
          hostname: u.hostname,
          path: `${u.pathname}${u.search}`,
          family: 4,
          timeout: 30000,
          headers: { Accept: 'application/json', 'User-Agent': 'pr-gutter-highlight-test' },
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            if ((res.statusCode ?? 0) >= 300) {
              reject(new Error(`${res.statusCode} for ${url}`));
            } else {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            }
          });
        },
      )
      .on('error', reject);
  });
}

function git(dir, ...args) {
  execFileSync('git', ['-C', dir, '-c', 'user.email=test@test', '-c', 'user.name=test', ...args], {
    stdio: 'pipe',
  });
}

/**
 * Build a throwaway git repo that *looks like* a checkout of `remoteUrl` on
 * `sourceBranch` with a PR open against `targetBranch`:
 *  - HEAD is a dummy commit on sourceBranch
 *  - refs/remotes/origin/<targetBranch> points at an UNRELATED orphan commit,
 *    so merge-base fails and the extension exercises its provider-diff-API
 *    fallback instead of fetching the real (possibly huge) target branch.
 */
function makeFixtureRepo(remoteUrl, sourceBranch, targetBranch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-gutter-fixture-'));
  execFileSync('git', ['init', '-b', sourceBranch, dir], { stdio: 'pipe' });
  git(dir, 'commit', '--allow-empty', '-m', 'head');
  git(dir, 'checkout', '--orphan', '__base');
  git(dir, 'commit', '--allow-empty', '-m', 'base');
  git(dir, 'update-ref', `refs/remotes/origin/${targetBranch}`, 'HEAD');
  git(dir, 'checkout', sourceBranch);
  git(dir, 'branch', '-D', '__base');
  git(dir, 'remote', 'add', 'origin', remoteUrl);
  return dir;
}

async function discoverGitHubPr() {
  for (const [owner, repo] of [['microsoft', 'vscode'], ['facebook', 'react'], ['nodejs', 'node']]) {
    const prs = await getJson(`https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=30`);
    const pr = prs.find((p) => p.head.repo?.full_name === `${owner}/${repo}`);
    if (pr) {
      return {
        remoteUrl: `https://github.com/${owner}/${repo}.git`,
        sourceBranch: pr.head.ref,
        targetBranch: pr.base.ref,
        number: pr.number,
      };
    }
  }
  return undefined;
}

async function discoverBitbucketPr() {
  for (const workspace of ['atlassian', 'blender', 'pypy']) {
    const repos = await getJson(
      `https://api.bitbucket.org/2.0/repositories/${workspace}?sort=-updated_on&pagelen=20`,
    );
    for (const { slug } of repos.values ?? []) {
      const prs = await getJson(
        `https://api.bitbucket.org/2.0/repositories/${workspace}/${slug}/pullrequests?state=OPEN&pagelen=5`,
      );
      const pr = prs.values?.[0];
      if (pr) {
        return {
          remoteUrl: `https://bitbucket.org/${workspace}/${slug}.git`,
          sourceBranch: pr.source.branch.name,
          targetBranch: pr.destination.branch.name,
          number: pr.id,
        };
      }
    }
  }
  return undefined;
}

async function runScenario(name, workspace, env) {
  console.log(`\n=== scenario: ${name} ===`);
  await runTests({
    ...(localVsCode ? { vscodeExecutablePath: localVsCode } : {}),
    extensionDevelopmentPath: root,
    extensionTestsPath: suite,
    extensionTestsEnv: env,
    launchArgs: [workspace, '--disable-workspace-trust', '--disable-gpu'],
  });
  console.log(`scenario ${name}: PASSED`);
}

const cleanups = [];
let failed = false;
try {
  // 1. Basic activation in a non-git workspace.
  const plainWs = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-gutter-ws-'));
  cleanups.push(plainWs);
  await runScenario('activation (non-git workspace)', plainWs, {});

  // 2. End-to-end PR detection against a real open PR per provider.
  for (const [name, discover] of [
    ['github e2e detection', discoverGitHubPr],
    ['bitbucket e2e detection', discoverBitbucketPr],
  ]) {
    let target;
    try {
      target = await discover();
    } catch (err) {
      console.warn(`${name}: discovery failed (${err.message}) — skipping`);
      continue;
    }
    if (!target) {
      console.warn(`${name}: no open same-repo PR found — skipping`);
      continue;
    }
    console.log(`${name}: using PR #${target.number} (${target.remoteUrl} ${target.sourceBranch} → ${target.targetBranch})`);
    const fixture = makeFixtureRepo(target.remoteUrl, target.sourceBranch, target.targetBranch);
    cleanups.push(fixture);
    await runScenario(name, fixture, {
      PR_EXPECT_NUMBER: String(target.number),
      PR_EXPECT_SOURCE_BRANCH: target.sourceBranch,
    });
  }
} catch (err) {
  console.error('integration tests FAILED:', err);
  failed = true;
} finally {
  for (const dir of cleanups) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
process.exit(failed ? 1 : 0);
