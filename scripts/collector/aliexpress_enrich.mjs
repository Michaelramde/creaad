/**
 * Enrichissement AliExpress **sans navigateur**.
 *
 * Constaté en production : le scraper basé sur Puppeteer échoue sur la page
 * produit (structure CSR + anti-bot), alors qu'une requête HTTP simple obtient
 * `og:title`, `og:image` et `og:description`. On prend ce qui est disponible,
 * on ne prétend pas avoir le reste.
 *
 * Ce qu'on gagne : titre exact, visuel principal, description — de quoi
 * alimenter l'appariement et la planche.
 * Ce qu'on n'a pas : prix, variantes, avis (il faudra l'API affiliée).
 *
 *   node scripts/collector/aliexpress_enrich.mjs --file=scripts/collector/products.txt
 *   node scripts/collector/aliexpress_enrich.mjs <url> --dry-run
 */
import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const fileArg = args.find((a) => a.startsWith("--file="))?.split("=")[1];

let urls = args.filter((a) => /^https?:\/\//.test(a));
if (fileArg) {
  const content = await readFile(fileArg, "utf8");
  urls = urls.concat(
    content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^https?:\/\//.test(l)),
  );
}
urls = [...new Set(urls)];

if (urls.length === 0) {
  console.error("Aucune URL fournie.");
  process.exit(1);
}

/**
 * AliExpress renvoie les IP de datacenter dans une boucle de redirections
 * (www → fr → gateway → …). `redirect: "follow"` s'y épuise.
 * On suit donc à la main, avec un pot à cookies : c'est ce qui casse la boucle
 * dans la plupart des cas.
 */
async function fetchWithCookies(startUrl, maxHops = 6) {
  let url = startUrl;
  let cookie = "";
  let lastResponse;

  for (let hop = 0; hop < maxHops; hop += 1) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "fr-FR,fr;q=0.9",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });

    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length > 0) {
      const jar = new Map(cookie ? cookie.split("; ").map((c) => [c.split("=")[0], c]) : []);
      for (const raw of setCookie) {
        const pair = raw.split(";")[0];
        if (pair) jar.set(pair.split("=")[0], pair);
      }
      cookie = [...jar.values()].join("; ");
    }

    lastResponse = res;
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) break;
      url = new URL(location, url).toString();
      continue;
    }
    break;
  }

  const html = lastResponse ? await lastResponse.text() : "";
  return { status: lastResponse?.status ?? 0, html, finalUrl: url };
}

const meta = (html, property) => {
  const re = new RegExp(`<meta property="${property}" content="([^"]*)"`, "i");
  return re.exec(html)?.[1]?.replace(/&amp;/g, "&") ?? null;
};

const results = [];

for (const url of urls) {
  const id = /\/item\/(\d+)\.html/.exec(url)?.[1] ?? url;
  process.stdout.write(`→ ${id}… `);
  try {
    const { status, html } = await fetchWithCookies(url);
    if (status !== 200) throw new Error(`HTTP ${status} après redirections`);

    const title = meta(html, "og:title");
    const image = meta(html, "og:image");
    const description = meta(html, "og:description");

    if (!title) throw new Error("aucune balise og:title (page probablement anti-bot)");

    console.log(`OK · ${title.slice(0, 45)}`);
    results.push({ id, url, title, image, description });
  } catch (error) {
    const cause = error?.cause?.code ?? error?.cause?.message ?? "";
    console.log(`ÉCHEC · ${error.message}${cause ? ` (${cause})` : ""}`);
  }
}

console.log(`\n${results.length}/${urls.length} produit(s) enrichi(s).`);

if (DRY_RUN) {
  console.log("--dry-run : rien n'a été écrit.");
  console.log(JSON.stringify(results[0] ?? null, null, 2).slice(0, 900));
  process.exit(results.length > 0 ? 0 : 1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL absente : le secret GitHub est vide ou mal nommé.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
// Sans ce gestionnaire, une erreur de connexion remonte en « Unhandled error »
// et tue le process sans message utile.
pool.on("error", (error) => console.error("connexion base :", error.message));
let written = 0;
let failed = 0;

for (const product of results) {
  try {
    await pool.query(
      `INSERT INTO source_listings (provider, external_id, url, title, payload)
       VALUES ('aliexpress', $1, $2, $3, $4)
       ON CONFLICT (provider, external_id) DO UPDATE
         SET title = COALESCE(EXCLUDED.title, source_listings.title),
             payload = EXCLUDED.payload,
             fetched_at = now()`,
      [
        product.id,
        product.url,
        product.title,
        JSON.stringify({
          mainImage: product.image,
          description: product.description,
          enrichedBy: "aliexpress_enrich",
        }),
      ],
    );
    written += 1;
  } catch (error) {
    failed += 1;
    console.warn(`  ! ${product.id} : ${error.message}`);
  }
}

await pool.end();
console.log(`${written} produit(s) enregistré(s), ${failed} échec(s).`);
// Rien écrit alors qu'on avait des produits = problème de base, pas de collecte.
process.exit(written > 0 || results.length === 0 ? 0 : 1);
