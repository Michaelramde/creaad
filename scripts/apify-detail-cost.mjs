/** Peut-on avoir la fiche + galerie sans payer les avis ? */
import { readFile } from "node:fs/promises";

const token = (await readFile(".secrets/apify_token.txt", "utf8")).trim();
const URL_PRODUIT = "https://www.aliexpress.com/item/1005001843831532.html";

const VARIANTS = [
  ["par défaut (référence)", { startUrls: [{ url: URL_PRODUIT }] }],
  ["sans avis (maxReviews=0)", { startUrls: [{ url: URL_PRODUIT }], maxReviews: 0 }],
  ["sans avis (scrapeReviews=false)", { startUrls: [{ url: URL_PRODUIT }], scrapeReviews: false, maxReviews: 0 }],
];

for (const [label, input] of VARIANTS) {
  const started = Date.now();
  const res = await fetch(
    `https://api.apify.com/v2/acts/zen-studio~aliexpress-scraper/run-sync-get-dataset-items?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(240_000),
    },
  );
  const text = await res.text();
  const seconds = ((Date.now() - started) / 1000).toFixed(0);

  if (!res.ok) {
    console.log(`${label} → HTTP ${res.status} en ${seconds}s`);
    continue;
  }

  const items = JSON.parse(text);
  const item = items[0] ?? {};

  // Coût réel du run qui vient de se terminer
  const runsRes = await fetch(
    `https://api.apify.com/v2/acts/zen-studio~aliexpress-scraper/runs?limit=1&desc=1&token=${token}`,
  );
  const run = (await runsRes.json()).data?.items?.[0];
  const cost = (run?.usageTotalUsd ?? 0).toFixed(4);

  const gallery = Array.isArray(item.gallery) ? item.gallery.length : 0;
  const variants = item.variantCount ?? (Array.isArray(item.variants) ? item.variants.length : 0);

  console.log(
    `${label.padEnd(30)} ${cost} $ · ${seconds}s · galerie ${gallery} · variantes ${variants} · ` +
      `avis ${item.reviewCount ?? "—"} · ${Object.keys(item).length} champs`,
  );
}
