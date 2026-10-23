/**
 * Construit l'aperçu statique de /demo : CSS Tailwind + HTML pré-rendu.
 *
 * Nécessaire dans les environnements où le serveur Next ne peut pas démarrer
 * (`fork` interdit). Le HTML est produit à partir du **même composant** que
 * la production.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const isWin = process.platform === "win32";
const step = (label) => console.log(`\n▶ ${label}`);

function run(cmd, args) {
  // Pas de shell : tous les exécutables visés sont de vrais binaires, et
  // `shell: true` casserait les chemins contenant des espaces (« Program Files »).
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const esbuild = isWin
  ? "node_modules/@esbuild/win32-x64/esbuild.exe"
  : "node_modules/@esbuild/linux-x64/bin/esbuild";

if (!existsSync(esbuild)) {
  console.error("esbuild introuvable — lance `npm install`.");
  process.exit(1);
}

step("CSS Tailwind");
run(process.execPath, [
  "node_modules/@tailwindcss/cli/dist/index.mjs",
  "-i",
  "src/app/globals.css",
  "-o",
  ".tmp/preview.css",
]);

step("Bundle du composant de page");
run(esbuild, [
  "scripts/render-demo.tsx",
  "--bundle",
  "--platform=node",
  "--format=esm",
  "--target=node22",
  "--jsx=automatic",
  "--alias:@=./src",
  "--alias:next/link=./scripts/link-shim.tsx",
  "--external:react",
  "--external:react-dom",
  "--log-level=error",
  "--outfile=.tmp/render-demo.mjs",
]);

step("Rendu HTML");
run(process.execPath, [".tmp/render-demo.mjs"]);

console.log("\nAperçu prêt : npm run preview");
