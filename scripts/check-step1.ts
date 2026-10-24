/** Étape 1 sur le vrai produit : images, specs, dimensions, avis. */
import { createProviders } from "@/lib/providers";
import { identifyProduct } from "@/lib/pipeline/identify-product";
import { factsForPrompt } from "@/lib/products/corroborate";

const IMAGE = "https://ae-pic-a1.aliexpress-media.com/kf/S2d87e1462eb74ca8b832bca36cad86eeW.jpg";

const providers = createProviders();
if (!providers.productPipeline) {
  console.error("chaîne payante indisponible");
  process.exit(1);
}

const started = Date.now();
const result = await identifyProduct(providers.productPipeline, { imageUrl: IMAGE });
console.log(`durée : ${((Date.now() - started) / 1000).toFixed(0)} s · coût ${(result?.costUsd ?? 0).toFixed(4)} $`);

if (!result) process.exit(1);

const record = result.record;
const byOrigin = record.images.reduce<Record<string, number>>((acc, image) => {
  acc[image.origin] = (acc[image.origin] ?? 0) + 1;
  return acc;
}, {});

console.log(`\nproduit : ${record.title.slice(0, 55)}`);
console.log(`images  : ${record.images.length} au total → ${JSON.stringify(byOrigin)}`);
console.log(`galerie : ${record.gallery.length} · description : ${record.descriptionUrl ? "récupérée" : "absente"}`);
console.log(`specs   : ${Object.keys(record.specs).length} champs`);
console.log(`avis    : ${record.reviews.length} · notes ${record.reviews.map((r) => r.rating).join(",")}`);
console.log(`   photos d'avis : ${record.reviews.filter((r) => r.images.length > 0).length}`);
console.log(`   pays : ${[...new Set(record.reviews.map((r) => r.buyerCountry).filter(Boolean))].join(", ")}`);
console.log(`   ex. : « ${record.reviews[0]?.text.slice(0, 80) ?? "—"} »`);
console.log(`\ndimensions : ${factsForPrompt(result.facts) || "(rien de fiable)"}`);
console.log(`coloris    : ${record.variantAxes[0]?.values.map((v) => v.name).join(" · ") ?? "—"}`);
