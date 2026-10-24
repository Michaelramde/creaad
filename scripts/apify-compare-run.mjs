/** Les acteurs bon marché donnent-ils la galerie multi-angles ? */
import { readFile, writeFile } from "node:fs/promises";

const token = (await readFile(".secrets/apify_token.txt", "utf8")).trim();
const URL_PRODUIT = "https://www.aliexpress.com/item/1005001843831532.html";
const IMAGE = "https://ae-pic-a1.aliexpress-media.com/kf/S2d87e1462eb74ca8b832bca36cad86eeW.jpg";

async function attempt(actor, input, label) {
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
    console.log(`  ${label} → HTTP ${res.status} ${text.slice(0, 140)}\n`);
    return null;
  }

  let items;
  try {
    items = JSON.parse(text);
  } catch {
    console.log(`  ${label} → illisible`);
    return null;
  }
  if (items.length === 0) {
    console.log(`  ${label} → 0 résultat en ${seconds}s\n`);
    return null;
  }

  // Cherche toute liste d'URL d'images, à n'importe quelle profondeur.
  const galleries = [];
  const walk = (node, path) => {
    if (Array.isArray(node)) {
      const urls = node.filter((x) => typeof x === "string" && /^https?:.*\.(jpg|jpeg|png|webp)/i.test(x));
      if (urls.length >= 2) galleries.push(`${path || "root"} (${urls.length})`);
      node.forEach((x, i) => walk(x, `${path}[${i}]`));
    } else if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) walk(value, path ? `${path}.${key}` : key);
    }
  };
  walk(items[0], "");

  console.log(`  ${label} → ${items.length} résultat(s) en ${seconds}s`);
  console.log(`     champs : ${Object.keys(items[0]).length}`);
  console.log(`     images multiples : ${galleries.join(", ") || "aucune"}`);
  await writeFile(`.tmp/cmp-${actor.split("~")[1]}.json`, JSON.stringify(items, null, 2));
  console.log();
  return items;
}

console.log("── piotrv1001/aliexpress-listings-scraper (0,0015 $/item) ──");
for (const input of [{ productUrls: [URL_PRODUIT] }, { startUrls: [{ url: URL_PRODUIT }] }, { urls: [URL_PRODUIT] }]) {
  const label = Object.keys(input)[0];
  if (await attempt("piotrv1001~aliexpress-listings-scraper", input, label)) break;
}

console.log("── borderline/google-lens (0,01 $ + 0,0015 $/match) ──");
for (const input of [
  { imageUrls: [IMAGE], mode: "products" },
  { imageUrl: IMAGE },
  { startUrls: [{ url: IMAGE }] },
]) {
  const label = Object.keys(input).join("+");
  if (await attempt("borderline~google-lens", input, label)) break;
}
