/** Test des fournisseurs candidats : image acceptée, coût mesuré. */
import { readFile, writeFile } from "node:fs/promises";

const token = (await readFile(".secrets/apify_token.txt", "utf8")).trim();
const IMAGE = "https://ae-pic-a1.aliexpress-media.com/kf/S2d87e1462eb74ca8b832bca36cad86eeW.jpg";
const QUERY = "leather messenger bag men";

async function tryActor(actor, inputs, label) {
  for (const input of inputs) {
    const started = Date.now();
    const res = await fetch(
      `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(240_000),
      },
    );
    const text = await res.text();
    const seconds = ((Date.now() - started) / 1000).toFixed(0);
    const shape = Object.keys(input).join("+") || "vide";

    if (!res.ok) {
      console.log(`  ${shape.padEnd(24)} → HTTP ${res.status} (${seconds}s)`);
      continue;
    }

    const items = JSON.parse(text);
    const runsRes = await fetch(`https://api.apify.com/v2/acts/${actor}/runs?limit=1&desc=1&token=${token}`);
    const run = (await runsRes.json()).data?.items?.[0];
    const cost = run?.usageTotalUsd ?? 0;

    console.log(`  ${shape.padEnd(24)} → ${items.length} résultat(s) · ${cost.toFixed(4)} $ · ${seconds}s`);

    if (items.length > 0) {
      console.log(`     champs : ${Object.keys(items[0]).slice(0, 10).join(", ")}`);
      console.log(`     titre  : ${String(items[0].title ?? items[0].name ?? items[0].subject ?? "").slice(0, 64)}`);
      await writeFile(`.tmp/sup-${actor.split("~")[1]}.json`, JSON.stringify(items, null, 2));
      return true;
    }
  }
  return false;
}

console.log("── crawleast/1688-image-search (0,01 $ de base, par image) ──");
await tryActor("crawleast~1688-image-search-scraper", [
  { imageUrl: IMAGE },
  { imageUrls: [IMAGE] },
  { startUrls: [{ url: IMAGE }] },
], "crawleast");

console.log("\n── zen-studio/1688-wholesale-scraper (911 actifs/7 j) ──");
await tryActor("zen-studio~1688-wholesale-scraper", [
  { search: QUERY },
  { q: QUERY },
  { queries: [QUERY] },
  { searchQueries: [QUERY] },
  { keywords: [QUERY] },
  { startUrls: [{ url: `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(QUERY)}` }] },
], "zen-studio");
