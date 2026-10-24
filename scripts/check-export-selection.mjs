/** La sélection pilote-t-elle réellement l'export ? */
import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";

const BASE = "https://creaad.site";
const PHOTO = "https://ae-pic-a1.aliexpress-media.com/kf/S2d87e1462eb74ca8b832bca36cad86eeW.jpg";

const env = await readFile(".env.local", "utf8");
const dbUrl = /^DATABASE_URL="?([^"\r\n]+)"?/m.exec(env)?.[1];
const email = `exp-${Date.now()}@example.test`;

const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE },
  body: JSON.stringify({ email, password: "motdepasse-2026", name: "Exp" }),
});
const cookie = (signUp.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

const pool = new Pool({ connectionString: dbUrl, max: 1 });
const userId = (await pool.query('SELECT id FROM "user" WHERE email = $1', [email])).rows[0]?.id;
await pool.query(
  `INSERT INTO wallet_transactions (user_id, type, amount_xof, balance_after, idempotency_key)
   VALUES ($1, 'ajustement', 5000, 5000, $2)`,
  [userId, `exp-${userId}`],
);

const created = await (
  await fetch(`${BASE}/api/analyses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie, Origin: BASE },
    body: JSON.stringify({ country: "CI", images: [{ url: PHOTO, width: 1200, height: 1200 }] }),
  })
).json();

if (!created.variants) {
  console.log(`analyse refusée : ${created.status ?? created.error}`);
  await pool.end();
  process.exit(1);
}

const axis = created.variants[0];
const chosen = axis.values.filter((v) => v.available).slice(0, 2);

const step1 = await (
  await fetch(`${BASE}/api/analyses/${created.analysisId}/variante`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie, Origin: BASE },
    body: JSON.stringify({ selection: { [axis.axis]: chosen.map((v) => v.valueId) } }),
  })
).json();
console.log(`étape 1 : ${step1.status}`);

const zipCount = async (query = "") => {
  const res = await fetch(`${BASE}/api/analyses/${created.analysisId}/export${query}`, { headers: { cookie } });
  if (!res.ok) return `HTTP ${res.status}`;
  const buffer = Buffer.from(await res.arrayBuffer());
  return { mo: (buffer.length / 1024 / 1024).toFixed(1), buffer };
};

/* 1. Sans sélection enregistrée : tout part */
const all = await zipCount();
console.log(`export initial : ${all.mo} Mo`);

/* 2. On ne garde qu'un coloris */
const only = await fetch(`${BASE}/api/analyses/${created.analysisId}/coloris`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie, Origin: BASE },
  body: JSON.stringify({ selected: [chosen[0].valueId] }),
});
console.log(`sélection enregistrée : HTTP ${only.status}`);

const filtered = await zipCount();
console.log(`export après sélection d'un seul coloris : ${filtered.mo} Mo`);

const stored = await pool.query("SELECT selected_variants FROM analyses WHERE id = $1", [created.analysisId]);
console.log(`en base : ${JSON.stringify(stored.rows[0]?.selected_variants)}`);

/* 3. Le contenu de la fiche */
const { execSync } = await import("node:child_process");
const fs = await import("node:fs/promises");
await fs.writeFile(".tmp/export-filtered.zip", filtered.buffer);
console.log(`archive enregistrée : ${(filtered.buffer.length / 1024).toFixed(0)} Ko`);

await pool.end();
