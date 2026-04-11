#!/usr/bin/env bun

import { createAppAuth } from "@octokit/auth-app";
import { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";

const program = new Command();

program
  .name("gh-token")
  .description(
    `Mint a GitHub App installation access token and write it to ~/.github/.gh_token.

The token is also printed to stdout so it can be piped or captured directly.

Required environment variables:
  GH_APP_ID           Numeric ID of the GitHub App (Settings → Developer settings → GitHub Apps).
  GH_INSTALLATION_ID  Numeric ID of the installation to mint a token for. Find it under the
                      App's "Install App" page, or via GET /app/installations.
  GH_PRIVATE_KEY_PATH  Absolute path to the App's PEM private key file downloaded from GitHub.

Example:
  GH_APP_ID=123456 \\
  GH_INSTALLATION_ID=7890123 \\
  GH_PRIVATE_KEY_PATH=/etc/gh-token/app.pem \\
    gh-token`,
  )
  .version("0.0.1")
  .action(async () => {
    const appId = process.env.GH_APP_ID;
    const installationId = process.env.GH_INSTALLATION_ID;
    const privateKeyPath = process.env.GH_PRIVATE_KEY_PATH;

    const missing = [
      !appId && "GH_APP_ID",
      !installationId && "GH_INSTALLATION_ID",
      !privateKeyPath && "GH_PRIVATE_KEY_PATH",
    ].filter(Boolean);

    if (missing.length > 0) {
      program.error(
        `Missing required environment variables: ${missing.join(", ")}\n\nRun \`gh-token --help\` for details.`,
      );
    }

    const privateKey = await Bun.file(privateKeyPath!).text();
    if (!privateKey) {
      program.error(`Failed to read private key from ${privateKeyPath}`);
    }

    const auth = createAppAuth({ appId: appId!, privateKey });
    const { token } = await auth({
      type: "installation",
      installationId: installationId!,
    });

    await Bun.write(join(homedir(), ".github", ".gh_token"), token);
    process.stdout.write(token);
  });

await program.parseAsync();
