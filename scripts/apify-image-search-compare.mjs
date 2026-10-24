/** La recherche inversée peut-elle cibler AliExpress ? Comparaison de deux acteurs. */
import { readFile, writeFile } from "node:fs/promises";

const token = (await readFile(".secrets/apify_token.txt", "utf8")).trim();
const IMAGE = "https://ae-pic-a1.aliexpress-media.com/kf/S2d87e1462eb74ca8b832bca36cad86eeW.jpg";

async function run(actor, input, label) {
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

  if (!res.ok) {
    console.log(`${label} → HTTP ${res.status} en ${seconds}s : ${text.slice(0, 200)}\n`);
    return null;
  }

  let items;
  try {
    items = JSON.parse(text);
  } catch {
    console.log(`${label} → illisible : ${text.slice(0, 150)}`);
    return null;
  }

  const sites = {};
  for (const item of items) sites[item.site ?? "?"] = (sites[item.site ?? "?"] ?? 0) + 1;
  console.log(`${label} → ${items.length} résultat(s) en ${seconds}s · sites ${JSON.stringify(sites)}`);
  return { items, label };
}

const DEV00 = "dev00~alibaba-1688-aliexpress-reverse-image-search-api";
const AE = "piotrv1001~aliexpress-image-search-scraper";

const attempts = [
  [DEV00, { imageUrl: IMAGE, site: "aliexpress", maxResults: 20 }, "dev00 filtre site=aliexpress"],
  [DEV00, { imageUrl: IMAGE, sites: ["aliexpress"], maxResults: 20 }, "dev00 filtre sites[]"],
  [AE, { imageUrl: IMAGE, maxItems: 20 }, "aliexpress-image-search imageUrl"],
  [AE, { image: IMAGE, maxItems: 20 }, "aliexpress-image-search image"],
];

for (const [actor, input, label] of attempts) {
  const result = await run(actor, input, label);
  if (result && result.items.length > 0) {
    const file = `.tmp/${actor.split("~")[0]}-sample.json`;
    await writeFile(file, JSON.stringify(result.items, null, 2));
    console.log(`   clés : ${Object.keys(result.items[0]).join(", ")}\n`);
    console.log(`   exemple : ${JSON.stringify(result.items[0]).slice(0, 400)}\n`);
  }
}
