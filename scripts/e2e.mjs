/**
 * Compile puis exécute un test de bout en bout.
 *
 *   node scripts/e2e.mjs tests/e2e-payment.ts
 *   node scripts/e2e.mjs tests/e2e-webhook.ts
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";

const target = process.argv[2] ?? "tests/e2e-payment.ts";
const outfile = `.tmp/${basename(target).replace(/\.ts$/, "")}.mjs`;

const isWin = process.platform === "win32";
const esbuild = isWin
  ? "node_modules/@esbuild/win32-x64/esbuild.exe"
  : "node_modules/@esbuild/linux-x64/bin/esbuild";

if (!existsSync(esbuild)) {
  console.error("esbuild introuvable — lance `npm install`.");
  process.exit(1);
}

const build = spawnSync(
  esbuild,
  [
    target,
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--target=node22",
    "--alias:@=./src",
    "--external:@neondatabase/serverless",
    "--external:drizzle-orm",
    "--log-level=error",
    `--outfile=${outfile}`,
  ],
  { stdio: "inherit" },
);

if (build.status !== 0) process.exit(build.status ?? 1);

const run = spawnSync(process.execPath, ["--env-file=.env.local", outfile], {
  stdio: "inherit",
});

process.exit(run.status ?? 1);
