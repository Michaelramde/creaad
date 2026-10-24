/**
 * Vérifie la chaîne d'identification produit de bout en bout, avec les vrais
 * acteurs. Premier passage : payant. Second : doit être gratuit (cache).
 */
import { createProviders } from "@/lib/providers";
import { identifyProduct } from "@/lib/pipeline/identify-product";
import { factsForPrompt } from "@/lib/products/corroborate";

const IMAGE = "https://ae-pic-a1.aliexpress-media.com/kf/S2d87e1462eb74ca8b832bca36cad86eeW.jpg";

const providers = createProviders();
if (!providers.productPipeline) {
  console.error("APIFY_TOKEN absent — chaîne payante indisponible.");
  process.exit(1);
}

for (const pass of [1, 2]) {
  const started = Date.now();
  const result = await identifyProduct(providers.productPipeline, { imageUrl: IMAGE });

  console.log(`\n═══ passage ${pass} ═══ ${((Date.now() - started) / 1000).toFixed(0)} s`);
  if (!result) {
    console.log("aucun produit trouvé");
    continue;
  }

  console.log(`produit   : ${result.hit.productId} · ${result.record.title.slice(0, 58)}`);
  console.log(`confiance : rang ${result.hit.rank} · isBestMatch=${result.hit.isBestMatch} · cache=${result.cached}`);
  console.log(`prix      : ${result.record.price ?? "—"} ${result.record.currency ?? ""} · note ${result.record.rating ?? "—"}`);
  console.log(`galerie   : ${result.record.gallery.length} images · pool ${result.record.images.length}`);
  console.log(`specs     : ${Object.keys(result.record.specs).length} champs`);
  console.log(`coloris   : ${result.needsVariantChoice ? "choix requis" : "aucun choix"}`);

  for (const axis of result.record.variantAxes) {
    console.log(`   ${axis.axis} :`);
    for (const value of axis.values) {
      const stock = value.available ? `${value.stock} en stock` : "épuisé";
      console.log(`      ${value.name.padEnd(16)} ${stock.padEnd(14)} ${value.image ? "image ✓" : "sans image"}`);
    }
  }

  console.log("faits :");
  for (const [field, fact] of Object.entries(result.facts)) {
    const value = Array.isArray(fact.value) ? fact.value.join("×") : fact.value;
    console.log(`   ${field.padEnd(22)} ${String(value).slice(0, 30).padEnd(32)} ${fact.confidence} (${fact.sources.join(", ")})`);
  }
  console.log(`prompt dims : ${factsForPrompt(result.facts) || "(rien de fiable)"}`);
  console.log(`coût      : ${result.costUsd.toFixed(4)} $`);
  if (result.warnings.length > 0) console.log(`alertes   : ${result.warnings.join(" | ")}`);
}
