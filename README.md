# PR Glow

Purple gutter highlights for the lines changed in your branch's open pull request. Works with GitHub and Bitbucket Cloud.

Check out a branch. If it has an open PR, PR Glow marks every line that PR added or changed with a purple stripe in the gutter and shows the PR number in the status bar. Switch to a branch without a PR and the marks go away.

> Screenshot placeholder: add a capture of the gutter stripes on a PR branch.

## Install

Not on the Marketplace yet, so build it from source:

```bash
git clone https://github.com/kevzzsk/pr-glow.git
cd pr-glow
npm install
npm run package
code --install-extension pr-glow-0.1.0.vsix
```

Or open the folder in VS Code and press F5 to try it in the Extension Development Host.

## Setup

### GitHub

Public repos work without any setup. For private repos, run `PR Glow: Sign in to GitHub` from the command palette. This goes through VS Code's built-in GitHub authentication, so there is no token to copy around.

For GitHub Enterprise, set `prGlow.githubEnterpriseUrl` to your instance URL, for example `https://github.mycompany.com`.

### Bitbucket Cloud

Run `PR Glow: Set Bitbucket Credentials` and enter your Bitbucket username and an [app password](https://support.atlassian.com/bitbucket-cloud/docs/app-passwords/) with the "Pull requests: Read" scope. Credentials are stored in VS Code's SecretStorage (your OS keychain), never in settings files.

## How it works

1. On startup, on every branch checkout (the extension watches `.git/HEAD`), and on manual refresh, PR Glow reads your repo's remote (`origin` by default).
2. The remote URL decides the provider: github.com, Bitbucket Cloud, or your configured GitHub Enterprise host.
3. It asks the provider's API for an open PR whose source branch matches your checked-out branch.
4. Changed lines come from a local `git diff` against the merge-base with the PR's target branch, so highlights keep working offline once the target ref is fetched. If the ref can't be resolved locally, it falls back to the provider's diff API.
5. Added and modified lines get a purple gutter stripe and an overview ruler mark. The status bar shows the PR number; click it to open the PR in your browser.
6. PR Glow also registers a quick diff provider, the same mechanism the built-in git gutter uses. Click the diff mark next to a line number to peek the change inline, diffed against the PR base rather than HEAD. Hovering a highlighted line shows a link to a full file diff, also available as `PR Glow: Open File Diff vs PR Base`. Quick diff needs the PR base available locally; when line data comes from the provider's diff API instead, only the stripes show.

## Commands

| Command | What it does |
|---|---|
| `PR Glow: Refresh` | Re-detect the PR and recompute highlights |
| `PR Glow: Sign in to GitHub` | Authenticate via VS Code's GitHub provider |
| `PR Glow: Set Bitbucket Credentials` | Store your Bitbucket username and app password |
| `PR Glow: Open Pull Request in Browser` | Open the detected PR (same as clicking the status bar item) |
| `PR Glow: Open File Diff vs PR Base` | Diff the current file against its content at the PR base |

## Settings

| Setting | Default | Description |
|---|---|---|
| `prGlow.enabled` | `true` | Master switch |
| `prGlow.gutterColor.dark` | `#A371F7` | Stripe color in dark themes |
| `prGlow.gutterColor.light` | `#8250DF` | Stripe color in light themes |
| `prGlow.githubEnterpriseUrl` | `""` | GitHub Enterprise base URL, empty for github.com |
| `prGlow.remoteName` | `origin` | Git remote used for provider and PR detection |

The overview ruler color can be themed through `workbench.colorCustomizations` with the color id `prGlow.overviewRulerColor`.

## Development

```bash
npm install
npm test                 # unit tests (vitest)
npm run test:activation  # integration tests inside a real VS Code instance
npm run smoke            # live read-only check against public GitHub/Bitbucket APIs
npm run compile          # typecheck + bundle
npm run package          # build the .vsix
```

The integration suite launches VS Code three times: once in a plain folder to verify activation, then twice against fixture repos that point at real public PRs (one GitHub, one Bitbucket) to verify detection end to end. `TESTING.md` tracks what still needs a manual pass.

## Known limitations

- Uses the first workspace folder that is a git repository.
- PRs from forks may not be detected, since matching is done on `owner:branch`.
- Refresh happens on checkout, on config changes, and via the refresh command. There is no background polling, so a PR opened or merged on the server shows up on the next refresh.

## Contributing

Issues and pull requests are welcome. Run `npm test` before submitting, and if you touched the provider or git logic, run `npm run test:activation` too.

## License

[MIT](LICENSE)
