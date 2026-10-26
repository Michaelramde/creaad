/**
 * Le texte n'est plus une condition déguisée.
 *
 * L'audit du 26/10 a montré qu'avec l'ancien barème (40/25/20/15) un produit
 * sans nom saisi et sans étiquette lisible plafonnait à 60/100 pour un seuil de
 * 70 : aucune correspondance visuelle, même parfaite, ne pouvait aboutir. Ces
 * tests verrouillent la nouvelle règle — et surtout qu'elle ne laisse pas
 * passer un produit différent.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { computeMatch, MATCH_THRESHOLD, WEIGHTS } from "../src/lib/matching/score.ts";
import type { ListingCandidate } from "../src/lib/matching/types.ts";

const candidate = (over: Partial<ListingCandidate> = {}): ListingCandidate => ({
  provider: "test",
  externalId: "1",
  url: "https://example.com/1",
  title: "Sac à main femme cuir noir",
  images: [{ url: "https://example.com/1.jpg" }],
  attributes: { category: "mode" },
  ...over,
});

/** Produit sans aucun texte : ni nom saisi, ni OCR. */
const withoutText = (visualScore: number) =>
  computeMatch({
    userText: "",
    visualScore,
    userAttributes: { category: "mode" },
    candidate: candidate(),
  });

test("le barème laisse le visuel porter la décision", () => {
  assert.equal(WEIGHTS.visual, 55);
  assert.equal(WEIGHTS.visual + WEIGHTS.ocr + WEIGHTS.attributes + WEIGHTS.variant, 100);
});

test("correspondance visuelle quasi certaine, sans aucun texte → acceptée", () => {
  const result = withoutText(0.9);

  assert.equal(result.accepted, true, `score ${result.score}, raison ${result.gateReason}`);
  assert.ok(result.score >= MATCH_THRESHOLD);
  assert.ok(result.coverage >= 0.5, `couverture ${result.coverage}`);
  // L'OCR reste une preuve absente : elle ne doit pas être créditée.
  assert.equal(result.components.ocr.evidence, false);
  assert.equal(result.components.ocr.points, 0);
});

test("correspondance visuelle moyenne, sans texte → refusée", () => {
  const result = withoutText(0.7);

  assert.equal(result.accepted, false);
  assert.equal(result.gateReason, "SCORE_BELOW_THRESHOLD");
  assert.ok(result.score < MATCH_THRESHOLD);
});

test("un produit visuellement lointain reste refusé même bien décrit", () => {
  const result = computeMatch({
    userText: "sac à main femme cuir noir",
    textScore: 0.95,
    visualScore: 0.2,
    userAttributes: { category: "mode" },
    candidate: candidate(),
  });

  assert.equal(result.accepted, false);
  assert.ok(result.components.visual.points < WEIGHTS.visual * 0.2);
});

test("avec texte et visuel, le score maximal reste atteignable", () => {
  const result = computeMatch({
    userText: "sac à main femme cuir noir",
    textScore: 1,
    visualScore: 1,
    userAttributes: { category: "mode" },
    userVariant: { colorName: "noir" },
    candidate: candidate({ variant: { colorName: "noir" } }),
  });

  assert.equal(result.score, 100);
  assert.equal(result.coverage, 1);
  assert.equal(result.accepted, true);
});

test("aucune preuve du tout → refus pour preuve insuffisante", () => {
  const result = computeMatch({ userText: "", candidate: candidate() });

  assert.equal(result.score, 0);
  assert.equal(result.accepted, false);
  assert.equal(result.gateReason, "INSUFFICIENT_EVIDENCE");
});
