/**
 * Normalise un JSONL d'annonces (produit par meta_search.py ou par un
 * collecteur tiers) et l'écrit dans `ad_observations`.
 *
 *   node scripts/collector/normalize.mjs .tmp/ads.jsonl
 *   node scripts/collector/normalize.mjs .tmp/ads.jsonl --dry-run
 *
 * Règles : une ligne sans URL ou sans annonceur est écartée et comptée.
 * Aucune valeur n'est inventée pour compléter un champ manquant.
 */
import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";

const file = process.argv[2] ?? ".tmp/ads.jsonl";
const DRY_RUN = process.argv.includes("--dry-run");

const lines = (await readFile(file, "utf8"))
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

const kept = [];
const dropped = { sans_url: 0, sans_annonceur: 0, json_invalide: 0 };

for (const line of lines) {
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    dropped.json_invalide += 1;
    continue;
  }
  if (!row.url || !/^https?:\/\//.test(row.url)) {
    dropped.sans_url += 1;
    continue;
  }
  if (!row.advertiserId) {
    dropped.sans_annonceur += 1;
    continue;
  }
  kept.push(row);
}

const byArchetype = kept.reduce((acc, r) => {
  const key = `${r.platform}:${r.archetypeSlug}`;
  acc[key] = (acc[key] ?? 0) + 1;
  return acc;
}, {});

console.log(`${lines.length} ligne(s) lue(s) · ${kept.length} retenue(s)`);
console.log(`écartées : ${JSON.stringify(dropped)}`);
console.log(`par archétype : ${JSON.stringify(byArchetype)}`);

if (DRY_RUN) {
  console.log("\n--dry-run : rien n'a été écrit.");
  console.log(JSON.stringify(kept.slice(0, 2), null, 2));
  process.exit(0);
}

if (kept.length === 0) {
  console.log("Rien à écrire.");
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL absente : le secret GitHub est vide ou mal nommé.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
let written = 0;

for (const row of kept) {
  try {
    await pool.query(
      `INSERT INTO ad_observations
         (archetype_slug, country, platform, advertiser_id, advertiser_name,
          hook, start_date, end_date, is_active, url, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (platform, url) DO UPDATE
         SET is_active = EXCLUDED.is_active,
             end_date = EXCLUDED.end_date,
             hook = COALESCE(EXCLUDED.hook, ad_observations.hook),
             collected_at = now()`,
      [
        row.archetypeSlug,
        (row.country ?? "CI").toUpperCase(),
        row.platform,
        String(row.advertiserId),
        row.advertiserName ?? null,
        row.hook ?? null,
        row.startDate ? new Date(row.startDate) : null,
        row.endDate ? new Date(row.endDate) : null,
        row.isActive ?? true,
        row.url,
        row.source ?? "collector",
      ],
    );
    written += 1;
  } catch (error) {
    console.warn(`  ! écriture échouée (${row.url}) : ${error.message}`);
  }
}

await pool.end();
console.log(`${written} ligne(s) enregistrée(s) dans ad_observations.`);
