/**
 * Parcours complet en production : inscription → crédit → analyse → page de résultat.
 * Crédite le compte de test directement en base (action d'administration).
 */
import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";

const BASE = "https://creaad.site";
const email = `flow-${Date.now()}@example.test`;
const password = "motdepasse-2026";

const envText = await readFile(".env.local", "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(envText)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL absente de .env.local");

/* 1 — inscription */
const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE },
  body: JSON.stringify({ email, password, name: "Flow" }),
});
const cookie = (signUp.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
console.log(`inscription : HTTP ${signUp.status}${cookie ? " · session" : " · PAS DE SESSION"}`);
if (!cookie) process.exit(1);

/* 2 — crédit de test */
const pool = new Pool({ connectionString: dbUrl, max: 1 });
pool.on("error", (e) => console.error("db:", e.message));

const userRow = await pool.query('SELECT id FROM "user" WHERE email = $1', [email]);
const userId = userRow.rows[0]?.id;
if (!userId) throw new Error("utilisateur introuvable");

await pool.query(
  `INSERT INTO wallet_transactions (user_id, type, amount_xof, balance_after, idempotency_key, metadata)
   VALUES ($1, 'ajustement', 5000, 5000, $2, '{"reason":"test e2e"}')`,
  [userId, `test-credit-${userId}`],
);
console.log("crédit      : 5 000 FCFA ajoutés");

const wallet = await fetch(`${BASE}/api/wallet`, { headers: { cookie } });
const walletBody = await wallet.json();
console.log(`wallet      : ${walletBody.balanceXof} FCFA · ${walletBody.remaining} analyse(s)`);

/* 3 — analyse avec 5 photos réelles */
const photos = [
  "https://ae-pic-a1.aliexpress-media.com/kf/S8e94f188513541a383f3ad641ff3874aH.jpg",
];

const started = Date.now();
const analysis = await fetch(`${BASE}/api/analyses`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie, Origin: BASE },
  body: JSON.stringify({
    category: "beaute",
    regime: "non_detenu",
    country: "CI",
    images: photos.map((url) => ({ url, width: 1200, height: 1200 })),
    userText: "Sérum vitamine C 30 ml visage",
  }),
});

const body = await analysis.json();
console.log(`analyse     : HTTP ${analysis.status} en ${((Date.now() - started) / 1000).toFixed(0)} s`);
console.log(`statut      : ${body.status ?? body.error} ${body.message ?? ""}`);
if (body.match) console.log(`score       : ${body.match.score}/100`);
if (body.plan) console.log(`planche     : ${body.plan.score}/100 · ${body.plan.gate}`);
if (body.market) console.log(`marché      : ${body.market.adsFound} annonces · ${body.market.angles?.length ?? 0} angles`);
if (body.creative) console.log(`production  : ${body.creative.angles} angle(s), ${body.creative.hooks} hook(s)`);
if (body.warnings?.length) console.log(`avertissements : ${body.warnings.slice(0, 2).join(" | ")}`);

/* 4 — page de résultat */
if (body.analysisId) {
  const page = await fetch(`${BASE}/analyses/${body.analysisId}`, { headers: { cookie } });
  const html = await page.text();
  const sections = ["Montrer", "Convaincre", "Produire"].filter((s) => html.includes(s));
  console.log(`page        : HTTP ${page.status} · sections rendues : ${sections.join(", ") || "aucune"}`);
}

await pool.end();
