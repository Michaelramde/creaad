/** Échelle d'élargissement sur le vrai produit : palier, annonces, coût, cache. */
import { createProviders } from "@/lib/providers";
import { getFreshRecord } from "@/lib/products/records";
import { buildQuery, findProductAds } from "@/lib/market/product-market";

const PRODUCT = "1005001843831532";

// Faits déjà mesurés pour ce produit : on évite de repayer la fiche.
const FALLBACK = {
  title: "JEEP BULUO Messenger Bags Mens Large Capacity Chest Sling Split Leather Bag",
  facts: { brand: { value: "jeep buluo" }, model: { value: "jeep 597" } },
  archetypeSlug: "mode-sac",
};

const record = (await getFreshRecord("aliexpress", PRODUCT)) ?? FALLBACK;
const facts = record.facts as Record<string, { value?: unknown } | undefined>;

const input = {
  productRef: PRODUCT,
  archetypeSlug: record.archetypeSlug ?? "mode-sac",
  country: "CI",
  brand: String(facts.brand?.value ?? ""),
  model: String(facts.model?.value ?? ""),
  category: "mode",
};

console.log(`produit   : ${String(record.title).slice(0, 52)}`);
console.log(`marque    : ${input.brand || "—"} · modèle : ${input.model || "—"}`);
console.log(`requête   : « ${buildQuery(input)} »`);
console.log(`archétype : ${input.archetypeSlug}\n`);

const providers = createProviders();

for (const pass of [1, 2]) {
  const started = Date.now();
  const result = await findProductAds(input, providers.productPipeline?.metaAds, {});
  console.log(
    `passage ${pass} · ${((Date.now() - started) / 1000).toFixed(0)} s · palier ${result.scope} · ${result.ads} annonce(s) · cache=${result.cached} · ${result.costUsd.toFixed(4)} $`,
  );
  console.log(`   ${result.message}`);
  if (result.markets.length > 0) console.log(`   marchés détectés : ${result.markets.join(", ")}`);
}
