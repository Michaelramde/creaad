/**
 * Injecte temporairement le jeton dans l'URL du remote, puis la retire.
 *
 *   node scripts/git-auth.mjs url set      → remote avec jeton
 *   node scripts/git-auth.mjs url restore  → remote propre
 *
 * Le fichier `.git/config` n'est jamais commité ni poussé.
 */
import { readFile, writeFile } from "node:fs/promises";

const CLEAN = "https://github.com/Michaelramde/creaad.git";

const mode = process.argv[3];
if (!["set", "restore"].includes(mode)) {
  console.error("Usage : node scripts/git-auth.mjs url set|restore");
  process.exit(1);
}

let config = await readFile(".git/config", "utf8");

if (mode === "set") {
  const token = (await readFile(".secrets/github_token.txt", "utf8")).trim();
  if (!token) {
    console.error("Jeton vide.");
    process.exit(1);
  }

  const withToken = `https://x-access-token:${token}@github.com/Michaelramde/creaad.git`;
  if (!config.includes(CLEAN) && !config.includes("x-access-token")) {
    console.error("URL du remote inattendue dans .git/config");
    process.exit(1);
  }

  config = config.replace(/url = https:\/\/.*github\.com\/Michaelramde\/creaad\.git/, `url = ${withToken}`);
  await writeFile(".git/config", config, "utf8");
  console.log("remote : jeton injecté (local uniquement)");
} else {
  config = config.replace(/url = https:\/\/.*github\.com\/Michaelramde\/creaad\.git/, `url = ${CLEAN}`);
  await writeFile(".git/config", config, "utf8");
  console.log("remote : URL propre rétablie");
}
