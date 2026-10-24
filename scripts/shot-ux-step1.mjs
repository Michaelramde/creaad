/** Capture l'étape 1 telle que l'utilisateur la voit. */
import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";
import { chromium } from "playwright-core";

const BASE = "https://creaad.site";
const EXE = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe`;
const PHOTO = "https://ae-pic-a1.aliexpress-media.com/kf/S2d87e1462eb74ca8b832bca36cad86eeW.jpg";

const env = await readFile(".env.local", "utf8");
const dbUrl = /^DATABASE_URL="?([^"\r\n]+)"?/m.exec(env)?.[1];
const email = `ux-${Date.now()}@example.test`;

const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE },
  body: JSON.stringify({ email, password: "motdepasse-2026", name: "UX" }),
});
const pairs = (signUp.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]);
const cookie = pairs.join("; ");

const pool = new Pool({ connectionString: dbUrl, max: 1 });
const userId = (await pool.query('SELECT id FROM "user" WHERE email = $1', [email])).rows[0]?.id;
await pool.query(
  `INSERT INTO wallet_transactions (user_id, type, amount_xof, balance_after, idempotency_key)
   VALUES ($1, 'ajustement', 5000, 5000, $2)`,
  [userId, `ux-${userId}`],
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

console.log(`étape 1 : ${step1.status} · planche ${step1.plan?.score ?? "—"}`);

const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox", "--disable-gpu"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "fr-FR" });
await context.addCookies(pairs.map((pair) => {
  const [name, ...rest] = pair.split("=");
  return { name, value: rest.join("="), url: BASE };
}));
const page = await context.newPage();
await page.goto(`${BASE}/analyses/${created.analysisId}`, { waitUntil: "networkidle", timeout: 60_000 });
await page.screenshot({ path: ".tmp/ux-step1.png", fullPage: true });

// Ce que la page contient réellement, mesuré dans le DOM.
const inventory = await page.evaluate(() => {
  const text = document.body.innerText;
  return {
    images: document.querySelectorAll("img").length,
    headings: [...document.querySelectorAll("p, h1, h2")].map((n) => n.textContent?.trim()).filter((t) => t && t.length < 70).slice(0, 24),
    hasSpecs: /matière|marque|modèle|poids|dimension|split leather/i.test(text),
    hasReviews: /avis|étoile|\/5/i.test(text),
    hasDimensions: /\d+\s*(cm|mm|ml|g)\b/i.test(text),
  };
});

console.log(`images dans la page : ${inventory.images}`);
console.log(`spécifications visibles : ${inventory.hasSpecs ? "oui" : "NON"}`);
console.log(`dimensions visibles : ${inventory.hasDimensions ? "oui" : "NON"}`);
console.log(`avis visibles : ${inventory.hasReviews ? "oui" : "NON"}`);
console.log("\nsections :");
for (const heading of inventory.headings) console.log(`  · ${heading}`);

await browser.close();
await pool.end();
