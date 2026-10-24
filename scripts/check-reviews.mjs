/** L'acteur de fiche peut-il renvoyer les avis clients ? */
import { readFile, writeFile } from "node:fs/promises";

const token = (await readFile(".secrets/apify_token.txt", "utf8")).trim();
const ACTOR = "zen-studio~aliexpress-scraper";
const URL_PRODUIT = "https://www.aliexpress.com/item/1005001843831532.html";

const ESSAIS = [
  { label: "maxReviews=10", input: { startUrls: [{ url: URL_PRODUIT }], maxReviews: 10 } },
  { label: "reviews=true", input: { startUrls: [{ url: URL_PRODUIT }], reviews: true, maxReviews: 10 } },
  { label: "includeReviews", input: { startUrls: [{ url: URL_PRODUIT }], includeReviews: true } },
];

for (const essai of ESSAIS) {
  const started = Date.now();
  const res = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(essai.input),
      signal: AbortSignal.timeout(300_000),
    },
  );
  const text = await res.text();
  const seconds = ((Date.now() - started) / 1000).toFixed(0);

  if (!res.ok) {
    console.log(`${essai.label} → HTTP ${res.status} (${seconds}s)`);
    continue;
  }

  const items = JSON.parse(text);
  const item = items[0] ?? {};
  const reviewFields = Object.keys(item).filter((k) => /review|avis|comment/i.test(k));

  console.log(`\n${essai.label} → ${items.length} résultat · ${seconds}s`);
  console.log(`   champs avis : ${reviewFields.join(", ") || "aucun"}`);
  for (const field of reviewFields) {
    const value = item[field];
    if (Array.isArray(value)) console.log(`   ${field} : ${value.length} élément(s) · ex. ${JSON.stringify(value[0]).slice(0, 160)}`);
    else console.log(`   ${field} : ${String(value).slice(0, 60)}`);
  }

  if (reviewFields.some((f) => Array.isArray(item[f]) && item[f].length > 0)) {
    await writeFile(".tmp/reviews-sample.json", JSON.stringify(item, null, 2));
    console.log("   → échantillon enregistré");
    break;
  }
}

const runs = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/runs?limit=3&desc=1&token=${token}`);
for (const run of (await runs.json()).data?.items ?? []) {
  console.log(`coût : ${(run.usageTotalUsd ?? 0).toFixed(4)} $`);
}
