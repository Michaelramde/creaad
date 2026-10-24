/**
 * Rapport de marché réel : lit `ad_observations` et produit le portefeuille
 * d'angles. Exerce le moteur de saturation de bout en bout.
 *
 *   node --env-file=.env.local .tmp/report-market.mjs [slug] [pays]
 */
import { buildMatrixFor } from "@/lib/market/store";
import { auditPortfolio, buildPortfolio } from "@/lib/market/portfolio";

const slug = process.argv[2] ?? "beaute-serum-30ml";
const country = (process.argv[3] ?? "CI").toUpperCase();

const { matrix, report } = await buildMatrixFor(slug, country);
const portfolio = buildPortfolio(matrix);

console.log(`\n═══ ${slug} · ${country} ═══\n`);
console.log(`annonces lues      : ${report.total}`);
console.log(`retenues           : ${report.kept}`);
console.log(`non classées       : ${report.unclassified}`);
console.log(`échantillon        : ${matrix.dataQuality.adsFound} annonces · ${matrix.dataQuality.distinctAdvertisers} annonceurs`);
console.log(`confiance          : ${matrix.dataQuality.confidence}`);
console.log(`publiable          : ${matrix.publishable ? "oui" : "NON"}`);
if (matrix.dataQuality.gaps.length) {
  console.log(`lacunes            : ${matrix.dataQuality.gaps.join(" | ")}`);
}

if (!portfolio.publishable) {
  console.log(`\n${portfolio.message}`);
  process.exit(0);
}

console.log("\n── Portefeuille d'angles ──\n");
for (const entry of portfolio.entries) {
  const f = entry.figures;
  console.log(
    `${entry.family.padEnd(20)} ${entry.action.padEnd(22)} ` +
      `${String(f.ads).padStart(2)} ann. · ${String(f.advertisers).padStart(2)} annonceurs · ` +
      `${String(Math.round(f.medianDaysRunning)).padStart(3)} j méd.`,
  );
  console.log(`   ${entry.rationale.slice(0, 150)}`);
  if (entry.notes.length > 0) console.log(`   ⚠ ${entry.notes[0]?.slice(0, 130) ?? ""}`);
}

if (portfolio.whiteSpace.length) {
  console.log("\n── Espace blanc (prouvé ailleurs, absent ici) ──");
  for (const entry of portfolio.whiteSpace) console.log(`  ${entry.family}`);
}

const problems = auditPortfolio(portfolio);
console.log(`\nAudit : ${problems.length === 0 ? "aucun problème détecté" : problems.join(" | ")}`);
