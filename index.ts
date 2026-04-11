import { createAppAuth } from "@octokit/auth-app";
import { Command } from "commander";

const program = new Command();

program
  .name("gh-token")
  .description(
    `Mint a GitHub App installation access token and print it to stdout.

The token is never written to disk — capture it via a command substitution
or pipe it directly into the consumer (e.g. \`GH_TOKEN="$(gh-token)" gh …\`).

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

    process.stdout.write(token);
  });

await program.parseAsync();
