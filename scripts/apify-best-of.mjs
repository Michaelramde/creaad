/** Métriques détaillées des candidats qui comptent, puis test des deux nouveaux. */
import { readFile, writeFile } from "node:fs/promises";

const token = (await readFile(".secrets/apify_token.txt", "utf8")).trim();
const IMAGE = "https://ae-pic-a1.aliexpress-media.com/kf/S2d87e1462eb74ca8b832bca36cad86eeW.jpg";
const URL_PRODUIT = "https://www.aliexpress.com/item/1005001843831532.html";

const CANDIDATS = [
  ["image", "piotrv1001/aliexpress-image-search-scraper"],
  ["image", "freecamp008/aliexpress-search-by-image-actor"],
  ["image", "crawleast/1688-image-search-scraper"],
  ["fiche", "zen-studio/aliexpress-scraper"],
  ["fiche", "pintostudio/aliexpress-product-search"],
  ["fiche", "thirdwatch/aliexpress-product-scraper"],
  ["fiche", "devcake/aliexpress-products-scraper"],
  ["fiche", "logical_scrapers/aliexpress-scraper"],
];

console.log("besoin  acteur".padEnd(52) + "runs".padStart(8) + "u/7j".padStart(6) + "succ30".padStart(8) + "note".padStart(10));
console.log("─".repeat(84));

for (const [kind, full] of CANDIDATS) {
  const [user, name] = full.split("/");
  const res = await fetch(`https://api.apify.com/v2/acts/${user}~${name}?token=${token}`);
  if (!res.ok) {
    console.log(`${kind.padEnd(7)}${full.padEnd(45)} HTTP ${res.status}`);
    continue;
  }
  const { data } = await res.json();
  const s = data.stats ?? {};
  const runs = s.publicActorRunStats30Days ?? {};
  const total = runs.TOTAL ?? 0;
  const succ = total > 0 ? ((runs.SUCCEEDED / total) * 100).toFixed(1) + "%" : "—";

  console.log(
    `${kind.padEnd(7)}${full.slice(0, 44).padEnd(45)}` +
      String(Math.round((s.totalRuns ?? 0) / 1000) + "k").padStart(8) +
      String(s.totalUsers7Days ?? 0).padStart(6) +
      succ.padStart(8) +
      `${data.actorReviewRating ?? "—"} (${data.actorReviewCount ?? 0})`.padStart(10),
  );
}

/* ── tests ─────────────────────────────────────────────────────────────── */
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
    console.log(`  ${label} → HTTP ${res.status} ${text.slice(0, 150)}`);
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
    console.log(`  ${label} → 0 résultat en ${seconds}s`);
    return null;
  }

  // Cherche toute liste d'URL d'images
  const galleries = [];
  const walk = (node, path) => {
    if (Array.isArray(node)) {
      const urls = node.filter((x) => typeof x === "string" && /^https?:.*\.(jpg|jpeg|png|webp)/i.test(x));
      if (urls.length >= 2) galleries.push(`${path || "root"}(${urls.length})`);
      node.forEach((x, i) => walk(x, `${path}[${i}]`));
    } else if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) walk(value, path ? `${path}.${key}` : key);
    }
  };
  walk(items[0], "");

  console.log(`  ${label} → ${items.length} résultat(s) en ${seconds}s · ${Object.keys(items[0]).length} champs`);
  console.log(`     galeries : ${galleries.join(", ") || "aucune"}`);
  console.log(`     clés : ${Object.keys(items[0]).slice(0, 14).join(", ")}`);
  await writeFile(`.tmp/new-${actor.split("~")[1]}.json`, JSON.stringify(items, null, 2));
  return items;
}

console.log("\n── freecamp008 : recherche par image ──");
for (const input of [{ imageUrls: [IMAGE] }, { imageUrl: IMAGE }, { startUrls: [{ url: IMAGE }] }]) {
  if (await attempt("freecamp008~aliexpress-search-by-image-actor", input, Object.keys(input).join(","))) break;
}

console.log("\n── pintostudio : fiche produit (0,0033 $/item) ──");
for (const input of [{ productUrls: [URL_PRODUIT] }, { startUrls: [{ url: URL_PRODUIT }] }, { urls: [URL_PRODUIT] }]) {
  if (await attempt("pintostudio~aliexpress-product-search", input, Object.keys(input).join(","))) break;
}
