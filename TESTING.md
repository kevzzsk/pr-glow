# Manual test checklist

Automated verification already in place:

- `npm test` — 35 unit tests: remote URL parsing, branch→PR matching against mocked GitHub/Bitbucket API responses, unified-diff→line-range mapping, and the IPv4-fallback fetch (local http server, redirects, error paths).
- `npm run test:activation` — launches real VS Code with the extension, asserts it activates, all four commands are registered, and `refresh` resolves cleanly in a non-git workspace. ✅ passed 2026-07-17 (local VS Code install).
- `npm run smoke` — live read-only round trip against real public repos: discovers an open PR, verifies `findOpenPr()` locates it by branch, fetches and parses the diff. ✅ passed 2026-07-17 for **GitHub** (microsoft/vscode) and **Bitbucket Cloud** (atlassian/dc-platform).

The items below require a live editor and real repos/PRs.

Status legend: ✅ verified · ⬜ not yet verified · 🔒 blocked on credentials/live PR

## Extension Development Host smoke test

| # | Step | Expected | Status |
|---|---|---|---|
| 1 | `npm run compile`, then F5 to launch the Extension Development Host | Host launches; "PR Gutter Highlight" output channel exists (View → Output) | ✅ (automated: `npm run test:activation`) |
| 2 | Open a folder that is not a git repo | Output logs "no git repository in workspace"; no errors | ✅ (automated: activation test uses a non-git workspace) |
| 3 | Open a git repo with an unsupported remote (e.g. GitLab) | Output logs "unsupported remote"; no errors | ⬜ |

## GitHub end-to-end

Prereqs: a github.com repo with a branch that has an open PR against `main`.

| # | Step | Expected | Status |
|---|---|---|---|
| 4 | Open the repo with the PR branch checked out | Status bar shows `PR #<n>`; files in the PR diff show purple gutter stripes on added/modified lines | ⬜ |
| 5 | Open a file NOT in the PR diff | No gutter stripes | ⬜ |
| 6 | `git checkout main` in a terminal (while host is open) | Highlights and status bar clear within a few seconds (`.git/HEAD` watcher) | ⬜ |
| 7 | Check the PR branch out again | Highlights return | ⬜ |
| 8 | Private repo: run "PR Highlight: Sign in to GitHub", then Refresh | VS Code auth flow completes; PR detected | ⬜ |
| 9 | Click the status bar item | PR opens in the browser | ⬜ |
| 10 | Delete the local remote-tracking ref of the target branch (`git update-ref -d refs/remotes/origin/main`), Refresh | Output logs fallback to provider diff API; highlights still correct | ⬜ |

## Bitbucket Cloud end-to-end

Prereqs: a bitbucket.org repo with an open PR; an app password / API token with Pull requests: Read. 🔒 blocked until credentials and a live Bitbucket PR are available.

| # | Step | Expected | Status |
|---|---|---|---|
| 11 | Run "PR Highlight: Set Bitbucket Credentials", enter username + app password | "credentials saved" toast; refresh runs | 🔒 |
| 12 | Open the Bitbucket repo with the PR branch checked out | Status bar shows PR; purple stripes on PR-changed lines | 🔒 |
| 13 | Checkout a branch with no PR | Highlights clear | 🔒 |

## Theming

| # | Step | Expected | Status |
|---|---|---|---|
| 14 | Toggle between a dark and a light color theme | Stripe color switches between the dark/light configured colors; readable in both | ⬜ |
| 15 | Change `prGutterHighlight.gutterColor.dark` in settings | Stripes re-render in the new color without reload | ⬜ |

## Known gaps

- **In-editor visual verification** (purple stripes rendering on a real PR branch, items 4–10 and 12–15) has not been performed — it needs a human at the editor with a repo that has an open PR. Provider round trips are live-verified via `npm run smoke`; activation and the non-git path are verified via `npm run test:activation`.
- **Credentialed flows** (private GitHub repo sign-in, Bitbucket app-password auth) are blocked on real credentials. The auth header construction for both is covered by unit tests.
- **Environment note:** on VPNs where api.bitbucket.org's IPv6 route blackholes, plain `fetch` times out; the extension's `resilientFetch` retries over IPv4 (this exact failure was reproduced and fixed during development on this machine).
