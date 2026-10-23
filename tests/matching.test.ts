import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canonicalColor,
  computeMatch,
  MATCH_THRESHOLD,
  pickBest,
  rankCandidates,
  VISUAL_CEIL,
  WEIGHTS,
} from "../src/lib/matching/score.ts";
import { centroid, cosine, jaccard, tokenSet } from "../src/lib/matching/text.ts";
import type { ListingCandidate } from "../src/lib/matching/types.ts";

const candidate = (over: Partial<ListingCandidate> = {}): ListingCandidate => ({
  provider: "test",
  externalId: "ext-1",
  url: "https://example.test/p/1",
  title: "Serum Vitamine C 30 ml",
  attributes: { color: "jaune", category: "beaute", form: "flacon" },
  variant: { colorName: "jaune", capacity: "30ml" },
  images: [{ url: "https://example.test/i/1.jpg" }],
  embedding: [1, 0, 0],
  ...over,
});

const base = {
  userText: "serum vitamine c 30 ml",
  userEmbedding: [1, 0, 0],
  userAttributes: { color: "jaune", category: "beaute" as const, form: "flacon" },
  userVariant: { colorName: "jaune", capacity: "30ml" },
};

test("cosinus : null quand la mesure est absente", () => {
  assert.equal(cosine(undefined, [1, 0]), null);
  assert.equal(cosine([], [1]), null);
  assert.equal(cosine([0, 0], [1, 0]), null);
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.ok(Math.abs((cosine([1, 0], [0, 1]) ?? 0)) < 1e-12);
});

test("jaccard : 0 si l'un des ensembles est vide", () => {
  assert.equal(jaccard(new Set(), new Set(["a"])), 0);
  assert.equal(jaccard(tokenSet("serum c"), tokenSet("serum c")), 1);
});

test("centroid : moyenne des vecteurs valides", () => {
  assert.deepEqual(centroid([[1, 0], [0, 1]]), [0.5, 0.5]);
  assert.equal(centroid([]), undefined);
});

test("correspondance parfaite → 100, acceptée", () => {
  const r = computeMatch({ ...base, candidate: candidate() });
  assert.equal(r.score, 100);
  assert.equal(r.coverage, 1);
  assert.equal(r.accepted, true);
  assert.equal(r.gateReason, "ACCEPTED");
});

test("sans aucune preuve : score 0, couverture 0, refus pour preuve insuffisante", () => {
  const r = computeMatch({
    userText: "",
    candidate: candidate({ attributes: {}, variant: {}, embedding: undefined }),
  });
  assert.equal(r.score, 0);
  assert.equal(r.coverage, 0);
  assert.equal(r.accepted, false);
  assert.equal(r.gateReason, "INSUFFICIENT_EVIDENCE");
});

test("l'OCR seul ne suffit jamais à accepter un article", () => {
  // Texte parfait, mais aucune image, aucun attribut, aucune variante :
  // la couverture tombe à 25 % et l'article est refusé faute de preuve.
  const r = computeMatch({
    userText: "Serum Vitamine C 30 ml",
    candidate: candidate({ attributes: {}, variant: {}, embedding: undefined }),
  });
  assert.equal(r.score, WEIGHTS.ocr);
  assert.ok(r.score < MATCH_THRESHOLD);
  assert.equal(r.coverage, WEIGHTS.ocr / 100);
  assert.equal(r.gateReason, "INSUFFICIENT_EVIDENCE");
  assert.equal(r.accepted, false);
});

test("une variante différente fait chuter le score", () => {
  const good = computeMatch({ ...base, candidate: candidate() });
  const wrongColor = computeMatch({
    ...base,
    candidate: candidate({ variant: { colorName: "rouge", capacity: "30ml" } }),
  });
  assert.ok(wrongColor.score < good.score);
  assert.match(wrongColor.components.variant.detail, /1\/2/);
});

test("une information absente ne crédite pas de points", () => {
  const full = computeMatch({ ...base, candidate: candidate() });
  const noVariant = computeMatch({
    ...base,
    candidate: candidate({ variant: {} }),
  });
  assert.ok(noVariant.score < full.score);
  assert.equal(noVariant.components.variant.evidence, false);
  assert.equal(noVariant.components.variant.points, 0);
});

test("similarité visuelle sous le plancher → 0 point visuel", () => {
  const r = computeMatch({
    ...base,
    userEmbedding: [1, 0, 0],
    candidate: candidate({ embedding: [0.6, 0.8, 0] }), // cos = 0.6 → sous 0.45 ? non
  });
  // cos(1,0,0 ; 0.6,0.8,0) = 0.6 → au-dessus du plancher, crédit partiel
  assert.ok(r.components.visual.points > 0);
  assert.ok(r.components.visual.points < WEIGHTS.visual);

  const low = computeMatch({
    ...base,
    userEmbedding: [1, 0, 0],
    candidate: candidate({ embedding: [0, 1, 0] }), // cos = 0
  });
  assert.equal(low.components.visual.points, 0);
  assert.equal(low.components.visual.evidence, true); // mesuré, mais nul
});

test("palier visuel : au-delà du plafond de calibration, le crédit est complet", () => {
  const r = computeMatch({
    ...base,
    userEmbedding: [1, 0],
    candidate: candidate({ embedding: [1, 0] }),
  });
  assert.equal(r.components.visual.points, WEIGHTS.visual);
  assert.ok(VISUAL_CEIL < 1);
});

test("le classement retient le meilleur candidat", () => {
  const ranked = rankCandidates(base, [
    candidate({ externalId: "mauvais", variant: { colorName: "noir" }, attributes: { category: "gadgets" }, embedding: [0, 1, 0], title: "Chargeur USB" }),
    candidate({ externalId: "bon" }),
  ]);
  assert.equal(ranked[0]?.candidate?.externalId, "bon");
  assert.equal(ranked[1]?.candidate?.externalId, "mauvais");
});

test("aucun candidat → NO_CANDIDATE, jamais une acceptation par défaut", () => {
  const r = pickBest(base, []);
  assert.equal(r.gateReason, "NO_CANDIDATE");
  assert.equal(r.accepted, false);
  assert.equal(r.candidate, undefined);
});

test("les couleurs FR/EN sont canonisées", () => {
  assert.equal(canonicalColor("Noir"), "black");
  assert.equal(canonicalColor("black"), "black");
  assert.equal(canonicalColor("Doré"), "gold");
  assert.equal(canonicalColor(""), undefined);
});
