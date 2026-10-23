/**
 * Compile puis exécute le test de bout en bout paiement (sandbox GeniusPay).
 *
 *   npm run test:e2e
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

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
    "tests/e2e-payment.ts",
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--target=node22",
    "--alias:@=./src",
    "--external:@neondatabase/serverless",
    "--external:drizzle-orm",
    "--log-level=error",
    "--outfile=.tmp/e2e-payment.mjs",
  ],
  { stdio: "inherit" },
);

if (build.status !== 0) process.exit(build.status ?? 1);

const run = spawnSync(process.execPath, ["--env-file=.env.local", ".tmp/e2e-payment.mjs"], {
  stdio: "inherit",
});

process.exit(run.status ?? 1);
