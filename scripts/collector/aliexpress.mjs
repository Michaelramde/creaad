/**
 * Enrichissement produit AliExpress — via `aliexpress-product-scraper`
 * (open source, sans clé API).
 *
 * Récupère exactement ce dont la planche a besoin : images, variantes,
 * prix, description — et les avis clients, qui alimentent les verbatims
 * du kit argumentaire.
 *
 *   node scripts/collector/aliexpress.mjs <url> [<url> ...] --archetype=beaute-serum-30ml
 *   node scripts/collector/aliexpress.mjs --file=.tmp/urls.txt --dry-run
 */
import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const archetypeSlug =
  args.find((a) => a.startsWith("--archetype="))?.split("=")[1] ?? "inconnu";
const fileArg = args.find((a) => a.startsWith("--file="))?.split("=")[1];

let urls = args.filter((a) => /^https?:\/\//.test(a));
if (fileArg) {
  const content = await readFile(fileArg, "utf8");
  urls = urls.concat(content.split("\n").map((l) => l.trim()).filter((l) => /^https?:\/\//.test(l)));
}
urls = [...new Set(urls)];

if (urls.length === 0) {
  console.error("Aucune URL AliExpress fournie.");
  process.exit(1);
}

let scraper;
try {
  /**
   * GitHub Actions (Ubuntu 23.10+) désactive les « user namespaces » non
   * privilégiés : Chromium refuse alors de démarrer avec
   * « FATAL: No usable sandbox! ». On force donc --no-sandbox sur l'instance
   * partagée de puppeteer-extra, AVANT d'importer le scraper.
   */
  const pe = await import("puppeteer-extra");
  const instance = pe.default ?? pe;
  if (instance?.launch && !instance.__creaadPatched) {
    const original = instance.launch.bind(instance);
    const extraArgs = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"];
    instance.launch = (options = {}) =>
      original({ ...options, args: [...(options.args ?? []), ...extraArgs] });
    instance.__creaadPatched = true;
  }

  const mod = await import("aliexpress-product-scraper");
  scraper = mod.default ?? mod;
} catch (error) {
  console.error("aliexpress-product-scraper absent :", error.message);
  console.error("→ npm i --no-save aliexpress-product-scraper");
  process.exit(1);
}

const pool = DRY_RUN ? null : new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const results = [];

for (const url of urls) {
  process.stdout.write(`→ ${url.slice(0, 70)}… `);
  try {
    const product = await scraper(url, { reviews_count: 20 });

    const images = (product.images ?? product.productImages ?? []).slice(0, 12);
    const reviews = (product.reviews ?? []).slice(0, 20).map((r) => ({
      author: r.author ?? r.name ?? null,
      rating: r.rating ?? r.star ?? null,
      text: r.text ?? r.content ?? null,
      date: r.date ?? null,
    }));

    console.log(
      `OK · ${images.length} image(s) · ${reviews.length} avis · ${(product.title ?? "").slice(0, 40)}`,
    );

    results.push({
      url,
      productId: product.productId ?? product.id ?? null,
      title: product.title ?? null,
      price: product.price ?? product.salePrice ?? null,
      variants: product.variants ?? null,
      specs: product.specs ?? product.attributes ?? null,
      description: (product.description ?? "").slice(0, 5000) || null,
      images,
      reviews,
    });
  } catch (error) {
    console.log(`ÉCHEC · ${error.message}`);
  }
}

console.log(`\n${results.length}/${urls.length} produit(s) récupéré(s).`);

if (DRY_RUN) {
  console.log("--dry-run : rien n'a été écrit.");
  const sample = results[0];
  if (sample) {
    console.log(JSON.stringify(sample, null, 2).slice(0, 1500));
  } else {
    console.log("Aucun produit récupéré — voir les erreurs ci-dessus.");
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}

let written = 0;
for (const product of results) {
  try {
    await pool.query(
      `INSERT INTO source_listings (provider, external_id, url, title, payload)
       VALUES ('aliexpress', $1, $2, $3, $4)
       ON CONFLICT (provider, external_id) DO UPDATE
         SET payload = EXCLUDED.payload, fetched_at = now()`,
      [
        String(product.productId ?? product.url),
        product.url,
        product.title,
        JSON.stringify({ archetypeSlug, ...product }),
      ],
    );
    written += 1;
  } catch (error) {
    console.warn(`  ! écriture échouée (${product.url}) : ${error.message}`);
  }
}

await pool?.end();
console.log(`${written} produit(s) enregistré(s) dans source_listings.`);
