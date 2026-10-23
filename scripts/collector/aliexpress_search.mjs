/**
 * Découverte de produits AliExpress **sans navigateur**.
 *
 * Constaté : les pages de recherche `/w/wholesale-*.html` répondent en HTTP
 * simple (~750 Ko) et contiennent des dizaines d'identifiants produit.
 * Seule la page *détail* est rendue côté client — d'où le navigateur pour
 * l'enrichissement, mais pas pour la découverte.
 *
 *   node scripts/collector/aliexpress_search.mjs "vitamin c serum" [--limit=20]
 */
import { Pool } from "@neondatabase/serverless";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : 20;
const query = args.find((a) => !a.startsWith("--")) ?? "vitamin c serum";

const slug = query.trim().toLowerCase().replace(/\s+/g, "-");

const url = `https://www.aliexpress.com/w/wholesale-${encodeURIComponent(slug)}.html`;

console.log(`→ ${url}`);

const res = await fetch(url, {
  headers: { "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9" },
  signal: AbortSignal.timeout(30_000),
});

if (!res.ok) {
  console.error(`HTTP ${res.status}`);
  process.exit(1);
}

const html = await res.text();

/* Les annonces apparaissent sous la forme /item/<id>.html — on déduplique. */
const ids = [...new Set([...html.matchAll(/\/item\/(\d{8,20})\.html/g)].map((m) => m[1]))];

/* Les images et titres sont souvent présents en JSON dans la page. */
function nearbyTitle(id) {
  const index = html.indexOf(`/item/${id}.html`);
  if (index === -1) return undefined;
  const window = html.slice(index, index + 2500);
  const title = /"title":"([^"]{8,160})"/.exec(window)?.[1];
  const image = /"(?:img|image|imgUrl)":"(https:[^"]+\.(?:jpg|png|webp)[^"]*)"/.exec(window)?.[1];
  return { title: title?.replace(/\\u002F/g, "/") ?? undefined, image };
}

const products = ids.slice(0, limit).map((id) => {
  const extra = nearbyTitle(id);
  return {
    externalId: id,
    url: `https://www.aliexpress.com/item/${id}.html`,
    title: extra?.title ?? null,
    image: extra?.image ?? null,
  };
});

const withTitle = products.filter((p) => p.title).length;
console.log(
  `${ids.length} identifiant(s) trouvé(s) · ${products.length} retenu(s) · ${withTitle} avec titre`,
);

if (DRY_RUN) {
  console.log("\n--dry-run : rien n'a été écrit.");
  console.log(JSON.stringify(products.slice(0, 3), null, 2));
  process.exit(0);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
let written = 0;

for (const product of products) {
  try {
    await pool.query(
      `INSERT INTO source_listings (provider, external_id, url, title, payload)
       VALUES ('aliexpress', $1, $2, $3, $4)
       ON CONFLICT (provider, external_id) DO UPDATE
         SET title = COALESCE(EXCLUDED.title, source_listings.title),
             payload = EXCLUDED.payload,
             fetched_at = now()`,
      [
        product.externalId,
        product.url,
        product.title,
        JSON.stringify({ query, discoveredBy: "aliexpress_search", image: product.image }),
      ],
    );
    written += 1;
  } catch (error) {
    console.warn(`  ! ${product.externalId} : ${error.message}`);
  }
}

await pool.end();
console.log(`${written} produit(s) enregistré(s) dans source_listings.`);
