/**
 * Captures et mesures de l'app en production, en viewport mobile.
 *
 *   node scripts/shots.mjs [--auth]
 *
 * Sans --auth : pages publiques. Avec --auth : crée un compte, crédite, lance
 * une analyse et capture le formulaire puis le résultat.
 */
import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";
import { chromium } from "playwright-core";

const BASE = "https://creaad.site";
const EXE =
  process.env.CHROME_PATH ??
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe`;

const auth = process.argv.includes("--auth");

const browser = await chromium.launch({
  executablePath: EXE,
  args: ["--no-sandbox", "--disable-gpu"],
});

const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: "fr-FR",
});

const page = await context.newPage();
const problems = [];

async function capture(label, url, fullPage = true) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    scrollHeight: document.documentElement.scrollHeight,
    // Les éléments qui dépassent la largeur du viewport.
    overflowing: [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 6)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || "").toString().slice(0, 60),
        right: Math.round(el.getBoundingClientRect().right),
      })),
  }));

  const file = `.tmp/shot-${label}.png`;
  await page.screenshot({ path: file, fullPage });
  const overflow = metrics.scrollWidth - metrics.innerWidth;
  console.log(
    `${label.padEnd(14)} ${metrics.scrollWidth}x${metrics.scrollHeight} · débordement ${overflow > 0 ? `+${overflow}px` : "aucun"}`,
  );
  for (const el of metrics.overflowing) {
    console.log(`   ⚠ <${el.tag}> right=${el.right} ${el.cls}`);
  }
  if (overflow > 0) problems.push(label);
  return metrics;
}

/* ── pages publiques ────────────────────────────────────────────────────── */
await capture("accueil", `${BASE}/`);
await capture("demo", `${BASE}/demo`);

if (auth) {
  const env = await readFile(".env.local", "utf8");
  const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
  const email = `shot-${Date.now()}@example.test`;

  const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email, password: "motdepasse-2026", name: "Shot" }),
  });
  const raw = (signUp.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]);
  const cookies = raw.map((pair) => {
    const [name, ...rest] = pair.split("=");
    return { name, value: rest.join("="), url: BASE };
  });
  await context.addCookies(cookies);

  const pool = new Pool({ connectionString: dbUrl, max: 1 });
  pool.on("error", (e) => console.error("db:", e.message));
  const userId = (await pool.query('SELECT id FROM "user" WHERE email = $1', [email])).rows[0]?.id;
  await pool.query(
    `INSERT INTO wallet_transactions (user_id, type, amount_xof, balance_after, idempotency_key)
     VALUES ($1, 'ajustement', 5000, 5000, $2)`,
    [userId, `shot-credit-${userId}`],
  );

  await capture("nouveau", `${BASE}/nouveau`);
  await capture("wallet", `${BASE}/wallet`);

  /* Une analyse réelle pour capturer le résultat. */
  const photo =
    "https://ae-pic-a1.aliexpress-media.com/kf/S2d87e1462eb74ca8b832bca36cad86eeW.jpg";
  const started = Date.now();
  const res = await fetch(`${BASE}/api/analyses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: BASE,
      cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    },
    body: JSON.stringify({
      country: "CI",
      images: [{ url: photo, width: 1200, height: 1200 }],
      userText: "Sac Jeep 3 en 1",
    }),
  });
  const body = await res.json();
  console.log(`analyse ${body.status} · ${body.match?.score}/100 · ${((Date.now() - started) / 1000).toFixed(0)} s`);

  if (body.analysisId) await capture("resultat", `${BASE}/analyses/${body.analysisId}`);
  await pool.end();
}

await browser.close();
console.log(problems.length ? `\nDébordement sur : ${problems.join(", ")}` : "\nAucun débordement horizontal.");
