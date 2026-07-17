# Manual test checklist

Automated unit tests (`npm test`) cover remote URL parsing, branch→PR matching against mocked GitHub/Bitbucket API responses, and unified-diff→line-range mapping. The items below require a live editor and real repos/PRs.

Status legend: ✅ verified · ⬜ not yet verified · 🔒 blocked on credentials/live PR

## Extension Development Host smoke test

| # | Step | Expected | Status |
|---|---|---|---|
| 1 | `npm run compile`, then F5 to launch the Extension Development Host | Host launches; "PR Gutter Highlight" output channel exists (View → Output) | ⬜ |
| 2 | Open a folder that is not a git repo | Output logs "no git repository in workspace"; no errors | ⬜ |
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

- End-to-end verification against live GitHub/Bitbucket PRs has not been performed in this environment (no editor UI / credentials available to the build loop). All provider request/response logic is covered by mocked unit tests.
