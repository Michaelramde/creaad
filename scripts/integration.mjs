/**
 * Compile puis exécute le test d'intégration contre Neon.
 *
 *   npm run test:integration
 *
 * Le bundle passe par esbuild (résolution de l'alias `@/`) puis Node exécute
 * le fichier produit avec `.env.local`. `stdio: "inherit"` est requis :
 * capturer la sortie d'un process enfant échoue dans les environnements
 * restreints (pipes nommés interdits).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const bin = process.platform === "win32" ? "esbuild.cmd" : "esbuild";
const esbuild = `node_modules/.bin/${bin}`;

if (!existsSync(esbuild)) {
  console.error("esbuild introuvable — lance `npm install`.");
  process.exit(1);
}

const buildArgs = [
  "tests/integration.ts",
  "--bundle",
  "--platform=node",
  "--format=esm",
  "--target=node22",
  "--alias:@=./src",
  "--external:@neondatabase/serverless",
  "--external:drizzle-orm",
  "--log-level=error",
  "--outfile=.tmp/integration.mjs",
];

// Sur Windows le shim est un .cmd : on passe par cmd.exe avec une commande
// unique. `stdio: "inherit"` est obligatoire (les pipes sont interdits ou
// cassent selon l'environnement).
const build =
  process.platform === "win32"
    ? spawnSync([esbuild.replaceAll("/", "\\"), ...buildArgs].join(" "), {
        stdio: "inherit",
        shell: true,
      })
    : spawnSync(esbuild, buildArgs, { stdio: "inherit" });

if (build.status !== 0) process.exit(build.status ?? 1);

const run = spawnSync(
  process.execPath,
  ["--env-file=.env.local", ".tmp/integration.mjs"],
  { stdio: "inherit" },
);

process.exit(run.status ?? 1);
