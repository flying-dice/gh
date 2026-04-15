import { createAppAuth } from "@octokit/auth-app";
import debug from "debug";
import { homedir } from "node:os";
import { dirname, delimiter } from "node:path";
import rc from "rc";
import { z } from "zod";

const VERSION = process.env.APP_VERSION ?? "dev";
const log = debug("gh");
log("version %s", VERSION);

// Resolve the real gh binary by searching PATH with the wrapper's own
// directory removed, so we can't recurse into ourselves.
const resolveRealGh = (): string => {
  const selfDir = dirname(process.execPath);
  const filteredPath = (process.env.PATH ?? "")
    .split(delimiter)
    .filter((p) => p && p !== selfDir)
    .join(delimiter);
  const found = Bun.which("gh", { PATH: filteredPath });
  if (!found) {
    console.error("gh wrapper: could not find real gh on PATH");
    process.exit(1);
  }
  return found;
};

const ConfigSchema = z.object({
  appId: z.coerce.number().int().positive(),
  installationId: z.coerce.number().int().positive(),
  privateKeyPath: z.string().min(1),
  ghPath: z.string().min(1).optional(),
});

type Config = z.infer<typeof ConfigSchema>;

const expandHome = (p: string): string =>
  p.startsWith("~/") ? `${homedir()}${p.slice(1)}` : p;

// rc("gh", defaults, argv) — passing {} as argv disables minimist parsing,
// so every command-line argument is forwarded to the real gh unchanged.
const raw = rc("gh", {}, {}) as Record<string, unknown>;

if (!raw.appId && !raw.installationId && !raw.privateKeyPath) {
  const proc = Bun.spawn([resolveRealGh(), ...process.argv.slice(2)], {
    stdio: ["inherit", "inherit", "inherit"],
  });
  await proc.exited;
  process.exit(proc.exitCode ?? 1);
}

const parsed = ConfigSchema.safeParse({
  appId: raw.appId,
  installationId: raw.installationId,
  privateKeyPath: raw.privateKeyPath,
  ghPath: raw.ghPath,
});

if (!parsed.success) {
  console.error("gh wrapper: invalid or missing config in .ghrc");
  for (const issue of parsed.error.issues) {
    const path = issue.path.join(".") || "(root)";
    console.error(`  - ${path}: ${issue.message}`);
  }
  console.error(
    "\nExpected a .ghrc file at one of rc's search paths, e.g. ~/.ghrc:",
  );
  console.error("  appId=3308769");
  console.error("  installationId=122209632");
  console.error("  privateKeyPath=~/.github/gh.pem");
  console.error("  ghPath=/usr/bin/gh");
  process.exit(1);
}

const config: Config & { ghPath: string } = {
  ...parsed.data,
  privateKeyPath: expandHome(parsed.data.privateKeyPath),
  ghPath: parsed.data.ghPath ? expandHome(parsed.data.ghPath) : resolveRealGh(),
};

const privateKey = await Bun.file(config.privateKeyPath).text();
if (!privateKey) {
  console.error(
    `gh wrapper: could not read private key at ${config.privateKeyPath}`,
  );
  process.exit(1);
}

const auth = createAppAuth({
  appId: config.appId,
  privateKey,
});

const { token } = await auth({
  type: "installation",
  installationId: config.installationId,
});

const proc = Bun.spawn([config.ghPath, ...process.argv.slice(2)], {
  stdio: ["inherit", "inherit", "inherit"],
  env: { ...process.env, GH_TOKEN: token },
});

await proc.exited;
process.exit(proc.exitCode ?? 1);
