/** Parcours en deux étapes : dossier produit (1 crédit) puis marché (1 crédit). */
import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";

const BASE = "https://creaad.site";
const PHOTO = "https://ae-pic-a1.aliexpress-media.com/kf/S2d87e1462eb74ca8b832bca36cad86eeW.jpg";

const env = await readFile(".env.local", "utf8");
const dbUrl = /^DATABASE_URL="?([^"\r\n]+)"?/m.exec(env)?.[1];
const email = `steps-${Date.now()}@example.test`;

const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE },
  body: JSON.stringify({ email, password: "motdepasse-2026", name: "Steps" }),
});
const cookie = (signUp.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

const pool = new Pool({ connectionString: dbUrl, max: 1 });
const userId = (await pool.query('SELECT id FROM "user" WHERE email = $1', [email])).rows[0]?.id;
await pool.query(
  `INSERT INTO wallet_transactions (user_id, type, amount_xof, balance_after, idempotency_key)
   VALUES ($1, 'ajustement', 5000, 5000, $2)`,
  [userId, `steps-${userId}`],
);

const wallet = async () =>
  (await (await fetch(`${BASE}/api/wallet`, { headers: { cookie } })).json()).balanceXof;

console.log(`solde initial : ${await wallet()} FCFA`);

/* ── ÉTAPE 1 ─────────────────────────────────────────────────────────────── */
const created = await (
  await fetch(`${BASE}/api/analyses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie, Origin: BASE },
    body: JSON.stringify({ country: "CI", images: [{ url: PHOTO, width: 1200, height: 1200 }] }),
  })
).json();

const axis = created.variants?.[0];
const chosen = (axis?.values ?? []).filter((v) => v.available).slice(0, 2);

const started1 = Date.now();
const step1 = await (
  await fetch(`${BASE}/api/analyses/${created.analysisId}/variante`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie, Origin: BASE },
    body: JSON.stringify({ selection: { [axis.axis]: chosen.map((v) => v.valueId) } }),
  })
).json();

console.log(
  `étape 1 : ${step1.status} en ${((Date.now() - started1) / 1000).toFixed(0)} s · planche ${step1.plan?.score ?? "—"} · débité ${step1.charged ? "oui" : "non"}`,
);
console.log(`solde après étape 1 : ${await wallet()} FCFA`);

const page1 = await (await fetch(`${BASE}/analyses/${created.analysisId}`, { headers: { cookie } })).text();
console.log(
  `page étape 1 : ${["Les photos du produit", "Étudier le marché", "Montrer"].filter((m) => page1.includes(m)).join(", ") || "aucun repère"}`,
);
console.log(`photos affichées : ${(page1.match(/Les photos du produit \((\d+)\)/)?.[1] ?? "0")}`);

/* ── ÉTAPE 2 ─────────────────────────────────────────────────────────────── */
const started2 = Date.now();
const step2 = await (
  await fetch(`${BASE}/api/analyses/${created.analysisId}/marche`, {
    method: "POST",
    headers: { cookie, Origin: BASE },
  })
).json();

console.log(
  `étape 2 : ${step2.status ?? step2.error} en ${((Date.now() - started2) / 1000).toFixed(0)} s · marché ${step2.market?.adsFound ?? 0} annonces · débité ${step2.charged ? "oui" : "non"}`,
);
console.log(`solde final : ${await wallet()} FCFA`);

for (let i = 1; i <= 12; i += 1) {
  await new Promise((r) => setTimeout(r, 10_000));
  const state = await pool.query(
    "SELECT market_enrichment, (SELECT count(*) FROM creative_kits c WHERE c.analysis_id = a.id) AS kits FROM analyses a WHERE id = $1",
    [created.analysisId],
  );
  const enrich = state.rows[0]?.market_enrichment ?? {};
  if ((enrich.competitors?.length ?? 0) > 0 && state.rows[0].kits > 0) {
    console.log(
      `après ${i * 10} s · concurrents ${enrich.competitors.length} · désirs ${enrich.desires?.length ?? 0} · objections ${enrich.objections?.length ?? 0} · créas ✓`,
    );
    const page2 = await (await fetch(`${BASE}/analyses/${created.analysisId}`, { headers: { cookie } })).text();
    console.log(
      `page étape 2 : ${["Qui vend ce produit", "Ce que veulent les acheteurs", "Ce qui bloque", "Produire"].filter((m) => page2.includes(m)).join(", ") || "aucun repère"}`,
    );
    break;
  }
  if (i === 12) console.log("enrichissement incomplet après 120 s");
}

await pool.end();
