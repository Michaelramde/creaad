/**
 * Pose les variables de pilotage de Creaad sur Vercel.
 *
 *   npx vercel login          # une fois, pour rafraîchir le jeton de la CLI
 *   node scripts/vercel-env-add.mjs
 *
 * Idempotent (upsert) : relancer ne crée pas de doublon.
 * Le jeton est lu depuis la config de la CLI — aucun secret n'est affiché.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const AUTH = join(
  process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
  "com.vercel.cli",
  "Data",
  "auth.json",
);

/** Valeurs à poser. R2_PUBLIC_URL vient de l'argument, sinon de .env.local. */
const VARS = [
  { key: "ADMIN_EMAILS", value: "ramdemichael04@gmail.com" },
  { key: "NEXT_PUBLIC_CREDIT_XOF_CACHED", value: "500" },
  { key: "CREDIT_XOF_CACHED", value: "500" },
  { key: "APIFY_DAILY_CAP_USD", value: "5" },
];

async function readEnvLocal(key) {
  try {
    const text = await readFile(".env.local", "utf8");
    const line = text.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
    if (!line) return undefined;
    return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}

const r2Public = process.argv[2] ?? (await readEnvLocal("R2_PUBLIC_URL"));
if (r2Public && /^https:\/\//.test(r2Public) && !r2Public.includes("xxxx")) {
  VARS.push({ key: "R2_PUBLIC_URL", value: r2Public });
} else {
  console.log("· R2_PUBLIC_URL non fournie — ignorée. Passe-la en argument :");
  console.log("  node scripts/vercel-env-add.mjs https://pub-xxxx.r2.dev\n");
}

const { token, expiresAt } = JSON.parse(await readFile(AUTH, "utf8"));
if (expiresAt && Number(expiresAt) * 1000 < Date.now()) {
  console.error("Jeton Vercel expiré. Lance d'abord : npx vercel login");
  process.exit(1);
}

const { projectId, orgId } = JSON.parse(await readFile(".vercel/project.json", "utf8"));

for (const variable of VARS) {
  const res = await fetch(
    `https://api.vercel.com/v10/projects/${projectId}/env?teamId=${orgId}&upsert=true`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        key: variable.key,
        value: variable.value,
        type: "encrypted",
        target: ["production", "preview"],
      }),
    },
  );
  const body = await res.json().catch(() => ({}));
  const error = body?.error?.message ?? body?.message ?? "";
  console.log(`${res.status}  ${variable.key.padEnd(30)} ${error ? "→ " + error : "ok"}`);
}

const list = await fetch(
  `https://api.vercel.com/v9/projects/${projectId}/env?teamId=${orgId}&decrypt=false`,
  { headers: { Authorization: `Bearer ${token}` } },
);
const data = await list.json();
const wanted = new Set(VARS.map((v) => v.key));
console.log("\n--- état côté Vercel ---");
for (const env of data.envs ?? []) {
  if (!wanted.has(env.key)) continue;
  console.log(`${env.key.padEnd(30)} ${env.type.padEnd(10)} cibles : ${(env.target ?? []).join(", ")}`);
}
console.log("\nUn changement de variable ne s'applique qu'au prochain déploiement.");
