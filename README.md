# gh (flying-dice/gh)


A transparent **drop-in replacement for the `gh` CLI** that mints a fresh GitHub App installation token on every invocation and authenticates as the App's bot identity.

Every call to `gh` goes through this wrapper, which reads a per-user `.ghrc`, mints a short-lived installation token via `@octokit/auth-app`, and then `exec`s the real `gh` binary with `GH_TOKEN` set — so the token lives only for the lifetime of that one command and is never stored on disk, in history, or in the environment of anything but the child process.

If no `.ghrc` is present (none of `appId`, `installationId`, or `privateKeyPath` set), the wrapper transparently passes through to `/usr/bin/gh` with no token injection, so it remains safe to install system-wide even for users who haven't configured an App.

The result: each Linux user on the box appears to GitHub as a distinct `<user>-bot[bot]` account, with no long-lived credentials cached anywhere.

## Why this exists

Running `gh` as a GitHub App instead of as a human or a PAT has three hard requirements that are awkward to satisfy by hand:

1. **Per-invocation tokens.** GitHub App installation tokens expire after ~1 hour. Caching one means you're either handling rotation or leaving stale creds around. Minting fresh every time side-steps both.
2. **Per-user bot identity.** Multiple agents on one host (e.g. four Claude Code accounts) should each show up as their own bot in audit logs, not share a single token.
3. **Works in every shell mode.** Interactive, non-interactive `bash -c`, `systemd --user` services, cron, SSH one-shots. Anything involving shell-init files (`.bashrc`, `.profile`, aliases, functions) is a dead end in non-interactive shells, so the wrapper has to be a plain executable on the default `PATH`.

A wrapper binary at `/usr/local/bin/gh` solves all three simultaneously.

## Architecture

```
┌──────────────┐   argv   ┌──────────────────────┐   argv + GH_TOKEN   ┌────────────┐
│  user / app  │ ───────▶ │  /usr/local/bin/gh   │ ──────────────────▶ │ /usr/bin/gh │
└──────────────┘          │   (this wrapper)     │                     └────────────┘
                          │                      │
                          │  1. rc → ~/.ghrc     │
                          │  2. zod validate     │
                          │  3. auth-app mint    │
                          │  4. Bun.spawn        │
                          └──────────────────────┘
```

The wrapper is a single ~100 MB standalone binary produced by `bun build --compile`. It imports:

- [`rc`](https://www.npmjs.com/package/rc) — resolves `.ghrc` from the usual search paths (`~/.ghrc`, `/etc/ghrc`, walking up from cwd, …).
- [`zod`](https://www.npmjs.com/package/zod) — validates the loaded config with clear error messages when fields are missing or mistyped.
- [`@octokit/auth-app`](https://www.npmjs.com/package/@octokit/auth-app) — signs the JWT and exchanges it for an installation token.
- `Bun.spawn` with `stdio: "inherit"` — passes stdin/stdout/stderr straight through, so `gh` behaves exactly as if it were called directly.

No `commander`, no argv parsing in the wrapper: **every** argument is forwarded to the real `gh` unchanged, so `gh --help`, `gh --version`, `gh pr list --limit 5` all Just Work.

## Why these paths

Every path in this project is chosen deliberately. Here's the reasoning:

### `/usr/local/bin/gh` (the wrapper)

The wrapper **has** to live somewhere that's on the default `PATH` for every shell mode, because the whole point is to shadow `/usr/bin/gh` invisibly.

- `/usr/local/bin` is on the compiled-in default `PATH` for `systemd --user` services (`/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`) and on the system default for login, non-login, interactive, and non-interactive shells.
- It appears **before** `/usr/bin`, so `gh` on `PATH` resolves to the wrapper first.
- `~/.local/bin` or `~/bin` are **not** on `PATH` for non-interactive `bash -c`, `systemd --user`, cron, or SSH one-shots unless you also inject them via PAM env / `~/.config/environment.d/` — fragile and easy to get wrong. A system-wide install avoids that entire class of bug.

### `/usr/bin/gh` (the real GitHub CLI, called from inside the wrapper)

The wrapper shells out to `gh` by **absolute path**, not by name, so it can't accidentally recurse into itself via `PATH`. The path is configurable (see `ghPath` below) in case the real binary lives somewhere else on a given box, but the default assumes the standard Debian/Ubuntu package location.

### `~/.ghrc` (per-user config)

- `rc` natively searches `~/.ghrc` (and several other locations) without any custom search-path code on our side.
- Keeping it in `$HOME` means each Linux user gets their own config, which is how we get per-user bot identities for free.
- Mode `600` (user-readable only) — the file isn't a secret itself (IDs are not sensitive) but it references the private key, which is.

### `/home/<user>/gh.pem` (per-user GitHub App private key)

- Each user owns their own PEM (`chown <user>:<user>`, mode `600`), so only that user can mint tokens with it.
- Path is configurable per user via `.ghrc` — could live in `~/.github/` or `/etc/gh/keys/` if you want a more structured layout, but `$HOME/gh.pem` is dead simple and doesn't require creating subdirectories.

### `dist/gh` (build output)

- `dist/` is `.gitignore`d so compiled artifacts never land in git.
- The binary is named `gh` because that's what it is once installed — it shadows the real `gh` on `PATH`.

## Requirements

- [Bun](https://bun.com) v1.3+ (for building from source)
- The **real** `gh` CLI installed at `/usr/bin/gh` (`apt install gh` on Ubuntu)
- A GitHub App with a generated private key and at least one installation
- A Linux host (the install script is Ubuntu-flavoured but the binary itself is portable)

## Install

### System-wide (recommended)

```bash
bun install
bun run install:ubuntu
```

This runs `bun build --compile` to produce `dist/gh` and then `install -m 755 dist/gh /usr/local/bin/gh`. The binary shadows `/usr/bin/gh` for every user on the system, in every shell mode.

### Build only (no install)

```bash
bun install
bun run build     # produces ./dist/gh
```

## Configure

Each user needs a `~/.ghrc` file. `rc` accepts either INI or JSON; the examples here use INI because it's tidier for a handful of keys.

```ini
# ~/.ghrc, mode 0600
appId=3308769
installationId=122209632
privateKeyPath=/home/skywarp/gh.pem
ghPath=/usr/bin/gh
```

| Key | Required | Description |
| --- | --- | --- |
| `appId` | yes | Numeric ID of the GitHub App. Find it at **Settings → Developer settings → GitHub Apps → your app**. |
| `installationId` | yes | Numeric ID of the installation to mint a token for. Visible on the App's **Install App** page, or via `GET /app/installations`. |
| `privateKeyPath` | yes | Path to the App's PEM private key (absolute, or `~/`-prefixed). Must be readable by the invoking user and nothing else. |
| `ghPath` | no | Absolute path to the real `gh` binary. Defaults to `/usr/bin/gh`. |

Setting the file up (replace values per user):

```bash
sudo tee /home/skywarp/.ghrc >/dev/null <<'EOF'
appId=3308769
installationId=122209632
privateKeyPath=/home/skywarp/gh.pem
ghPath=/usr/bin/gh
EOF
sudo chown skywarp:skywarp /home/skywarp/.ghrc
sudo chmod 600 /home/skywarp/.ghrc
```

Drop the PEM next to it with matching ownership and mode `600`:

```bash
sudo install -o skywarp -g skywarp -m 600 /path/to/downloaded.pem /home/skywarp/gh.pem
```

## Use

Nothing changes from the user's perspective — `gh` is just `gh`:

```bash
gh auth status          # → Logged in to github.com account <user>-bot[bot] (GH_TOKEN)
gh repo list
gh pr list --limit 5
gh api /installation/repositories
```

On every invocation the wrapper reads `.ghrc`, mints a fresh installation token, and spawns `/usr/bin/gh` with `GH_TOKEN` set. The token is only in memory for the duration of that one command.

### Verifying the setup

```bash
/usr/local/bin/gh auth status
```

Expected output:

```
github.com
  ✓ Logged in to github.com account <user>-bot[bot] (GH_TOKEN)
  - Active account: true
```

If you see a different account or a credential-helper error, check that `.ghrc` is owned by and readable by the current user, and that the PEM file referenced in it is too.

## How it works, step by step

For every `gh` call:

1. **Resolve config.** `rc("gh", {}, {})` walks the standard rc search paths and returns a merged object. The third arg (`{}`) disables `rc`'s built-in argv parsing so no command-line flags get eaten by config parsing — all argv belongs to the real `gh`.
2. **Pass-through shortcut.** If none of `appId`, `installationId`, or `privateKeyPath` are set, the wrapper spawns `/usr/bin/gh` directly and exits with its status — no validation, no token minting.
3. **Validate.** A `zod` schema coerces `appId` / `installationId` to positive integers, requires `privateKeyPath`, and defaults `ghPath` to `/usr/bin/gh`. Missing or malformed keys produce a printed list of issues and `exit 1`.
4. **Read the private key.** `Bun.file(privateKeyPath).text()`. If empty or unreadable the wrapper exits with a clear error.
5. **Mint the token.** `createAppAuth({ appId, privateKey })` produces a signer; `auth({ type: "installation", installationId })` exchanges a signed JWT for a short-lived installation token.
6. **Spawn.** `Bun.spawn([ghPath, ...process.argv.slice(2)], { stdio: "inherit", env: { ...process.env, GH_TOKEN: token } })` forwards every arg, inherits stdin/stdout/stderr, and injects the token as an environment variable scoped only to the child.
7. **Propagate exit code.** `process.exit(proc.exitCode ?? 1)` so callers (`set -e`, CI, etc.) see the real `gh` exit status.

## Security notes

- **Never commit the `.pem` private key.** `.gitignore` excludes `*.pem`, and the project also ignores `.ghrc` and `/dist`, but double-check before pushing.
- **Installation tokens are short-lived** (~1 hour). The wrapper mints a fresh one every call — don't cache or persist them.
- **No disk writes.** The token only ever exists in memory and in the child process's environment. It's not written to `~/.github/`, not echoed to the terminal, not logged.
- **Private key must be mode `600`.** If it's group- or world-readable, any user on the box can mint tokens as the bot.
- **`.ghrc` is mode `600`.** The IDs inside aren't sensitive but the file references the PEM, so keep it locked down as a habit.

## Development

```bash
bun install
bun index.ts auth status   # run uncompiled — rc will pick up a project-local ./.ghrc
bun run build              # compile to ./dist/gh
```

A project-local `./.ghrc` (git-ignored) is handy for iterating: `rc` walks upward from cwd and finds it, so you can test the wrapper from the repo root without touching any user's home directory.

The entry point is [`index.ts`](./index.ts). It's ~75 lines — read it top to bottom, there's no hidden magic.

## Uninstall

```bash
sudo rm /usr/local/bin/gh    # restore shadowing — /usr/bin/gh takes over again
rm ~/.ghrc ~/gh.pem          # per user, if you're done with the App auth
```
