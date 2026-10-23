/**
 * Collecteur Meta Ad Library — navigateur + interception des réponses.
 *
 * Pourquoi pas la librairie Python : elle fige un `doc_id` GraphQL interne
 * (vérifié en juillet) que Meta rejette désormais par un faux « rate limit »
 * (code 1675004) — constaté depuis un runner GitHub ET depuis un poste local.
 *
 * Ici, c'est la page elle-même qui appelle l'API avec le bon identifiant :
 * on se contente d'écouter et d'extraire. Rien à maintenir.
 *
 *   node scripts/collector.mjs --out=.tmp/ads.jsonl --max=10 [--rotate] [--dry-run]
 */
import { readFile, writeFile } from "node:fs/promises";
import { chromium as chromiumBase } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

/**
 * Facebook renvoie une page `_fb_noscript` quand il détecte un navigateur
 * automatisé : sans JavaScript, aucun appel GraphQL, aucune annonce.
 * Le plugin furtif neutralise les marqueurs habituels (navigator.webdriver,
 * empreinte WebGL, plugins…).
 */
chromiumBase.use(StealthPlugin());

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ROTATE = args.includes("--rotate");
const OUT = args.find((a) => a.startsWith("--out="))?.split("=")[1] ?? ".tmp/ads.jsonl";
const MAX = Number(args.find((a) => a.startsWith("--max="))?.split("=")[1] ?? 10);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const seeds = JSON.parse(await readFile("scripts/collector/seeds.json", "utf8")).targets;
const targets = ROTATE ? [seeds[new Date().getUTCHours() % seeds.length]] : seeds;

/* ── normalisation d'un nœud GraphQL en ligne exploitable ────────────────── */

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

/* ── collecte d'un archétype ─────────────────────────────────────────────── */

const browser = await chromiumBase.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
  ],
});

const records = [];
const seen = new Set();

try {
  const context = await browser.newContext({
    userAgent: UA,
    locale: "fr-FR",
    viewport: { width: 1280, height: 900 },
  });

  // Ceinture et bretelles : certains scripts lisent navigator.webdriver très tôt.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  for (const target of targets) {
    const page = await context.newPage();
    let endpoints = 0;
    let nodesSeen = 0;

    page.on("response", async (response) => {
      const url = response.url();
      if (!/graphql|search_ads|ads\/library/i.test(url)) return;
      if (!response.headers()["content-type"]?.includes("json")) return;

      try {
        const json = await response.json();
        endpoints += 1;
        walk(json, (node) => {
          nodesSeen += 1;
          const record = toRecord(node, target);
          if (record && !seen.has(record.url)) {
            seen.add(record.url);
            records.push(record);
          }
        });
      } catch {
        /* réponse non JSON */
      }
    });

    const url =
      `https://www.facebook.com/ads/library/?active_status=active&ad_type=all` +
      `&country=${target.country}&q=${encodeURIComponent(target.query)}` +
      `&search_type=keyword_unordered&media_type=all`;

    process.stdout.write(`→ ${target.archetypeSlug}… `);

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await page.waitForTimeout(5_000);

      // Bandeau cookies éventuel
      for (const label of ["Tout accepter", "Accepter", "Allow all cookies", "Accept all"]) {
        const button = page.getByRole("button", { name: label, exact: false }).first();
        if (await button.count()) {
          await button.click({ timeout: 3_000 }).catch(() => {});
          break;
        }
      }

      for (let i = 0; i < 3; i += 1) {
        await page.mouse.wheel(0, 2_500);
        await page.waitForTimeout(2_500);
      }

      const before = records.length;
      console.log(`${records.length - before} annonce(s) · ${endpoints} réponse(s) JSON · ${nodesSeen} nœuds`);

      if (records.length === 0) {
        // Diagnostic : que montre réellement la page ?
        const title = await page.title().catch(() => "?");
        const body = (await page.textContent("body").catch(() => "")) ?? "";
        const adLinks = await page.locator('a[href*="ads/library/?id="]').count().catch(() => 0);
        console.log(`   titre: ${title.slice(0, 80)}`);
        console.log(`   liens pub: ${adLinks}`);
        console.log(`   texte: ${body.replace(/\s+/g, " ").slice(0, 220)}`);
      }
    } catch (error) {
      console.log(`ÉCHEC · ${error.message}`);
    }

    await page.close();
  }
} finally {
  await browser.close();
}

/* ── sortie ──────────────────────────────────────────────────────────────── */

console.log(`\n${records.length} annonce(s) au total.`);

if (records.length === 0) {
  console.log("Aucune annonce : la page n'a peut-être pas chargé ses résultats.");
  process.exit(1);
}

if (DRY_RUN) {
  console.log("--dry-run : rien n'a été écrit.");
  console.log(JSON.stringify(records.slice(0, 2), null, 2).slice(0, 900));
} else {
  await writeFile(OUT, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  console.log(`écrit dans ${OUT}`);
}
