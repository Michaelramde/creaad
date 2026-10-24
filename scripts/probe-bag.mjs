/**
 * Rejoue le cas « Sac Jeep 3 en 1 » en production avec la correction.
 */
import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";

const BASE = "https://creaad.site";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function extractArray(source, startIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;
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
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return source.slice(startIndex, i + 1);
    }
  }
  return null;
}

const html = await (
  await fetch("https://fr.aliexpress.com/w/wholesale-sac-jeep.html", {
    headers: { "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9" },
    signal: AbortSignal.timeout(30_000),
  })
).text();

const marker = '"itemList":{"content":[';
const at = html.indexOf(marker);
const raw = at >= 0 ? extractArray(html, at + marker.length - 1) : null;
const items = raw ? JSON.parse(raw) : [];
const bag = items.find((i) => /jeep/i.test(i.title?.displayTitle ?? "")) ?? items[0];
if (!bag) throw new Error("aucun sac trouvé");

const img = bag.image?.imgUrl ?? "";
const image = img.startsWith("//") ? `https:${img}` : img;
console.log(`produit     : ${bag.title.displayTitle.slice(0, 70)}`);
console.log(`photo       : ${image.slice(0, 60)}…`);

const env = await readFile(".env.local", "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
const email = `bag-${Date.now()}@example.test`;
const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE },
  body: JSON.stringify({ email, password: "motdepasse-2026", name: "Bag" }),
});
const cookie = (signUp.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
if (!cookie) throw new Error("pas de session");

const pool = new Pool({ connectionString: dbUrl, max: 1 });
pool.on("error", (e) => console.error("db:", e.message));
const userId = (await pool.query('SELECT id FROM "user" WHERE email = $1', [email])).rows[0]?.id;
await pool.query(
  `INSERT INTO wallet_transactions (user_id, type, amount_xof, balance_after, idempotency_key)
   VALUES ($1, 'ajustement', 5000, 5000, $2)`,
  [userId, `bag-credit-${userId}`],
);

const started = Date.now();
const res = await fetch(`${BASE}/api/analyses`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie, Origin: BASE },
  body: JSON.stringify({
    country: "CI",
    images: [{ url: image, width: 1200, height: 1200 }],
    userText: "Sac Jeep 3 en 1",
  }),
});
const body = await res.json();
console.log(`\nanalyse     : HTTP ${res.status} en ${((Date.now() - started) / 1000).toFixed(0)} s`);
console.log(`statut      : ${body.status ?? body.error}`);
if (body.match) {
  console.log(`score       : ${body.match.score}/100 (${body.match.gateReason})`);
  for (const [k, v] of Object.entries(body.match.components ?? {})) {
    console.log(`   ${k.padEnd(11)} ${Math.round(v.points)}/${v.max} ${v.evidence ? v.detail : "(sans preuve)"}`);
  }
}
if (body.plan) console.log(`planche     : ${body.plan.score}/100 · ${body.plan.gate} · manquantes: ${body.plan.missing.join(", ") || "aucune"}`);
if (body.market) console.log(`marché      : ${body.market.adsFound} annonces · ${body.market.angles?.length ?? 0} angles`);
if (body.creative) console.log(`production  : ${body.creative.angles} angle(s)`);

if (body.analysisId) {
  const page = await fetch(`${BASE}/analyses/${body.analysisId}`, { headers: { cookie } });
  const pageHtml = await page.text();
  const markers = ["Produit retrouvé", "Produit non retrouvé", "Montrer", "Convaincre", "Produire"];
  console.log(`page        : HTTP ${page.status} · ${markers.filter((m) => pageHtml.includes(m)).join(", ") || "aucun repère"}`);
  console.log(`photos      : ${(pageHtml.match(/<img[^>]+src="data:image/g) ?? []).length} affichée(s)`);
}

await pool.end();
