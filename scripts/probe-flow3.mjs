/**
 * Livraison complète en production, avec trois vues distinctes du même produit.
 * Les URLs d'images sont publiques : Vercel les récupère comme le ferait un
 * commerçant qui photographie son produit sous plusieurs angles.
 */
import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";

const BASE = "https://creaad.site";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const diagKey = (await readFile(".tmp/diag.txt", "utf8"))
  .replace(/[^\x20-\x7E]/g, "")
  .split("=")[1];

const diag = await (
  await fetch(
    `${BASE}/api/diag/sources?url=${encodeURIComponent("https://fr.aliexpress.com/w/wholesale-serum-30ml.html")}`,
    { headers: { "x-diag-key": diagKey } },
  )
).json();

const product = diag.items?.[0];
if (!product?.id) throw new Error("diagnostic sans produit");
console.log(`produit     : ${product.title?.slice(0, 60)} (${product.id})`);

/* Trois vues du même produit, lues sur sa page publique. */
const itemHtml = await (
  await fetch(`https://fr.aliexpress.com/item/${product.id}.html`, {
    headers: { "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9" },
    signal: AbortSignal.timeout(30_000),
  })
).text();

const found = [
  ...new Set(
    [...itemHtml.matchAll(/https:\/\/ae-pic-a1\.aliexpress-media\.com\/kf\/[A-Za-z0-9._-]+\.(?:jpg|png|webp)/g)].map(
      (m) => m[0],
    ),
  ),
];
const images = (found.length >= 3 ? found : [...found, product.image]).slice(0, 3);
console.log(`vues        : ${images.length}`);
for (const url of images) console.log(`   ${url.slice(-40)}`);

/* Compte + crédit */
const envText = await readFile(".env.local", "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(envText)?.[1];
const email = `flow5-${Date.now()}@example.test`;
const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE },
  body: JSON.stringify({ email, password: "motdepasse-2026", name: "Flow5" }),
});
const cookie = (signUp.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
if (!cookie) throw new Error("pas de session");

const pool = new Pool({ connectionString: dbUrl, max: 1 });
pool.on("error", (e) => console.error("db:", e.message));
const userId = (await pool.query('SELECT id FROM "user" WHERE email = $1', [email])).rows[0]?.id;
await pool.query(
  `INSERT INTO wallet_transactions (user_id, type, amount_xof, balance_after, idempotency_key)
   VALUES ($1, 'ajustement', 5000, 5000, $2)`,
  [userId, `flow5-credit-${userId}`],
);

const started = Date.now();
const res = await fetch(`${BASE}/api/analyses`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie, Origin: BASE },
  body: JSON.stringify({
    category: "beaute",
    regime: "non_detenu",
    country: "CI",
    images: images.map((url) => ({ url, width: 1200, height: 1200 })),
    userText: product.title,
  }),
});
const body = await res.json();
console.log(`\nanalyse     : HTTP ${res.status} en ${((Date.now() - started) / 1000).toFixed(0)} s`);
console.log(`statut      : ${body.status ?? body.error}`);
if (body.match) console.log(`identification : ${body.match.score}/100 (${body.match.gateReason})`);
if (body.plan)
  console.log(
    `planche     : ${body.plan.score}/100 · ${body.plan.gate} · ${body.plan.slots?.length ?? 0} vue(s) · manquantes: ${body.plan.missing.join(", ") || "aucune"}`,
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
