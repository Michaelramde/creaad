/**
 * Parcours complet en production, en partant du classement réel de production.
 */
import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";

const BASE = "https://creaad.site";
const diagKey = (await readFile(".tmp/diag.txt", "utf8"))
  .replace(/[^\x20-\x7E]/g, "")
  .split("=")[1];

const diagRes = await fetch(
  `${BASE}/api/diag/sources?url=${encodeURIComponent("https://fr.aliexpress.com/w/wholesale-serum-30ml.html")}`,
  { headers: { "x-diag-key": diagKey } },
);
const diag = await diagRes.json();
const product = diag.items?.[0];
if (!product?.image) throw new Error("diagnostic sans produit");
console.log(`produit     : ${product.title?.slice(0, 60)}`);
console.log(`photo       : ${product.image.slice(0, 60)}…`);

const envText = await readFile(".env.local", "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(envText)?.[1];
const email = `flow4-${Date.now()}@example.test`;
const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE },
  body: JSON.stringify({ email, password: "motdepasse-2026", name: "Flow4" }),
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
  [userId, `flow4-credit-${userId}`],
);
console.log("crédit      : 5 000 FCFA");

const started = Date.now();
const res = await fetch(`${BASE}/api/analyses`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie, Origin: BASE },
  body: JSON.stringify({
    category: "beaute",
    regime: "non_detenu",
    country: "CI",
    images: Array.from({ length: 3 }, () => ({ url: product.image, width: 1200, height: 1200 })),
    userText: product.title,
  }),
});
const body = await res.json();
console.log(`analyse     : HTTP ${res.status} en ${((Date.now() - started) / 1000).toFixed(0)} s`);
console.log(`statut      : ${body.status ?? body.error}`);
if (body.match) {
  console.log(`score       : ${body.match.score}/100 (${body.match.gateReason})`);
  for (const [k, v] of Object.entries(body.match.components ?? {})) {
    console.log(`   ${k.padEnd(11)} ${Math.round(v.points)}/${v.max} ${v.evidence ? v.detail : "(sans preuve)"}`);
  }
}
if (body.plan)
  console.log(
    `planche     : ${body.plan.score}/100 · ${body.plan.gate} · manquantes: ${body.plan.missing.join(", ") || "aucune"}`,
  );
if (body.market) console.log(`marché      : ${body.market.adsFound} annonces · ${body.market.angles?.length ?? 0} angles`);
if (body.creative)
  console.log(
    `production  : ${body.creative.angles} angle(s), ${body.creative.hooks} hook(s), ${body.creative.scripts} script(s)`,
  );
if (body.warnings?.length) console.log(`alertes     : ${body.warnings.slice(0, 2).join(" | ")}`);

if (body.analysisId) {
  const page = await fetch(`${BASE}/analyses/${body.analysisId}`, { headers: { cookie } });
  const html = await page.text();
  const sections = ["Montrer", "Convaincre", "Produire"].filter((s) => html.includes(s));
  console.log(`page        : HTTP ${page.status} · sections : ${sections.join(", ") || "aucune"}`);
}

await pool.end();
