/** La fiche produit donne-t-elle la galerie complète ? */
import { readFile, writeFile } from "node:fs/promises";

const token = (await readFile(".secrets/apify_token.txt", "utf8")).trim();
const URL_PRODUIT = "https://www.aliexpress.com/item/1005001843831532.html";

const ACTORS = [
  ["khadinakbar~aliexpress-all-in-one-scraper", { productUrls: [URL_PRODUIT] }, "khadinakbar productUrls"],
  ["khadinakbar~aliexpress-all-in-one-scraper", { startUrls: [{ url: URL_PRODUIT }] }, "khadinakbar startUrls"],
  ["zen-studio~aliexpress-scraper", { productUrls: [URL_PRODUIT], country: "CI", language: "fr" }, "zen-studio productUrls"],
  ["zen-studio~aliexpress-scraper", { startUrls: [{ url: URL_PRODUIT }] }, "zen-studio startUrls"],
];

for (const [actor, input, label] of ACTORS) {
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
    console.log(`${label} → HTTP ${res.status} en ${seconds}s : ${text.slice(0, 180)}\n`);
    continue;
  }

  let items;
  try {
    items = JSON.parse(text);
  } catch {
    console.log(`${label} → illisible`);
    continue;
  }

  console.log(`${label} → ${items.length} résultat(s) en ${seconds}s`);
  if (items.length === 0) continue;

  const item = items[0];
  const keys = Object.keys(item);
  console.log(`   clés (${keys.length}) : ${keys.join(", ")}`);

  // Tout champ qui ressemble à une liste d'images
  for (const [key, value] of Object.entries(item)) {
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string" && /^https?:/.test(value[0])) {
      console.log(`   → ${key} : ${value.length} URL`);
      console.log(`      ${value.slice(0, 4).join("\n      ")}`);
    }
  }

  await writeFile(`.tmp/detail-${label.split(" ")[0]}.json`, JSON.stringify(items, null, 2));
  console.log(`   exemple titre : ${String(item.title ?? item.productTitle ?? "—").slice(0, 80)}\n`);
  break;
}
