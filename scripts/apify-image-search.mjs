/**
 * Lance la recherche inversée et montre la sortie réelle.
 * On essaie plusieurs formes d'entrée jusqu'à ce que l'acteur démarre.
 */
import { readFile, writeFile } from "node:fs/promises";

const token = (await readFile(".secrets/apify_token.txt", "utf8")).trim();
const ACTOR = "dev00~alibaba-1688-aliexpress-reverse-image-search-api";

const IMAGE = "https://ae-pic-a1.aliexpress-media.com/kf/S2d87e1462eb74ca8b832bca36cad86eeW.jpg";

const SHAPES = [
  { imageUrl: IMAGE, maxResults: 10 },
  { image: IMAGE, maxResults: 10 },
  { imageUrls: [IMAGE], maxResults: 10 },
  { image_url: IMAGE, limit: 10 },
  { input: { imageUrl: IMAGE }, maxResults: 10 },
];

for (const [index, input] of SHAPES.entries()) {
  const started = Date.now();
  const res = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(180_000),
    },
  );

  const text = await res.text();
  const seconds = ((Date.now() - started) / 1000).toFixed(0);

  if (!res.ok) {
    console.log(`forme ${index + 1} → HTTP ${res.status} en ${seconds}s : ${text.slice(0, 260)}\n`);
    continue;
  }

  let items;
  try {
    items = JSON.parse(text);
  } catch {
    console.log(`forme ${index + 1} → réponse illisible : ${text.slice(0, 200)}`);
    continue;
  }

  console.log(`forme ${index + 1} → ${items.length} résultat(s) en ${seconds}s\n`);
  await writeFile(".tmp/image-search-sample.json", JSON.stringify(items, null, 2));

  if (items.length > 0) {
    console.log("── clés du premier résultat ──");
    console.log(Object.keys(items[0]).join(", "));
    console.log("\n── premier résultat complet ──");
    console.log(JSON.stringify(items[0], null, 2).slice(0, 2500));
  }
  process.exit(0);
}

console.log("aucune forme d'entrée n'a été acceptée");
