/**
 * Analyse de bout en bout, sans HTTP ni interface : exerce le pipeline
 * réel (Gemini + AliExpress + moteur marché) sur un produit qui existe
 * réellement dans les annonces collectées.
 *
 *   node --env-file=.env.local .tmp/e2e-analysis.mjs
 */
import { db } from "@/lib/db";
import { sourceListings } from "@/lib/db/schema";
import { createProviders } from "@/lib/providers";
import { runAnalysis } from "@/lib/pipeline/run-analysis";

const [listing] = await db.select().from(sourceListings).limit(1);
if (!listing) {
  console.error("Aucun listing en base — lance d'abord la collecte AliExpress.");
  process.exit(1);
}

const payload = listing.payload as { mainImage?: string };
const photo = payload.mainImage;
if (!photo) {
  console.error("Ce listing n'a pas d'image principale.");
  process.exit(1);
}

console.log(`produit de référence : ${listing.title?.slice(0, 60)}`);
console.log(`image                : ${photo.slice(0, 70)}…\n`);

const providers = createProviders();
console.log(
  `fournisseurs : ocr=${providers.ocr.name} · attrs=${providers.attributes.name} · ` +
    `vision=${providers.visual?.name ?? "—"} · slots=${providers.slots?.name ?? "—"} · ` +
    `sources=${providers.sources.map((s) => s.name).join(",")}`,
);

const started = Date.now();
const result = await runAnalysis(providers, {
  category: "beaute",
  regime: "non_detenu",
  country: "CI",
  photos: [{ url: photo, width: 1200, height: 1200 }],
  userText: listing.title ?? undefined,
});

const seconds = ((Date.now() - started) / 1000).toFixed(1);

console.log(`\n⏱  ${seconds} s`);
console.log(`archétype  : ${result.identify.archetype.slug}`);
console.log(`candidats  : ${result.identify.candidatesFound}`);
console.log(`score      : ${result.identify.match.score}/100 (couverture ${Math.round(result.identify.match.coverage * 100)} %)`);
console.log(`décision   : ${result.identify.match.accepted ? "accepté" : `bloqué — ${result.identify.match.gateReason}`}`);
for (const [key, component] of Object.entries(result.identify.match.components)) {
  console.log(
    `   ${key.padEnd(11)} ${String(Math.round(component.points)).padStart(2)}/${component.max} ` +
      `${component.evidence ? `(${component.detail})` : "(sans preuve)"}`,
  );
}

if (result.plan) {
  const { fidelity, assignments, missing } = result.plan.plan;
  console.log(`\nplanche    : ${fidelity.score}/100 · ${fidelity.gatePassed ? "validée" : `refusée (${fidelity.gate})`}`);
  console.log(`   vues reconnues : ${assignments.map((a) => a.slot.id).join(", ") || "aucune"}`);
  if (missing.length > 0) console.log(`   manquantes     : ${missing.join(", ")}`);
  if (fidelity.qualityNote) console.log(`   note           : ${fidelity.qualityNote}`);
}

if (result.market) {
  const { matrix, portfolio } = result.market;
  console.log(`\nmarché     : ${matrix.dataQuality.adsFound} annonces · ${matrix.dataQuality.distinctAdvertisers} annonceurs · ${matrix.dataQuality.confidence}`);
  if (!matrix.publishable) {
    console.log(`   non publiable — ${portfolio.message ?? ""}`);
  } else {
    for (const entry of portfolio.entries.slice(0, 5)) {
      console.log(
        `   ${entry.family.padEnd(19)} ${entry.action.padEnd(21)} ` +
          `${entry.figures.advertisers} ann. · ${Math.round(entry.figures.medianDaysRunning)} j`,
      );
    }
    if (portfolio.whiteSpace.length > 0) {
      console.log(`   espace blanc : ${portfolio.whiteSpace.map((e) => e.family).join(", ")}`);
    }
  }
}

if (result.warnings.length > 0) {
  console.log(`\navertissements :\n   ${result.warnings.join("\n   ")}`);
}

process.exit(result.identify.match.accepted ? 0 : 1);
