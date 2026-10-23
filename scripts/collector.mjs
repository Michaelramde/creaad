/**
 * Collecteur d'annonces — Playwright, exécutable gratuitement en GitHub Actions.
 *
 * Pourquoi un navigateur : Meta Ad Library et TikTok Creative Center servent
 * un challenge JavaScript à toute requête HTTP simple (constaté : 403 + script
 * `executeChallenge`). Un vrai navigateur le passe ; un serveur non.
 *
 * Ce qu'il fait : ouvre la recherche, laisse la page charger ses appels,
 * intercepte les réponses JSON, en extrait les annonces, écrit en base.
 *
 *   node scripts/collector.mjs              # collecte + écriture
 *   node scripts/collector.mjs --dry-run    # affiche, n'écrit rien
 *   node scripts/collector.mjs --only=meta  # une seule plateforme
 *
 * ⚠️ Les sélecteurs et formats de réponse changent : ce script est un
 * squelette à valider sur une exécution réelle avant de s'y fier.
 */
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { Pool } from "@neondatabase/serverless";

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const ONLY = argv.find((a) => a.startsWith("--only="))?.split("=")[1];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const seeds = JSON.parse(await readFile("scripts/collector/seeds.json", "utf8")).targets;

/* ── extraction générique ─────────────────────────────────────────────────── */

/** Parcourt un JSON inconnu et collecte les nœuds qui ressemblent à une annonce. */
function walk(node, visit, depth = 0) {
  if (!node || depth > 12) return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit, depth + 1);
    return;
  }
  if (typeof node === "object") {
    visit(node);
    for (const value of Object.values(node)) walk(value, visit, depth + 1);
  }
}

function normalizeMeta(node, target) {
  const id = node.ad_archive_id ?? node.adArchiveID ?? node.adArchiveId;
  if (!id) return null;

  const snapshot = node.snapshot ?? {};
  const body = snapshot.body ?? {};
  const hook =
    (typeof body.text === "string" && body.text) ||
    (typeof snapshot.title === "string" && snapshot.title) ||
    null;

  const pageName = node.page_name ?? snapshot.page_name ?? snapshot.pageName;

  return {
    archetypeSlug: target.archetypeSlug,
    country: target.country,
    platform: "meta",
    advertiserId: String(node.page_id ?? node.pageID ?? pageName ?? id),
    advertiserName: pageName ?? null,
    hook,
    startDate: node.start_date ? new Date(node.start_date * 1000) : null,
    endDate: null,
    isActive: node.is_active ?? true,
    url: `https://www.facebook.com/ads/library/?id=${id}`,
  };
}

function normalizeTikTok(node, target) {
  const id = node.id ?? node.ad_id ?? node.item_id;
  const hook = node.ad_title ?? node.title ?? node.video_info?.ad_title ?? null;
  if (!id || !hook) return null;

  const brand = node.brand_name ?? node.brandName ?? node.advertiser_name ?? null;

  return {
    archetypeSlug: target.archetypeSlug,
    country: target.country,
    platform: "tiktok",
    advertiserId: String(node.brand_id ?? brand ?? id),
    advertiserName: brand,
    hook,
    startDate: node.first_shown_date ? new Date(node.first_shown_date) : null,
    endDate: null,
    isActive: true,
    url: `https://www.tiktok.com/@${encodeURIComponent(brand ?? "ads")}/video/${id}`,
  };
}

/* ── collecte ─────────────────────────────────────────────────────────────── */

async function collect(browser, target, platform) {
  const page = await browser.newPage({ userAgent: UA, locale: "fr-FR" });
  const found = new Map();
  const seenResponses = [];

  page.on("response", async (response) => {
    const url = response.url();
    const isRelevant =
      platform === "meta"
        ? /search_ads|graphql/i.test(url)
        : /creative_radar|top_ads|item_list/i.test(url);
    if (!isRelevant) return;

    try {
      const json = await response.json();
      seenResponses.push(url.split("?")[0]);
      walk(json, (node) => {
        const row =
          platform === "meta" ? normalizeMeta(node, target) : normalizeTikTok(node, target);
        if (row && !found.has(row.url)) found.set(row.url, row);
      });
    } catch {
      /* réponse non JSON : ignorée */
    }
  });

  const url =
    platform === "meta"
      ? `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${target.country}&q=${encodeURIComponent(target.query)}&search_type=keyword_unordered&media_type=all`
      : `https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?region=${target.country}&period=30`;

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(6_000);

  // Défilement : les résultats se chargent au fil de l'eau.
  for (let i = 0; i < 3; i += 1) {
    await page.mouse.wheel(0, 2_000);
    await page.waitForTimeout(2_500);
  }

  const rows = [...found.values()];
  console.log(
    `  ${platform} · ${target.archetypeSlug} · ${rows.length} annonce(s) · endpoints: ${
      [...new Set(seenResponses)].length
    }`,
  );

  await page.close();
  return rows;
}

/* ── écriture ─────────────────────────────────────────────────────────────── */

async function save(rows) {
  if (rows.length === 0) return 0;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

  let written = 0;
  for (const row of rows) {
    try {
      await pool.query(
        `INSERT INTO ad_observations
           (archetype_slug, country, platform, advertiser_id, advertiser_name,
            hook, start_date, end_date, is_active, url, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'collector')
         ON CONFLICT (platform, url) DO UPDATE
           SET is_active = EXCLUDED.is_active,
               hook = COALESCE(EXCLUDED.hook, ad_observations.hook),
               collected_at = now()`,
        [
          row.archetypeSlug,
          row.country,
          row.platform,
          row.advertiserId,
          row.advertiserName,
          row.hook,
          row.startDate,
          row.endDate,
          row.isActive,
          row.url,
        ],
      );
      written += 1;
    } catch (error) {
      console.warn(`  ! écriture échouée (${row.url}) : ${error.message}`);
    }
  }

  await pool.end();
  return written;
}

/* ── exécution ────────────────────────────────────────────────────────────── */

const platforms = ONLY ? [ONLY] : ["meta", "tiktok"];
const browser = await chromium.launch({ headless: true });
const collected = [];

try {
  for (const target of seeds) {
    for (const platform of platforms) {
      try {
        collected.push(...(await collect(browser, target, platform)));
      } catch (error) {
        console.warn(`  ! ${platform}/${target.archetypeSlug} : ${error.message}`);
      }
    }
  }
} finally {
  await browser.close();
}

console.log(`\n${collected.length} annonce(s) collectée(s).`);

if (DRY_RUN) {
  console.log("Mode --dry-run : rien n'a été écrit.");
  console.log(JSON.stringify(collected.slice(0, 3), null, 2));
} else if (collected.length > 0) {
  const written = await save(collected);
  console.log(`${written} ligne(s) enregistrée(s) dans ad_observations.`);
}
