/**
 * Parcours complet en production : photo → produit exact → choix du coloris → kits.
 *   node scripts/probe-variant-flow.mjs
 */
import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";

const BASE = "https://creaad.site";
const PHOTO = "https://ae-pic-a1.aliexpress-media.com/kf/S2d87e1462eb74ca8b832bca36cad86eeW.jpg";

const env = await readFile(".env.local", "utf8");
const dbUrl = /^DATABASE_URL="?([^"\r\n]+)"?/m.exec(env)?.[1];
const email = `var-${Date.now()}@example.test`;

const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE },
  body: JSON.stringify({ email, password: "motdepasse-2026", name: "Var" }),
});
const cookie = (signUp.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
if (!cookie) throw new Error("pas de session");
console.log(`inscription : HTTP ${signUp.status} · session`);

const pool = new Pool({ connectionString: dbUrl, max: 1 });
pool.on("error", (e) => console.error("db:", e.message));
const userId = (await pool.query('SELECT id FROM "user" WHERE email = $1', [email])).rows[0]?.id;
await pool.query(
  `INSERT INTO wallet_transactions (user_id, type, amount_xof, balance_after, idempotency_key)
   VALUES ($1, 'ajustement', 5000, 5000, $2)`,
  [userId, `var-credit-${userId}`],
);

/* 1 — analyse : le produit doit être trouvé, le coloris demandé */
const started = Date.now();
const first = await fetch(`${BASE}/api/analyses`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie, Origin: BASE },
  body: JSON.stringify({ country: "CI", images: [{ url: PHOTO, width: 1200, height: 1200 }] }),
});
const created = await first.json();
console.log(`\nanalyse : HTTP ${first.status} en ${((Date.now() - started) / 1000).toFixed(0)} s · ${created.status ?? created.error}`);

if (created.status !== "variante_a_choisir") {
  console.log("réponse :", JSON.stringify(created).slice(0, 400));
  await pool.end();
  process.exit(1);
}

console.log(`produit : ${created.product?.productId} · ${String(created.product?.title ?? "").slice(0, 50)}`);
console.log(`coloris : ${created.variants?.[0]?.values?.length ?? 0} proposés`);
for (const value of created.variants?.[0]?.values ?? []) {
  console.log(`   ${value.name.padEnd(16)} ${value.available ? `${value.stock} en stock` : "épuisé"}`);
}

/* 2 — choix d'un coloris disponible et différent du premier */
const axis = created.variants?.[0];
const chosen = (axis?.values ?? []).find((value) => value.available && value.name !== axis?.values?.[0]?.name)
  ?? (axis?.values ?? []).find((value) => value.available);

if (!chosen) {
  console.log("aucun coloris disponible");
  await pool.end();
  process.exit(1);
}

const resumeStarted = Date.now();
const second = await fetch(`${BASE}/api/analyses/${created.analysisId}/variante`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie, Origin: BASE },
  body: JSON.stringify({ selection: { [axis.axis]: chosen.valueId } }),
});
const delivered = await second.json();
console.log(
  `\nreprise « ${chosen.name} » : HTTP ${second.status} en ${((Date.now() - resumeStarted) / 1000).toFixed(0)} s · ${delivered.status ?? delivered.error}`,
);
if (delivered.message) console.log(`   message : ${delivered.message}`);
if (delivered.plan) {
  console.log(`   planche : ${delivered.plan.score}/100 · ${delivered.plan.gate}`);
  const slots = delivered.plan.slots ?? [];
  console.log(`   vues    : ${slots.map((s) => s.id).join(", ") || "aucune"}`);
  const match = slots.some((s) => s.url === chosen.image);
  console.log(`   coloris épinglé dans la planche : ${match ? "OUI" : "non"}`);
}
if (delivered.market) console.log(`   marché  : ${delivered.market.adsFound} annonces · ${delivered.market.angles?.length ?? 0} angles`);
if (delivered.creative) console.log(`   créas   : ${delivered.creative.angles} angle(s)`);

/* 3 — la page rend bien l'état final */
const page = await fetch(`${BASE}/analyses/${created.analysisId}`, { headers: { cookie } });
const html = await page.text();
const markers = ["Montrer", "Convaincre", "Produire", "Coloris à choisir"].filter((m) => html.includes(m));
console.log(`\npage : HTTP ${page.status} · repères : ${markers.join(", ") || "aucun"}`);

await pool.end();
