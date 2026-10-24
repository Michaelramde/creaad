/**
 * Réconcilie les coûts Apify.
 *
 * `usageTotalUsd` est écrit avec un délai : une ligne peut valoir 0 alors que
 * l'appel a été facturé. Ce script relit les exécutions concernées et corrige
 * la table — le plafond quotidien redevient fiable.
 *
 *   node --env-file=.env.local scripts/reconcile-costs.mjs [--days=7]
 */
import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";

const env = await readFile(".env.local", "utf8");
const dbUrl = /^DATABASE_URL="?([^"\r\n]+)"?/m.exec(env)?.[1];
const token =
  process.env.APIFY_TOKEN ?? (await readFile(".secrets/apify_token.txt", "utf8")).trim();
const days = Number(process.argv.find((a) => a.startsWith("--days="))?.split("=")[1] ?? 7);

const pool = new Pool({ connectionString: dbUrl, max: 1 });
pool.on("error", (e) => console.error("db:", e.message));

const { rows } = await pool.query(
  `SELECT id, external_id, step, cost_usd FROM pipeline_costs
   WHERE provider = 'apify' AND external_id IS NOT NULL AND (estimated = true OR cost_usd = 0)
     AND created_at > now() - ($1 || ' days')::interval
   ORDER BY created_at DESC LIMIT 200`,
  [days],
);

console.log(`lignes à corriger : ${rows.length}`);

let corrected = 0;
let recoveredUsd = 0;

for (const row of rows) {
  try {
    const res = await fetch(
      `https://api.apify.com/v2/actor-runs/${row.external_id}?token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(20_000) },
    );
    if (!res.ok) continue;

    const run = (await res.json()).data;
    const cost = run?.usageTotalUsd ?? 0;
    if (cost <= 0) continue;

    await pool.query("UPDATE pipeline_costs SET cost_usd = $1, estimated = false WHERE id = $2", [
      cost.toFixed(6),
      row.id,
    ]);

    corrected += 1;
    recoveredUsd += cost;
  } catch (error) {
    console.error(`  ${row.external_id} : ${error.message}`);
  }
}

const total = await pool.query(
  `SELECT round(sum(cost_usd)::numeric, 4) AS total, count(*) AS n
   FROM pipeline_costs WHERE created_at > now() - interval '24 hours'`,
);

console.log(`\ncorrigées : ${corrected} · montant récupéré : ${recoveredUsd.toFixed(4)} $`);
console.log(`dépense sur 24 h (réelle, après correction) : ${total.rows[0].total} $ sur ${total.rows[0].n} appels`);

await pool.end();
