/**
 * Capture l'écran de progression pendant une vraie analyse.
 *   node scripts/shot-progress.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";
import { chromium } from "playwright-core";

const BASE = "https://creaad.site";
const EXE = `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe`;

/* Une photo locale, comme le ferait un téléphone. */
const IMAGE_URL = "https://ae-pic-a1.aliexpress-media.com/kf/S2d87e1462eb74ca8b832bca36cad86eeW.jpg";
const buffer = Buffer.from(await (await fetch(IMAGE_URL)).arrayBuffer());
await writeFile(".tmp/bag.jpg", buffer);
console.log(`photo locale : ${(buffer.length / 1024).toFixed(0)} Ko`);

const env = await readFile(".env.local", "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
const email = `prog-${Date.now()}@example.test`;

const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE },
  body: JSON.stringify({ email, password: "motdepasse-2026", name: "Prog" }),
});
const cookies = (signUp.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).map((pair) => {
  const [name, ...rest] = pair.split("=");
  return { name, value: rest.join("="), url: BASE };
});

const pool = new Pool({ connectionString: dbUrl, max: 1 });
pool.on("error", (e) => console.error("db:", e.message));
const userId = (await pool.query('SELECT id FROM "user" WHERE email = $1', [email])).rows[0]?.id;
await pool.query(
  `INSERT INTO wallet_transactions (user_id, type, amount_xof, balance_after, idempotency_key)
   VALUES ($1, 'ajustement', 5000, 5000, $2)`,
  [userId, `prog-credit-${userId}`],
);

const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox", "--disable-gpu"] });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: "fr-FR",
});
await context.addCookies(cookies);
const page = await context.newPage();

await page.goto(`${BASE}/nouveau`, { waitUntil: "networkidle" });
await page.setInputFiles('input[type="file"]', ".tmp/bag.jpg");
await page.waitForTimeout(1200); // compression côté navigateur
await page.fill('input[placeholder^="ex."]', "Sac Jeep 3 en 1");
await page.screenshot({ path: ".tmp/shot-nouveau-rempli.png" });

await page.getByRole("button", { name: "Lancer l'analyse" }).click();
await page.waitForTimeout(6000);
await page.screenshot({ path: ".tmp/shot-progression.png" });
console.log("progression capturée :", (await page.textContent("main"))?.slice(0, 90).replace(/\s+/g, " "));

await page.waitForURL(/\/analyses\//, { timeout: 120_000 });
await page.waitForLoadState("networkidle");
await page.screenshot({ path: ".tmp/shot-resultat-final.png", fullPage: true });
console.log("résultat :", page.url());

await browser.close();
await pool.end();
