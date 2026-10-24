/** Trouver la bonne forme d'entrée pour les deux acteurs restants. */
import { readFile, writeFile } from "node:fs/promises";

const token = (await readFile(".secrets/apify_token.txt", "utf8")).trim();
const URL_PRODUIT = "https://www.aliexpress.com/item/1005001843831532.html";
const IMAGE = "https://ae-pic-a1.aliexpress-media.com/kf/S2d87e1462eb74ca8b832bca36cad86eeW.jpg";

async function run(actor, input) {
  const res = await fetch(
    `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(180_000),
    },
  );
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

function describe(items) {
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
  return { fields: Object.keys(items[0]).length, galleries };
}

/* ── khadinakbar : 0,002 $/résultat, 0,004 $/fiche détaillée ── */
const khadinakbar = [
  { query: URL_PRODUIT },
  { keywords: [URL_PRODUIT] },
  { productUrl: URL_PRODUIT },
  { detailUrls: [URL_PRODUIT] },
  { urls: [URL_PRODUIT] },
];

for (const input of khadinakbar) {
  const r = await run("khadinakbar~aliexpress-all-in-one-scraper", input);
  const label = Object.keys(input).join(",");
  if (!r.ok) {
    console.log(`khadinakbar ${label} → HTTP ${r.status} ${r.text.slice(0, 120)}`);
    continue;
  }
  const items = JSON.parse(r.text);
  if (items.length === 0) {
    console.log(`khadinakbar ${label} → 0 résultat`);
    continue;
  }
  const d = describe(items);
  console.log(`khadinakbar ${label} → ${items.length} résultat(s) · ${d.fields} champs · galerie : ${d.galleries.join(", ") || "aucune"}`);
  await writeFile(".tmp/cmp-khadinakbar.json", JSON.stringify(items, null, 2));
  break;
}

/* ── google-lens ── */
const lens = [
  { searchTypes: ["products"], imageUrl: IMAGE },
  { searchTypes: ["products"], imageUrls: [IMAGE] },
  { searchTypes: ["products"], startUrls: [{ url: IMAGE }] },
];

for (const input of lens) {
  const r = await run("borderline~google-lens", input);
  const label = Object.keys(input).slice(1).join(",") || "vide";
  if (!r.ok) {
    console.log(`google-lens ${label} → HTTP ${r.status} ${r.text.slice(0, 160)}`);
    continue;
  }
  const items = JSON.parse(r.text);
  if (items.length === 0) {
    console.log(`google-lens ${label} → 0 résultat`);
    continue;
  }
  const d = describe(items);
  console.log(`google-lens ${label} → ${items.length} résultat(s) · ${d.fields} champs`);
  console.log(`   clés : ${Object.keys(items[0]).join(", ")}`);
  await writeFile(".tmp/cmp-googlelens.json", JSON.stringify(items, null, 2));
  break;
}
