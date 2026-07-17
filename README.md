# PR Gutter Highlight

JetBrains IDEA-style pull request highlighting for VS Code. When you check out a branch that has an **open pull request**, every line added or modified in that PR gets a **purple marker in the editor gutter** — just like IntelliJ's review stripe. Works with **GitHub** (including github.com and a configurable Enterprise host) and **Bitbucket Cloud**.

> Screenshot/GIF placeholder — add a capture of the purple gutter stripe on a PR branch here.

## How it works

1. On startup, on every branch checkout (`.git/HEAD` is watched), and on manual refresh, the extension reads your repo's remote (`origin` by default).
2. The remote URL determines the provider (github.com / Bitbucket Cloud / GitHub Enterprise).
3. It asks the provider's API for an open PR whose **source branch** matches your checked-out branch.
4. Changed lines are computed **locally** with `git diff --unified=0 <merge-base> HEAD` against the PR's target branch — so highlights work offline once the target ref is fetched. If the target ref can't be resolved locally, it falls back to the provider's diff API.
5. Added/modified lines get a purple gutter stripe plus an overview-ruler mark; a status bar item shows the PR number (click to open it in the browser).

Highlights clear automatically when you switch to a branch with no open PR, or when the PR is merged/closed (on the next refresh).

## Setup

### GitHub

Nothing to configure for public repos. For private repos, run **`PR Highlight: Sign in to GitHub`** from the command palette — this uses VS Code's built-in GitHub authentication (no token pasting).

**GitHub Enterprise:** set `prGutterHighlight.githubEnterpriseUrl` to your instance base URL, e.g. `https://github.mycompany.com`.

### Bitbucket Cloud

Run **`PR Highlight: Set Bitbucket Credentials`** and enter your Bitbucket username and an [app password / API token](https://support.atlassian.com/bitbucket-cloud/docs/app-passwords/) with **Pull requests: Read** scope. Credentials are stored in VS Code's SecretStorage (your OS keychain), never in settings files.

## Commands

| Command | Description |
|---|---|
| `PR Highlight: Refresh` | Re-detect the PR and recompute highlights |
| `PR Highlight: Sign in to GitHub` | Authenticate via VS Code's GitHub provider |
| `PR Highlight: Set Bitbucket Credentials` | Store Bitbucket username + app password in SecretStorage |
| `PR Highlight: Open Pull Request in Browser` | Open the detected PR (also: click the status bar item) |

## Configuration

| Setting | Default | Description |
|---|---|---|
| `prGutterHighlight.enabled` | `true` | Master switch |
| `prGutterHighlight.gutterColor.dark` | `#A371F7` | Gutter stripe color in dark themes |
| `prGutterHighlight.gutterColor.light` | `#8250DF` | Gutter stripe color in light themes |
| `prGutterHighlight.githubEnterpriseUrl` | `""` | GitHub Enterprise base URL (empty = github.com) |
| `prGutterHighlight.remoteName` | `origin` | Git remote used for provider + PR detection |

The overview-ruler color is themable via `workbench.colorCustomizations` with the color id `prGutterHighlight.overviewRulerColor`.

## Development

```bash
npm install
npm test          # unit tests (vitest)
npm run compile   # typecheck + bundle to dist/
npm run package   # build the .vsix
```

Press **F5** in VS Code to launch the Extension Development Host. See `TESTING.md` in the repo for the manual verification checklist.

## Limitations (v1)

- Single-root focus: the first workspace folder that is a git repository is used.
- Fork PRs where the head repo differs from `origin` may not be detected (detection matches `owner:branch`).
- Refresh is event-driven (checkout, config change, manual command); PR state changes made on the server are picked up on the next refresh, not by polling.
