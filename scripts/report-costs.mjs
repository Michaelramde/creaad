/**
 * Lecture des coûts réels — l'arbitre des chiffres contradictoires.
 *
 *   node --env-file=.env.local scripts/report-costs.mjs [jours]
 *
 * Le dépôt annonce 0,02 $ ET 0,101 $ pour la même recherche par image.
 * Ce script lit pipeline_costs, seule source factuelle.
 */
import { Pool } from "@neondatabase/serverless";

const days = Number.parseInt(process.argv[2] ?? "30", 10);
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL absente — lancer avec --env-file=.env.local");
  process.exit(1);
}

const XOF_PER_USD = 600;
const pool = new Pool({ connectionString: url, max: 1 });

try {
  const byStep = await pool.query(
    `SELECT step,
            coalesce(provider, '—')           AS provider,
            count(*)                          AS appels,
            round(avg(cost_usd)::numeric, 5)  AS cout_moyen_usd,
            round(sum(cost_usd)::numeric, 4)  AS cout_total_usd,
            sum((estimated)::int)             AS estimees
     FROM pipeline_costs
     WHERE created_at > now() - ($1 || ' days')::interval
     GROUP BY step, provider
     ORDER BY sum(cost_usd) DESC`,
    [String(days)],
  );

  const delivery = await pool.query(
    `SELECT (SELECT count(*) FROM analyses WHERE status = 'livree') AS livrees,
            (SELECT coalesce(sum(cost_usd), 0) FROM pipeline_costs
              WHERE step <> 'payment_fee'
                AND created_at > now() - ($1 || ' days')::interval) AS cout_usd`,
    [String(days)],
  );

  const funnel = await pool.query("SELECT * FROM v_funnel");

  console.log(`\n=== Coûts des ${days} derniers jours ===`);
  if (byStep.rowCount === 0) {
    console.log("Aucune ligne : pipeline_costs est vide sur la période.");
  } else {
    for (const row of byStep.rows) {
      const xof = Math.round(Number(row.cout_moyen_usd) * XOF_PER_USD);
      console.log(
        String(row.step).padEnd(16) + " " +
        String(row.provider).padEnd(10) + " " +
        String(row.appels).padStart(5) + " appels · moy " +
        String(row.cout_moyen_usd).padStart(8) + " $ (≈ " + String(xof).padStart(4) + " F) · total " +
        String(row.cout_total_usd).padStart(9) + " $ · estimées " + row.estimees,
      );
    }
  }

  const d = delivery.rows[0];
  const livrees = Number(d.livrees);
  const cout = Number(d.cout_usd);
  console.log(
    "\nLivraisons : " + livrees +
    " · coût total : " + cout.toFixed(4) + " $" +
    " · par livraison : " +
    (livrees === 0 ? "n/a" : (cout / livrees).toFixed(5) + " $ (≈ " + Math.round((cout / livrees) * XOF_PER_USD) + " F)"),
  );

  console.log("\n=== Funnel ===");
  console.log(funnel.rows[0]);
} finally {
  await pool.end();
}
