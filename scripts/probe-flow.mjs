/**
 * Parcours complet en production, avec un produit réellement présent dans les
 * résultats de recherche (le commerçant possède ce produit).
 */
import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";

const BASE = "https://creaad.site";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const envText = await readFile(".env.local", "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(envText)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL absente");

/* 1 — le commerçant photographie un produit réellement listé */
const searchHtml = await (
  await fetch("https://fr.aliexpress.com/w/wholesale-serum-30ml.html", {
    headers: { "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9" },
    signal: AbortSignal.timeout(30_000),
  })
).text();

function extractArray(source, startIndex) {
  let depth = 0, inString = false, escaped = false;
  for (let i = startIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[") depth += 1;
    else if (ch === "]") { depth -= 1; if (depth === 0) return source.slice(startIndex, i + 1); }
  }
  return null;
}
const marker = '"itemList":{"content":[';
const at = searchHtml.indexOf(marker);
const raw = at >= 0 ? extractArray(searchHtml, at + marker.length - 1) : null;
const products = raw ? JSON.parse(raw) : [];
const product = products[0];
if (!product) throw new Error("aucun produit dans la page de recherche");

const title = product.title?.displayTitle;
const imgRaw = product.image?.imgUrl ?? ""; const image = imgRaw.startsWith("//") ? `https:${imgRaw}` : imgRaw;
console.log(`produit     : ${title?.slice(0, 60)}`);
console.log(`photo       : ${image?.slice(0, 60)}…`);

/* 2 — compte + crédit */
const email = `flow2-${Date.now()}@example.test`;
const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE },
  body: JSON.stringify({ email, password: "motdepasse-2026", name: "Flow2" }),
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
  [userId, `flow2-credit-${userId}`],
);
console.log("crédit      : 5 000 FCFA");

/* 3 — analyse */
const started = Date.now();
const res = await fetch(`${BASE}/api/analyses`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie, Origin: BASE },
  body: JSON.stringify({
    category: "beaute",
    regime: "non_detenu",
    country: "CI",
    images: [{ url: image, width: 1200, height: 1200 }],
    userText: title,
  }),
});
const body = await res.json();
console.log(`analyse     : HTTP ${res.status} en ${((Date.now() - started) / 1000).toFixed(0)} s`);
console.log(`statut      : ${body.status ?? body.error}`);
if (body.match) { console.log(`score       : ${body.match.score}/100 (${body.match.gateReason})`); for (const [k, v] of Object.entries(body.match.components ?? {})) console.log(`   ${k.padEnd(11)} ${Math.round(v.points)}/${v.max} ${v.evidence ? v.detail : "(sans preuve)"}`); }
if (body.plan) console.log(`planche     : ${body.plan.score}/100 · ${body.plan.gate} · manquantes: ${body.plan.missing.join(", ") || "aucune"}`);
if (body.market) console.log(`marché      : ${body.market.adsFound} annonces · ${body.market.angles?.length ?? 0} angles`);
if (body.creative) console.log(`production  : ${body.creative.angles} angle(s), ${body.creative.hooks} hook(s), ${body.creative.scripts} script(s)`);
if (body.warnings?.length) console.log(`alertes     : ${body.warnings.slice(0, 2).join(" | ")}`);

if (body.analysisId) {
  const page = await fetch(`${BASE}/analyses/${body.analysisId}`, { headers: { cookie } });
  const html = await page.text();
  const sections = ["Montrer", "Convaincre", "Produire"].filter((s) => html.includes(s));
  console.log(`page        : HTTP ${page.status} · sections : ${sections.join(", ") || "aucune"}`);
}

await pool.end();
