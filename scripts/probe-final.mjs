/** Parcours final : délai de réponse, R1+R2 immédiats, R3 et enrichissement ensuite. */
import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";

const BASE = "https://creaad.site";
const PHOTO = "https://ae-pic-a1.aliexpress-media.com/kf/S2d87e1462eb74ca8b832bca36cad86eeW.jpg";

const env = await readFile(".env.local", "utf8");
const dbUrl = /^DATABASE_URL="?([^"\r\n]+)"?/m.exec(env)?.[1];
const email = `final-${Date.now()}@example.test`;

const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE },
  body: JSON.stringify({ email, password: "motdepasse-2026", name: "Final" }),
});
const cookie = (signUp.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

const pool = new Pool({ connectionString: dbUrl, max: 1 });
const userId = (await pool.query('SELECT id FROM "user" WHERE email = $1', [email])).rows[0]?.id;
await pool.query(
  `INSERT INTO wallet_transactions (user_id, type, amount_xof, balance_after, idempotency_key)
   VALUES ($1, 'ajustement', 5000, 5000, $2)`,
  [userId, `final-${userId}`],
);

const created = await (
  await fetch(`${BASE}/api/analyses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie, Origin: BASE },
    body: JSON.stringify({ country: "CI", images: [{ url: PHOTO, width: 1200, height: 1200 }] }),
  })
).json();

const axis = created.variants?.[0];
const chosen = (axis?.values ?? []).filter((v) => v.available).slice(0, 2);

const started = Date.now();
const delivered = await (
  await fetch(`${BASE}/api/analyses/${created.analysisId}/variante`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie, Origin: BASE },
    body: JSON.stringify({ selection: { [axis.axis]: chosen.map((v) => v.valueId) } }),
  })
).json();

console.log(`coloris envoyés : ${chosen.map((v) => v.name).join(" + ")}`);
console.log(
  `reprise : ${delivered.status} en ${((Date.now() - started) / 1000).toFixed(0)} s · planche ${delivered.plan?.score ?? "—"}`,
);

const page = await fetch(`${BASE}/analyses/${created.analysisId}`, { headers: { cookie } });
const html = await page.text();
console.log(
  `page immédiate : ${["Les photos du produit", "Montrer", "ce produit", "Qui vend", "Rédaction du kit"].filter((m) => html.includes(m)).join(", ") || "aucun repère"}`,
);

for (let i = 1; i <= 12; i += 1) {
  await new Promise((r) => setTimeout(r, 10_000));
  const state = await pool.query(
    "SELECT market_enrichment, (SELECT count(*) FROM creative_kits c WHERE c.analysis_id = a.id) AS kits FROM analyses a WHERE id = $1",
    [created.analysisId],
  );
  const row = state.rows[0];
  const enrich = row.market_enrichment ?? {};
  if (row.kits > 0 && (enrich.competitors?.length ?? 0) > 0) {
    console.log(`après ${i * 10} s · kit production ✓ · concurrents ${enrich.competitors.length} · désirs ${enrich.desires?.length ?? 0} · objections ${enrich.objections?.length ?? 0}`);
    break;
  }
  if (i === 12) console.log(`après 120 s · kits ${row.kits} · concurrents ${enrich.competitors?.length ?? 0}`);
}

const finalPage = await fetch(`${BASE}/analyses/${created.analysisId}`, { headers: { cookie } });
const finalHtml = await finalPage.text();
console.log(
  `page finale : ${["Les photos du produit", "Qui vend ce produit", "Ce que veulent les acheteurs", "Ce qui bloque", "Produire"].filter((m) => finalHtml.includes(m)).join(", ") || "aucun repère"}`,
);

await pool.end();
