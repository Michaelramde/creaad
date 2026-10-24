/**
 * Collecte Meta via l'acteur Apify `jmlp/meta-ad-library-scraper`.
 *
 * Pourquoi cette voie : c'est la seule qui fonctionne sans compte Facebook.
 * Notre propre navigateur reçoit une page `_fb_noscript` ; cet acteur passe
 * par des proxies résidentiels et renvoie les données.
 *
 * Coût mesuré : ~0,007 $ pour 20 annonces (~0,35 $ / 1 000).
 *
 *   node scripts/collector/meta_apify.mjs --out=.tmp/ads.jsonl [--max=20] [--rotate]
 *
 * Jeton lu depuis APIFY_TOKEN, sinon depuis .secrets/apify_token.txt.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const ACTOR = "jmlp~meta-ad-library-scraper";
const BASE = "https://api.apify.com/v2";

const args = process.argv.slice(2);
const OUT = args.find((a) => a.startsWith("--out="))?.split("=")[1] ?? ".tmp/ads.jsonl";
const MAX = Number(args.find((a) => a.startsWith("--max="))?.split("=")[1] ?? 20);
const ROTATE = args.includes("--rotate");
const DRY_RUN = args.includes("--dry-run");

async function readToken() {
  if (process.env.APIFY_TOKEN) return process.env.APIFY_TOKEN.trim();
  if (existsSync(".secrets/apify_token.txt")) {
    return (await readFile(".secrets/apify_token.txt", "utf8")).trim();
  }
  return null;
}

/**
 * Les annonces actives portent un `end_date` égal à l'instant de la requête —
 * une sentinelle, pas une fin réelle. On ne le stocke que pour les inactives,
 * sinon la durée de diffusion se figerait dans le temps.
 */
function toRow(item, seed) {
  const id = item.ad_archive_id;
  if (!id) return null;

  const snapshot = item.snapshot ?? {};
  const hook =
    snapshot.body?.text ??
    snapshot.title ??
    snapshot.link_title ??
    null;

  const active = item.is_active === true;
  const startMs = typeof item.start_date === "number" ? item.start_date * 1000 : null;
  const endMs =
    !active && typeof item.end_date === "number" ? item.end_date * 1000 : null;

  return {
    archetypeSlug: seed.archetypeSlug,
    country: seed.country,
    platform: "meta",
    advertiserId: String(item.page_id ?? item.page_name ?? id),
    advertiserName: item.page_name ?? null,
    hook: typeof hook === "string" ? hook.slice(0, 800) : null,
    startDate: startMs ? new Date(startMs).toISOString() : null,
    endDate: endMs ? new Date(endMs).toISOString() : null,
    isActive: active,
    url: `https://www.facebook.com/ads/library/?id=${id}`,
  };
}

const token = await readToken();
if (!token) {
  console.error(
    "Jeton Apify absent.\n" +
      "Dépose-le dans .secrets/apify_token.txt (ignoré par Git) ou exporte APIFY_TOKEN.",
  );
  process.exit(1);
}

const seeds = JSON.parse(await readFile("scripts/collector/seeds.json", "utf8")).targets;
const targets = ROTATE ? [seeds[new Date().getUTCHours() % seeds.length]] : seeds;

const rows = [];

for (const seed of targets) {
  process.stdout.write(`→ ${seed.archetypeSlug} (${seed.country})… `);

  const input = {
    keyword: seed.query,
    searchType: "keyword_unordered",
    country: seed.country,
    activeStatus: "active",
    maxAds: MAX,
    proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
    raw: false,
  };

  try {
    const res = await fetch(
      `${BASE}/acts/${ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(300_000),
      },
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${detail.slice(0, 160)}`);
    }

    const items = await res.json();
    const mapped = items.map((item) => toRow(item, seed)).filter(Boolean);

    const advertisers = new Set(mapped.map((r) => r.advertiserId)).size;
    const durations = mapped
      .filter((r) => r.startDate)
      .map((r) => Math.round((Date.now() - Date.parse(r.startDate)) / 86_400_000))
      .sort((a, b) => a - b);

    console.log(
      `${mapped.length}/${items.length} annonce(s) · ${advertisers} annonceur(s)` +
        (durations.length
          ? ` · durée médiane ${durations[Math.floor(durations.length / 2)]} j`
          : ""),
    );

    rows.push(...mapped);
  } catch (error) {
    console.log(`ÉCHEC · ${error.message}`);
  }
}

console.log(`\n${rows.length} annonce(s) retenue(s).`);

if (rows.length === 0) process.exit(1);

if (DRY_RUN) {
  console.log("--dry-run : rien n'a été écrit.");
  console.log(JSON.stringify(rows.slice(0, 2), null, 2));
} else {
  await writeFile(OUT, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  console.log(`écrit dans ${OUT}`);
}
