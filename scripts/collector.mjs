/**
 * Collecteur Meta Ad Library — session authentifiée persistante.
 *
 * Constat mesuré : la page charge bien, elle appelle `POST /api/graphql/`,
 * mais en mode `logged_out` — Facebook exige une session connectée pour
 * l'Ad Library. C'est ainsi que fonctionnent les scrapers qui marchent :
 * ils réutilisent un compte.
 *
 * Deux modes :
 *   node scripts/collector.mjs --login     → ouvre un navigateur, tu te connectes une fois
 *   node scripts/collector.mjs             → réutilise la session, collecte sans toi
 *
 * En CI, on peut fournir la session par la variable FB_STORAGE_STATE (JSON).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

const PROFILE = ".secrets/fb-profile";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const args = process.argv.slice(2);
const LOGIN = args.includes("--login");
const DRY_RUN = args.includes("--dry-run");
const ROTATE = args.includes("--rotate");
const OUT = args.find((a) => a.startsWith("--out="))?.split("=")[1] ?? ".tmp/ads.jsonl";
const MAX = Number(args.find((a) => a.startsWith("--max="))?.split("=")[1] ?? 10);

const LAUNCH = {
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
  ],
  viewport: { width: 1280, height: 900 },
  locale: "fr-FR",
  userAgent: UA,
};

/* ── mode connexion ──────────────────────────────────────────────────────── */

async function isLoggedIn(context) {
  const cookies = await context.cookies("https://www.facebook.com");
  return cookies.some((c) => c.name === "c_user" && c.value);
}

if (LOGIN) {
  await mkdir(PROFILE, { recursive: true });
  console.log("Un navigateur va s'ouvrir. Connecte-toi à Facebook, puis laisse-le ouvert.");
  console.log("La session sera enregistrée dans", PROFILE, "(ignoré par Git).\n");

  const context = await chromium.launchPersistentContext(PROFILE, { ...LAUNCH, headless: false });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto("https://www.facebook.com/login", { waitUntil: "domcontentloaded" });

  const deadline = Date.now() + 5 * 60_000;
  let ok = false;
  while (Date.now() < deadline) {
    if (await isLoggedIn(context)) {
      ok = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }

  if (ok) {
    const cookies = await context.cookies("https://www.facebook.com");
    await writeFile(
      ".secrets/fb-storage.json",
      JSON.stringify({ cookies, origins: [] }, null, 2),
      "utf8",
    );
    console.log("✔ session enregistrée (profil + .secrets/fb-storage.json)");
  } else {
    console.log("✖ connexion non détectée dans les 5 minutes.");
  }

  await context.close();
  process.exit(ok ? 0 : 1);
}

/* ── extraction des annonces ─────────────────────────────────────────────── */

function toRecord(node, target) {
  const id = node.ad_archive_id ?? node.adArchiveID ?? node.adArchiveId;
  if (!id) return null;

  const snapshot = node.snapshot ?? {};
  const body = snapshot.body ?? {};
  const hook =
    (typeof body.text === "string" && body.text) ||
    (typeof snapshot.title === "string" && snapshot.title) ||
    (typeof snapshot.link_title === "string" && snapshot.link_title) ||
    null;

  const pageName = node.page_name ?? snapshot.page_name ?? snapshot.pageName ?? null;
  const startRaw = node.start_date ?? node.startDate ?? null;

  return {
    archetypeSlug: target.archetypeSlug,
    country: target.country,
    platform: "meta",
    advertiserId: String(node.page_id ?? node.pageID ?? pageName ?? id),
    advertiserName: pageName,
    hook: typeof hook === "string" ? hook.slice(0, 500) : null,
    startDate: typeof startRaw === "number" ? new Date(startRaw * 1000).toISOString() : startRaw,
    isActive: node.is_active ?? true,
    url: `https://www.facebook.com/ads/library/?id=${id}`,
  };
}

function walk(node, visit, depth = 0) {
  if (!node || depth > 14) return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit, depth + 1);
    return;
  }
  if (typeof node === "object") {
    visit(node);
    for (const value of Object.values(node)) walk(value, visit, depth + 1);
  }
}

/* ── collecte ────────────────────────────────────────────────────────────── */

const seeds = JSON.parse(await readFile("scripts/collector/seeds.json", "utf8")).targets;
const targets = ROTATE ? [seeds[new Date().getUTCHours() % seeds.length]] : seeds;

let context;
if (process.env.FB_STORAGE_STATE) {
  // CI : session fournie en secret, pas de profil sur disque.
  const state = JSON.parse(process.env.FB_STORAGE_STATE);
  const browser = await chromium.launch({ headless: true, args: LAUNCH.args });
  context = await browser.newContext({ ...LAUNCH, storageState: state });
} else {
  if (!existsSync(PROFILE)) {
    console.error("Aucune session. Lance d'abord : npm run collect:login");
    process.exit(1);
  }
  context = await chromium.launchPersistentContext(PROFILE, { ...LAUNCH, headless: true });
}

if (!(await isLoggedIn(context))) {
  console.error("Session Facebook expirée ou absente. Relance : npm run collect:login");
  await context.close();
  process.exit(1);
}

const records = [];
const seen = new Set();

for (const target of targets) {
  const page = await context.newPage();
  let calls = 0;

  page.on("response", async (response) => {
    if (!/\/api\/graphql/.test(response.url())) return;
    calls += 1;
    try {
      const text = await response.text();
      if (!text.trim().startsWith("{")) return;
      const json = JSON.parse(text);
      walk(json, (node) => {
        const record = toRecord(node, target);
        if (record && !seen.has(record.url)) {
          seen.add(record.url);
          records.push(record);
        }
      });
    } catch {
      /* réponse illisible */
    }
  });

  const url =
    `https://www.facebook.com/ads/library/?active_status=active&ad_type=all` +
    `&country=${target.country}&q=${encodeURIComponent(target.query)}` +
    `&search_type=keyword_unordered&media_type=all`;

  process.stdout.write(`→ ${target.archetypeSlug}… `);

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(9_000);

    for (const label of ["Tout accepter", "Accepter", "Allow all cookies", "Accept all"]) {
      const button = page.getByRole("button", { name: label, exact: false }).first();
      if (await button.count()) {
        await button.click({ timeout: 3_000 }).catch(() => {});
        break;
      }
    }

    for (let i = 0; i < 4; i += 1) {
      await page.mouse.wheel(0, 2_500);
      await page.waitForTimeout(2_500);
    }

    const before = records.length;
    console.log(`${records.length - before} annonce(s) · ${calls} appel(s) GraphQL`);

    if (records.length === 0) {
      const text = ((await page.textContent("body")) ?? "").replace(/\s+/g, " ");
      console.log(`   aperçu : ${text.slice(0, 200)}`);
    }
  } catch (error) {
    console.log(`ÉCHEC · ${error.message}`);
  }

  await page.close();
  await new Promise((r) => setTimeout(r, 3_000));
}

console.log(`\n${records.length} annonce(s) au total.`);

if (!process.env.FB_STORAGE_STATE && context.browser?.()) {
  /* profil persistant : rien à fermer de plus */
}
await context.close();

if (records.length === 0) process.exit(1);

if (DRY_RUN) {
  console.log("--dry-run : rien n'a été écrit.");
  console.log(JSON.stringify(records.slice(0, 2), null, 2).slice(0, 900));
} else {
  await writeFile(OUT, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  console.log(`écrit dans ${OUT}`);
}
