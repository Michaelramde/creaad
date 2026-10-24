/**
 * L'acteur accepte-t-il plusieurs pays en UNE exécution ?
 * Si oui, élargir par pays ne coûte pas N fois plus cher.
 */
import { readFile } from "node:fs/promises";

const token = (await readFile(".secrets/apify_token.txt", "utf8")).trim();
const ACTOR = "jmlp~meta-ad-library-scraper";

const url = (country, q) =>
  `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}&q=${encodeURIComponent(q)}&search_type=keyword_unordered`;

const input = {
  adLibraryUrls: [url("SN", "sac homme"), url("CM", "sac homme"), url("CI", "sac homme")],
  maxAds: 15,
};

const started = Date.now();
const res = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${token}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(input),
  signal: AbortSignal.timeout(300_000),
});

const text = await res.text();
console.log(`HTTP ${res.status} en ${((Date.now() - started) / 1000).toFixed(0)} s`);

if (!res.ok) {
  console.log(text.slice(0, 300));
  process.exit(1);
}

const items = JSON.parse(text);
console.log(`annonces : ${items.length}`);
if (items.length > 0) {
  console.log("champs :", Object.keys(items[0]).join(", "));
  const countries = new Set(items.map((i) => JSON.stringify(i.targeted_or_reached_countries)));
  console.log("champ pays présent ?", [...countries].join(", "));
  for (const item of items.slice(0, 3)) {
    console.log(`  · ${String(item.page_name).slice(0, 24)} | ${String(item.snapshot?.body?.text ?? "").slice(0, 60)}`);
  }
}

const runs = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/runs?limit=1&desc=1&token=${token}`);
const run = (await runs.json()).data?.items?.[0];
console.log(`coût : ${(run?.usageTotalUsd ?? 0).toFixed(4)} $`);
