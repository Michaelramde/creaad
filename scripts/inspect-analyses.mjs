import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";

const envText = await readFile(".env.local", "utf8");
const url = /^DATABASE_URL="?([^"\n]+)"?/m.exec(envText)?.[1];
const pool = new Pool({ connectionString: url, max: 1 });
pool.on("error", (e) => console.error("db:", e.message));

const rows = await pool.query(`
  SELECT a.id, a.status, a.archetype_slug, a.country, a.match_score, a.match_coverage,
         a.failure_code, a.match_result, a.created_at,
         p.category, p.regime, p.name, p.variant_label
  FROM analyses a
  LEFT JOIN products p ON p.id = a.product_id
  ORDER BY a.created_at DESC
  LIMIT 6
`);

console.log(`${rows.rowCount} analyse(s) récente(s)\n`);

for (const row of rows.rows) {
  console.log("═".repeat(70));
  console.log(`${row.created_at.toISOString().slice(0, 16)} · ${row.status} · ${row.archetype_slug ?? "—"}`);
  console.log(`catégorie=${row.category} régime=${row.regime} · nom="${row.name ?? "—"}"`);
  console.log(`score=${row.match_score} couverture=${row.match_coverage} · ${row.failure_code ?? ""}`);

  const m = row.match_result;
  if (m?.components) {
    for (const [key, c] of Object.entries(m.components)) {
      console.log(`   ${key.padEnd(11)} ${String(Math.round(c.points)).padStart(2)}/${c.max} ${c.evidence ? `(${c.detail})` : "(sans preuve)"}`);
    }
  }
  if (m?.candidate) console.log(`   retenu : ${m.candidate.title?.slice(0, 70)}`);
  if (m?.gateReason) console.log(`   raison : ${m.gateReason}`);
  console.log();
}

/* Les produits des analyses récentes, pour voir ce qui a été photographié */
const plans = await pool.query(`
  SELECT pl.analysis_id, pl.fidelity_score, pl.gate_passed, pl.gate_reason,
         pl.quality_note, pl.breakdown, count(pi.id) AS images
  FROM plans pl LEFT JOIN plan_images pi ON pi.plan_id = pl.id
  GROUP BY pl.id ORDER BY pl.created_at DESC LIMIT 4
`);
if (plans.rowCount > 0) {
  console.log("── planches ──");
  for (const p of plans.rows) {
    console.log(
      `${p.analysis_id.slice(0, 8)} · ${p.fidelity_score}/100 · ${p.gate_passed ? "validée" : p.gate_reason} · ${p.images} image(s) · ${JSON.stringify(p.breakdown)}`,
    );
    if (p.quality_note) console.log(`   ${p.quality_note}`);
  }
}

await pool.end();
