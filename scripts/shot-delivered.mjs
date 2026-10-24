/** Capture la page de résultat complète, coloris choisi inclus. */
import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";
import { chromium } from "playwright-core";

const BASE = "https://creaad.site";
const EXE = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe`;
const PHOTO = "https://ae-pic-a1.aliexpress-media.com/kf/S2d87e1462eb74ca8b832bca36cad86eeW.jpg";

const env = await readFile(".env.local", "utf8");
const dbUrl = /^DATABASE_URL="?([^"\r\n]+)"?/m.exec(env)?.[1];
const email = `shot2-${Date.now()}@example.test`;

const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE },
  body: JSON.stringify({ email, password: "motdepasse-2026", name: "Shot2" }),
});
const pairs = (signUp.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]);
const cookie = pairs.join("; ");

const pool = new Pool({ connectionString: dbUrl, max: 1 });
const userId = (await pool.query('SELECT id FROM "user" WHERE email = $1', [email])).rows[0]?.id;
await pool.query(
  `INSERT INTO wallet_transactions (user_id, type, amount_xof, balance_after, idempotency_key)
   VALUES ($1, 'ajustement', 5000, 5000, $2)`,
  [userId, `shot2-${userId}`],
);

const firstRes = await fetch(`${BASE}/api/analyses`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie, Origin: BASE },
  body: JSON.stringify({ country: "CI", images: [{ url: PHOTO, width: 1200, height: 1200 }] }),
});
const firstText = await firstRes.text();
let created;
try { created = JSON.parse(firstText); } catch { console.log(`analyse HTTP ${firstRes.status} : ${firstText.slice(0,200)}`); process.exit(1); }

const brown = (created.variants?.[0]?.values ?? []).find((v) => v.available && /brown/i.test(v.name))
  ?? (created.variants?.[0]?.values ?? []).find((v) => v.available);

const delivered = await (
  await fetch(`${BASE}/api/analyses/${created.analysisId}/variante`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie, Origin: BASE },
    body: JSON.stringify({ selection: { [created.variants?.[0]?.axis ?? "Color"]: brown?.valueId } }),
  })
).json();

console.log(`statut : ${delivered.status} · marché ${delivered.market?.adsFound ?? 0} annonces · ${delivered.market?.angles?.length ?? 0} angles`);

const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox", "--disable-gpu"] });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: "fr-FR",
});
await context.addCookies(
  pairs.map((pair) => {
    const [name, ...rest] = pair.split("=");
    return { name, value: rest.join("="), url: BASE };
  }),
);
const page = await context.newPage();
await page.goto(`${BASE}/analyses/${created.analysisId}`, { waitUntil: "networkidle", timeout: 60_000 });
await page.screenshot({ path: ".tmp/shot-livre.png", fullPage: true });
console.log("capture : .tmp/shot-livre.png");

await browser.close();
await pool.end();
