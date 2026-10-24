/** Le parcours complet produit-il le marché du produit ? */
import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";

const BASE = "https://creaad.site";
const PHOTO = "https://ae-pic-a1.aliexpress-media.com/kf/S2d87e1462eb74ca8b832bca36cad86eeW.jpg";

const env = await readFile(".env.local", "utf8");
const dbUrl = /^DATABASE_URL="?([^"\r\n]+)"?/m.exec(env)?.[1];
const email = `pm-${Date.now()}@example.test`;

const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE },
  body: JSON.stringify({ email, password: "motdepasse-2026", name: "PM" }),
});
const cookie = (signUp.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

const pool = new Pool({ connectionString: dbUrl, max: 1 });
const userId = (await pool.query('SELECT id FROM "user" WHERE email = $1', [email])).rows[0]?.id;
await pool.query(
  `INSERT INTO wallet_transactions (user_id, type, amount_xof, balance_after, idempotency_key)
   VALUES ($1, 'ajustement', 5000, 5000, $2)`,
  [userId, `pm-${userId}`],
);

const created = await (
  await fetch(`${BASE}/api/analyses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie, Origin: BASE },
    body: JSON.stringify({ country: "CI", images: [{ url: PHOTO, width: 1200, height: 1200 }] }),
  })
).json();

if (created.status !== "variante_a_choisir") {
  console.log(`analyse : ${created.status ?? created.error} — ${JSON.stringify(created).slice(0, 160)}`);
  await pool.end();
  process.exit(1);
}

const axis = created.variants?.[0];
const chosen = (axis?.values ?? []).find((v) => v.available && /brown/i.test(v.name)) ?? (axis?.values ?? []).find((v) => v.available);

const delivered = await (
  await fetch(`${BASE}/api/analyses/${created.analysisId}/variante`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie, Origin: BASE },
    body: JSON.stringify({ selection: { [axis.axis]: chosen?.valueId } }),
  })
).json();

console.log(`livraison : ${delivered.status} · archétype marché ${delivered.market?.adsFound ?? 0}`);

// L'échelle tourne après la réponse : on laisse le temps aux trois paliers.
for (let i = 1; i <= 6; i += 1) {
  await new Promise((r) => setTimeout(r, 10_000));
  const state = await pool.query("SELECT market_scope, market_note FROM analyses WHERE id = $1", [created.analysisId]);
  const scope = state.rows[0]?.market_scope;
  if (scope) {
    console.log(`après ${i * 10} s · portée : ${scope}`);
    console.log(`   ${state.rows[0].market_note}`);
    break;
  }
  if (i === 6) console.log("aucune portée enregistrée après 60 s");
}

const ads = await pool.query(
  "SELECT count(*) n, count(DISTINCT advertiser_id) adv FROM ad_observations WHERE product_ref = $1",
  [created.productId ?? "1005001843831532"],
);
console.log(`annonces du produit en base : ${ads.rows[0].n} · ${ads.rows[0].adv} annonceur(s)`);

const page = await fetch(`${BASE}/analyses/${created.analysisId}`, { headers: { cookie } });
const html = await page.text();
const marks = ["ce produit", "le marché du", "Montrer", "Convaincre", "Produire"].filter((m) => html.includes(m));
console.log(`page : HTTP ${page.status} · repères : ${marks.join(", ")}`);

await pool.end();
