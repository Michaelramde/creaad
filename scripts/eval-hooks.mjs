/**
 * Évaluation du classifieur de hooks sur les annonces réellement en base.
 *
 *   node --env-file=.env.local scripts/eval-hooks.mjs
 *
 * Affiche la distribution des familles sur l'échantillon collecté. Sert à
 * deux choses :
 *   1. repérer une famille qui absorbe tout (le symptôme du classifieur
 *      par sous-chaîne : 66 % de « preuve sociale » sur un corpus neutre) ;
 *   2. mesurer l'effet d'un changement de `LABEL_VERSION`.
 */
import { Pool } from "@neondatabase/serverless";
import { classifyHook } from "../src/lib/market/classify.ts";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

try {
  const { rows } = await pool.query(
    `SELECT archetype_slug, hook FROM ad_observations
     WHERE hook IS NOT NULL AND length(hook) > 20`,
  );

  const tally = new Map();
  let unclassified = 0;

  for (const row of rows) {
    const family = classifyHook(row.hook).family;
    if (family === "non-classe") unclassified += 1;
    tally.set(family, (tally.get(family) ?? 0) + 1);
  }

  const total = rows.length;
  console.log(`\n${total} annonces · ${unclassified} non classées (${((unclassified / total) * 100).toFixed(1)} %)\n`);

  for (const [family, count] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
    const share = ((count / total) * 100).toFixed(1);
    const bar = "█".repeat(Math.round((count / total) * 40));
    console.log(family.padEnd(20) + String(count).padStart(5) + "  " + share.padStart(5) + " %  " + bar);
  }
} finally {
  await pool.end();
}
