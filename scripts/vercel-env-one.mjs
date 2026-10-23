/**
 * Pousse une variable déjà présente dans .env.local vers Vercel.
 *   node scripts/vercel-env-one.mjs GP_PK
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const key = process.argv[2];
if (!key) {
  console.error("Usage : node scripts/vercel-env-one.mjs CLE");
  process.exit(1);
}

const AUTH = join(
  process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
  "com.vercel.cli",
  "Data",
  "auth.json",
);
const { token } = JSON.parse(await readFile(AUTH, "utf8"));
const { projectId, orgId } = JSON.parse(await readFile(".vercel/project.json", "utf8"));

const envText = await readFile(".env.local", "utf8");
const line = envText.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
if (!line) {
  console.error(`${key} absente de .env.local`);
  process.exit(1);
}

const value = line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");

const res = await fetch(
  `https://api.vercel.com/v10/projects/${projectId}/env?teamId=${orgId}&upsert=true`,
  {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      key,
      value,
      type: "encrypted",
      target: ["production", "preview", "development"],
    }),
  },
);

console.log(res.ok ? `✔ ${key} poussée` : `✖ ${key} — HTTP ${res.status}`);
