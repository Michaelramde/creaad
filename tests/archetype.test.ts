import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildArchetype,
  detectCategory,
  detectNoun,
  extractCapacity,
} from "../src/lib/archetype/extract.ts";
import { extractColorName, parseVariantLabel } from "../src/lib/matching/variant.ts";

test("catégorie détectée par mots-clés", () => {
  assert.equal(detectCategory("Sérum Vitamine C 30 ml"), "beaute");
  assert.equal(detectCategory("Perruque lace frontale 18 pouces"), "cheveux");
  assert.equal(detectCategory("Robe wax longue"), "mode");
  assert.equal(detectCategory("Écouteurs Bluetooth"), "gadgets");
  assert.equal(detectCategory("objet non identifié"), undefined);
});

test("le nom retenu est le mot-clé le plus spécifique", () => {
  assert.equal(detectNoun("mini fer a lisser", "gadgets"), "mini fer");
  assert.equal(detectNoun("huile capillaire de coco", "cheveux"), "huile capillaire");
});

test("contenance et longueur normalisées", () => {
  assert.equal(extractCapacity("Sérum 30 ml"), "30ml");
  assert.equal(extractCapacity("flacon 50ML"), "50ml");
  assert.equal(extractCapacity("perruque 18 pouces"), "18pouce");
  assert.equal(extractCapacity("lot de 2 pièces"), "2pc");
  assert.equal(extractCapacity("sans unité"), undefined);
});

test("archétype : slug stable et catégorie de repli", () => {
  const a = buildArchetype({ text: "Sérum Vitamine C 30 ml", fallbackCategory: "mode" });
  assert.equal(a.category, "beaute");
  assert.equal(a.slug, "beaute-serum-30ml");
  assert.equal(a.label, "Serum 30ml");

  const fallback = buildArchetype({ text: "truc inconnu", fallbackCategory: "gadgets" });
  assert.equal(fallback.category, "gadgets");
  assert.equal(fallback.slug, "gadgets-produit");
});

test("archétype : même produit écrit différemment → même slug", () => {
  const a = buildArchetype({ text: "SERUM vitamine c 30ml", fallbackCategory: "beaute" });
  const b = buildArchetype({ text: "Sérum   Vitamine C — 30 ML", fallbackCategory: "beaute" });
  assert.equal(a.slug, b.slug);
});

test("variante : couleur, taille et contenance lues dans un libellé libre", () => {
  const v = parseVariantLabel("Noir, 30 ml");
  assert.equal(v.colorName, "black");
  assert.equal(v.capacity, "30ml");

  assert.equal(extractColorName("BLEU ciel"), "blue");
  assert.equal(parseVariantLabel("taille XL").size, "XL");
  assert.equal(parseVariantLabel("42").size, "42");
});

test("variante vide quand le libellé est absent", () => {
  assert.deepEqual(parseVariantLabel(undefined), {});
});
