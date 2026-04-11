# gh-token

A tiny CLI that mints a **GitHub App installation access token** and prints it to stdout. The token is never written to disk — capture it via command substitution or pipe it directly into whatever consumes it.

Useful when you need a short-lived GitHub token for CI jobs, git credential helpers, or scripts that call the GitHub API on behalf of an App installation — without hard-coding a PAT.

## Requirements

- [Bun](https://bun.com) v1.3+ (for building from source)
- A GitHub App with a generated private key and at least one installation

## Install

### Ubuntu (system-wide)

```bash
bun install
bun run install:ubuntu
```

This compiles a standalone binary with `bun build --compile` and installs it to `/usr/local/bin/gh-token` with mode `755`, so every user on the system can execute it.

### From source

```bash
bun install
bun run build     # produces ./gh-token
```

## Configuration

`gh-token` is configured entirely through environment variables:

| Variable | Required | Description |
| --- | --- | --- |
| `GH_APP_ID` | yes | Numeric ID of the GitHub App. Find it under **Settings → Developer settings → GitHub Apps → your app**. |
| `GH_INSTALLATION_ID` | yes | Numeric ID of the installation to mint a token for. Visible on the App's **Install App** page, or via `GET /app/installations`. |
| `GH_PRIVATE_KEY_PATH` | yes | Absolute path to the App's PEM private key file downloaded from GitHub. |

If any are missing, the CLI exits with a clear error listing which ones.

## Usage

```bash
GH_APP_ID=123456 \
GH_INSTALLATION_ID=7890123 \
GH_PRIVATE_KEY_PATH=/etc/gh-token/app.pem \
  gh-token
```

The token is printed to stdout with no trailing newline, so it composes cleanly with command substitution — nothing is written to disk:

```bash
# Use directly with the GitHub CLI
GH_TOKEN="$(gh-token)" gh repo list

# Or with curl
curl -H "Authorization: Bearer $(gh-token)" https://api.github.com/installation/repositories
```

### Help

```bash
gh-token --help
```

## Security notes

- **Never commit your `.pem` private key.** The repo's `.gitignore` excludes `*.pem`, but double-check before pushing.
- Installation tokens are short-lived (expire after ~1 hour) — regenerate via `gh-token` as needed rather than caching.
- The token is only written to stdout; `gh-token` never persists it to disk. Capture it with command substitution into a short-lived variable so it isn't left in shell history or on the filesystem.

## Development

```bash
bun install
bun index.ts --help    # run without compiling
bun run build          # compile standalone binary
```

The entry point is [`index.ts`](./index.ts). Commander handles argument parsing and help output; token minting uses [`@octokit/auth-app`](https://www.npmjs.com/package/@octokit/auth-app).
