import assert from "node:assert/strict";
import { test } from "node:test";

import { assertableFacts, corroborate, factsForPrompt } from "../src/lib/products/corroborate.ts";
import { buildImagePool, normalizeVariants, topImages } from "../src/lib/products/normalize.ts";
import {
  factsFromProduct,
  parseDimensions,
  parseNamedFacts,
} from "../src/lib/products/parse-facts.ts";
import { isProductAxis, needsVariantChoice } from "../src/lib/products/types.ts";

/* ── dimensions ─────────────────────────────────────────────────────────── */

test("dimensions : contenance en ml, cl, l et oz", () => {
  assert.equal(parseDimensions(["Sérum 30ML"]).volumeMl, 30);
  assert.equal(parseDimensions(["flacon 50 cl"]).volumeMl, 500);
  assert.equal(parseDimensions(["bouteille 1 L"]).volumeMl, 1000);
  assert.equal(parseDimensions(["1 oz"]).volumeMl, 29.6);
});

test("dimensions : un pourcentage n'est pas une contenance", () => {
  assert.equal(parseDimensions(["Hyaluronic Acid 2% + B5"]).volumeMl, undefined);
});

test("dimensions : le triplet est normalisé en millimètres", () => {
  assert.deepEqual(parseDimensions(["25 x 18 x 8 cm"]).lengthWidthHeightMm, [250, 180, 80]);
  assert.deepEqual(parseDimensions(["300×200×100 mm"]).lengthWidthHeightMm, [300, 200, 100]);
});

test("dimensions : une mesure seule ne fait pas un volume", () => {
  const dimensions = parseDimensions(["12 inch"]);
  assert.equal(dimensions.lengthWidthHeightMm, undefined);
  assert.equal(dimensions.volumeMl, undefined);
});

test("dimensions : poids en grammes et kilogrammes", () => {
  assert.equal(parseDimensions(["poids 500g"]).weightG, 500);
  assert.equal(parseDimensions(["1,2 kg"]).weightG, 1200);
});

test("dimensions : absence totale → objet vide, jamais d'estimation", () => {
  assert.deepEqual(parseDimensions(["Sac en cuir pour homme"]), {});
  assert.deepEqual(parseDimensions([]), {});
});

/* ── faits nommés ───────────────────────────────────────────────────────── */

test("faits nommés : matière, marque et modèle depuis les spécifications", () => {
  const named = parseNamedFacts({
    "Brand Name": "jeep buluo",
    "Model Number": "jeep 597",
    Material: "PU",
  });
  assert.equal(named.brand, "jeep buluo");
  assert.equal(named.model, "jeep 597");
  assert.equal(named.material, "PU");
});

test("faits nommés : rien à lire → rien à affirmer", () => {
  assert.deepEqual(parseNamedFacts({ Shape: "Shell" }), {});
});

test("factsFromProduct combine titre et spécifications", () => {
  const facts = factsFromProduct({
    title: "Sérum visage 30 ml",
    specs: { Material: "verre", "Brand Name": "Acme" },
  });
  assert.equal(facts.volumeMl, 30);
  assert.equal(facts.material, "verre");
  assert.equal(facts.brand, "Acme");
});

/* ── corroboration ──────────────────────────────────────────────────────── */

test("corroboration : deux sources concordantes → corroboré", () => {
  const facts = corroborate([
    { source: "aliexpress", facts: { volumeMl: 30 } },
    { source: "alibaba", facts: { volumeMl: 30 } },
  ]);
  assert.equal(facts.volumeMl?.confidence, "corroboré");
  assert.deepEqual(facts.volumeMl?.sources, ["aliexpress", "alibaba"]);
});

test("corroboration : une seule source → unique", () => {
  const facts = corroborate([{ source: "aliexpress", facts: { material: "PU" } }]);
  assert.equal(facts.material?.confidence, "unique");
  assert.deepEqual(facts.material?.sources, ["aliexpress"]);
});

test("corroboration : désaccord → contradictoire, écarté des kits", () => {
  const facts = corroborate([
    { source: "aliexpress", facts: { volumeMl: 30 } },
    { source: "alibaba", facts: { volumeMl: 50 } },
  ]);
  assert.equal(facts.volumeMl?.confidence, "contradictoire");
  assert.deepEqual(facts.volumeMl?.conflicts, [50]);
  assert.equal(assertableFacts(facts).volumeMl, undefined);
});

test("corroboration : deux sources contre une l'emportent", () => {
  const facts = corroborate([
    { source: "aliexpress", facts: { volumeMl: 30 } },
    { source: "alibaba", facts: { volumeMl: 30 } },
    { source: "avis", facts: { volumeMl: 50 } },
  ]);
  assert.equal(facts.volumeMl?.confidence, "corroboré");
  assert.equal(facts.volumeMl?.value, 30);
});

test("corroboration : les dimensions se comparent à une permutation près", () => {
  const facts = corroborate([
    { source: "aliexpress", facts: { lengthWidthHeightMm: [250, 180, 80] } },
    { source: "alibaba", facts: { lengthWidthHeightMm: [80, 250, 180] } },
  ]);
  assert.equal(facts.lengthWidthHeightMm?.confidence, "corroboré");
});

test("corroboration : 5 % de tolérance, pas 20 %", () => {
  const proche = corroborate([
    { source: "a", facts: { volumeMl: 30 } },
    { source: "b", facts: { volumeMl: 31 } },
  ]);
  assert.equal(proche.volumeMl?.confidence, "corroboré");

  const loin = corroborate([
    { source: "a", facts: { volumeMl: 30 } },
    { source: "b", facts: { volumeMl: 45 } },
  ]);
  assert.equal(loin.volumeMl?.confidence, "contradictoire");
});

test("prompt : les dimensions corroborées s'injectent, les autres se taisent", () => {
  const facts = corroborate([
    { source: "aliexpress", facts: { volumeMl: 30, lengthWidthHeightMm: [120, 60, 60] } },
    { source: "alibaba", facts: { volumeMl: 30 } },
  ]);
  const prompt = factsForPrompt(facts);
  assert.match(prompt, /30 ml/);
  assert.match(prompt, /12 × 6 × 6 cm/);
});

test("prompt : aucune dimension fiable → aucun chiffre inventé", () => {
  assert.equal(factsForPrompt({}), "");
  const contradictoire = corroborate([
    { source: "a", facts: { volumeMl: 30 } },
    { source: "b", facts: { volumeMl: 90 } },
  ]);
  assert.equal(factsForPrompt(contradictoire), "");
});

/* ── variantes ──────────────────────────────────────────────────────────── */

test("variantes : la logistique est exclue des axes produit", () => {
  assert.equal(isProductAxis("Color"), true);
  assert.equal(isProductAxis("Size"), true);
  assert.equal(isProductAxis("Ships From"), false);
  assert.equal(isProductAxis("Expédition depuis"), false);
});

test("variantes : stock cumulé et disponibilité par coloris", () => {
  const { axes, variants } = normalizeVariants(
    [{ name: "Color", values: [{ name: "Noir", valueId: "1", image: "a.jpg" }, { name: "Marron", valueId: "2" }] }],
    [
      { skuId: "s1", options: [{ name: "Color", value: "Noir" }], salable: true, stock: 10 },
      { skuId: "s2", options: [{ name: "Color", value: "Noir" }], salable: false, stock: 99 },
      { skuId: "s3", options: [{ name: "Color", value: "Marron" }], salable: true, stock: 0 },
    ],
  );

  assert.equal(axes.length, 1);
  assert.equal(axes[0]?.values[0]?.stock, 10);
  assert.equal(axes[0]?.values[0]?.available, true);
  assert.equal(axes[0]?.values[1]?.available, false);
  assert.equal(variants.length, 3);
});

test("variantes : un seul coloris disponible → aucun écran à afficher", () => {
  const unSeul = [{ axis: "Color", values: [{ valueId: "1", name: "Noir", available: true, stock: 5 }] }];
  assert.equal(needsVariantChoice(unSeul), false);

  const deux = [
    {
      axis: "Color",
      values: [
        { valueId: "1", name: "Noir", available: true, stock: 5 },
        { valueId: "2", name: "Marron", available: true, stock: 3 },
      ],
    },
  ];
  assert.equal(needsVariantChoice(deux), true);
});

/* ── pool d'images ──────────────────────────────────────────────────────── */

test("pool : le coloris est épinglé avant la galerie", () => {
  const pool = buildImagePool({
    gallery: [
      { url: "g1.jpg", origin: "gallery" },
      { url: "g2.jpg", origin: "gallery" },
    ],
    variantImages: ["v1.jpg"],
  });
  assert.equal(pool[0]?.url, "v1.jpg");
  assert.equal(pool[0]?.origin, "variant");
  assert.equal(pool.length, 3);
});

test("pool : dédoublonnage et ordre des origines", () => {
  const pool = buildImagePool({
    gallery: [{ url: "g1.jpg", origin: "gallery", width: 960, height: 960 }],
    variantImages: ["g1.jpg"],
    reviewImages: ["r1.jpg"],
    supplierImages: ["s1.jpg"],
  });
  assert.equal(pool.length, 3);
  const top = topImages(pool, 3);
  assert.equal(top[0]?.origin, "variant");
  assert.equal(top[1]?.origin, "review");
  assert.equal(top[2]?.origin, "supplier");
});

test("pool : jamais plus de six vues envoyées au classificateur", () => {
  const gallery = Array.from({ length: 10 }, (_, i) => ({
    url: `g${i}.jpg`,
    origin: "gallery" as const,
  }));
  assert.equal(topImages(buildImagePool({ gallery }), 6).length, 6);
});
