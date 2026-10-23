/**
 * Pousse les variables d'environnement locales vers le projet Vercel.
 *
 * Utilise l'API REST avec le jeton de la CLI déjà authentifiée sur la machine
 * (`%APPDATA%\com.vercel.cli\Data\auth.json`) — aucun secret n'est affiché.
 *
 *   node scripts/vercel-env.mjs
 */
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";

const AUTH = join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "com.vercel.cli", "Data", "auth.json");

/** Valeurs propres à la production, différentes du poste de travail. */
const OVERRIDES = {
  APP_URL: "https://creaad.site",
  BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
  CRON_SECRET: randomBytes(32).toString("hex"),
};

/** Jamais poussées : locales à la CLI, ou pas encore disponibles. */
const SKIP = new Set(["VERCEL_OIDC_TOKEN"]);

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const auth = JSON.parse(await readFile(AUTH, "utf8"));
const token = auth.token;
if (!token) throw new Error("Jeton Vercel introuvable — relance `npx vercel login`.");

const project = JSON.parse(await readFile(".vercel/project.json", "utf8"));
const { projectId, orgId } = project;

const env = parseEnv(await readFile(".env.local", "utf8"));
Object.assign(env, OVERRIDES);

const entries = Object.entries(env).filter(([key]) => !SKIP.has(key));
console.log(`Projet ${project.projectName} — ${entries.length} variables\n`);

let ok = 0;
let failed = 0;

for (const [key, value] of entries) {
  const res = await fetch(
    `https://api.vercel.com/v10/projects/${projectId}/env?teamId=${orgId}&upsert=true`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key,
        value,
        type: "encrypted",
        target: ["production", "preview", "development"],
      }),
    },
  );

  if (res.ok) {
    ok += 1;
    console.log(`✔ ${key}`);
  } else {
    failed += 1;
    const detail = await res.text().catch(() => "");
    console.log(`✖ ${key} — HTTP ${res.status} ${detail.slice(0, 160)}`);
  }
}

console.log(`\n${ok} ajoutées, ${failed} en échec.`);
if (failed > 0) process.exit(1);
