import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPlan, refusalMessage } from "../src/lib/planche/build.ts";
import { consensus, type SpecObservation } from "../src/lib/planche/consensus.ts";
import { computeFidelity } from "../src/lib/planche/fidelity.ts";
import { countDistinctSources, dhashFromGray, dedupe, hammingHex } from "../src/lib/planche/phash.ts";
import { scoreImage, selectForSlots, type CandidateImage } from "../src/lib/planche/select.ts";
import { REQUIRED_SLOTS, requiredSlots } from "../src/lib/planche/slots.ts";

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const W = 16;
const H = 16;

/** Dégradé horizontal strictement croissant. */
const gradient = Array.from({ length: W * H }, (_, i) => ((i % W) + 1) * 14);
/** Son miroir : toutes les comparaisons de voisins s'inversent. */
const mirrored = Array.from({ length: W * H }, (_, i) => (W - (i % W)) * 14);

const img = (over: Partial<CandidateImage> & { id: string }): CandidateImage => ({
  url: `https://example.test/${over.id}.jpg`,
  provenance: "fournisseur",
  width: 2048,
  height: 2048,
  sharpness: 0.8,
  backgroundClean: true,
  ...over,
});

const photo = (id: string, slot: CandidateImage["slot"], phash: string, over: Partial<CandidateImage> = {}) =>
  img({ id, slot, phash, ...over });

/* ── empreinte perceptuelle ───────────────────────────────────────────────── */

test("dhash : stable, et deux images différentes sont éloignées", () => {
  const a = dhashFromGray(gradient, W, H);
  const b = dhashFromGray(gradient, W, H);
  const c = dhashFromGray(mirrored, W, H);

  assert.equal(a, b);
  assert.equal(hammingHex(a, b), 0);
  assert.ok(hammingHex(a, c) > 20, `distance trop faible : ${hammingHex(a, c)}`);
});

test("dhash : refuse un tampon incohérent", () => {
  assert.throws(() => dhashFromGray([0, 0, 0], 4, 4));
});

test("faux consensus : trois annonces, une seule photo → une seule source", () => {
  const trio = ["a", "b", "c"].map((s) => ({
    id: `img-${s}`,
    phash: "0123456789abcdef",
    sourceId: `listing-${s}`,
  }));

  assert.equal(countDistinctSources(trio), 1);

  const marked = dedupe(trio);
  assert.equal(marked.filter((m) => m.isDistinctSource).length, 1);
  assert.equal(marked[0]?.isDistinctSource, true);
  assert.equal(marked[1]?.duplicateOf, "img-a");
});

test("des photos réellement différentes comptent pour des sources distinctes", () => {
  const genuine = [
    { id: "1", phash: dhashFromGray(gradient, W, H), sourceId: "a" },
    { id: "2", phash: dhashFromGray(mirrored, W, H), sourceId: "b" },
  ];
  assert.equal(countDistinctSources(genuine), 2);
});

/* ── consensus ────────────────────────────────────────────────────────────── */

const obs = (field: string, value: string, sourceId: string, phash: string): SpecObservation => ({
  field,
  value,
  sourceId,
  phash,
  id: `${sourceId}-${field}`,
});

test("consensus : une seule source n'est jamais « haute confiance »", () => {
  const r = consensus([obs("dimensions", "30x8x8 cm", "a", "aaaaaaaaaaaaaaaa")]);
  assert.equal(r[0]?.value, "30x8x8 cm");
  assert.equal(r[0]?.confidence, "low");
});

test("consensus : valeurs identiques sur 3 sources distinctes → haute confiance", () => {
  const r = consensus([
    obs("contenance", "30ml", "a", "aaaaaaaaaaaaaaaa"),
    obs("contenance", "30ml", "b", "bbbbbbbbbbbbbbbb"),
    obs("contenance", "30ml", "c", "cccccccccccccccc"),
  ]);
  assert.equal(r[0]?.confidence, "high");
  assert.equal(r[0]?.distinctSources, 3);
  assert.equal(r[0]?.value, "30ml");
});

test("consensus : trois copies de la même photo ne corroborent rien", () => {
  const r = consensus([
    obs("contenance", "30ml", "a", "0123456789abcdef"),
    obs("contenance", "30ml", "b", "0123456789abcdef"),
    obs("contenance", "30ml", "c", "0123456789abcdef"),
  ]);
  assert.equal(r[0]?.distinctSources, 1);
  assert.equal(r[0]?.confidence, "low");
});

test("consensus : divergence → fourchette, jamais une valeur choisie", () => {
  const r = consensus([
    obs("contenance", "28ml", "a", "aaaaaaaaaaaaaaaa"),
    obs("contenance", "30ml", "b", "bbbbbbbbbbbbbbbb"),
  ]);
  assert.equal(r[0]?.value, undefined);
  assert.deepEqual(r[0]?.range, ["28ml", "30ml"]);
  assert.equal(r[0]?.confidence, "low");
  assert.deepEqual(r[0]?.conflicts, ["28ml", "30ml"]);
});

test("consensus : champs sans observation exploitable", () => {
  assert.deepEqual(consensus([]), []);
});

/* ── sélection par slot ───────────────────────────────────────────────────── */

test("sélection : rejets explicites des visuels inutilisables", () => {
  const r = selectForSlots(
    [
      img({ id: "filigrane", slot: "face", hasWatermark: true }),
      img({ id: "collage", slot: "face", isCollage: true }),
      img({ id: "main", slot: "face", hasHand: true }),
      img({ id: "petit", slot: "face", width: 300, height: 300 }),
      img({ id: "ok", slot: "face" }),
    ],
    REQUIRED_SLOTS.beaute,
  );

  assert.deepEqual(
    r.rejected.map((x) => x.reason).sort(),
    ["collage", "hand", "low_resolution", "watermark"],
  );
  assert.equal(r.assignments.length, 1);
  assert.equal(r.assignments[0]?.image.id, "ok");
});

test("sélection : le meilleur candidat gagne, et une image ne sert qu'une fois", () => {
  const r = selectForSlots(
    [
      img({ id: "haute-res", slot: "face", width: 2048, height: 2048 }),
      img({ id: "basse-res", slot: "face", width: 700, height: 700, provenance: "utilisateur" }),
      img({ id: "dos", slot: "dos", width: 1600, height: 1600 }),
    ],
    REQUIRED_SLOTS.beaute,
  );

  const face = r.assignments.find((a) => a.slot.id === "face");
  assert.equal(face?.image.id, "haute-res");
  assert.ok(r.missing.some((s) => s.id === "macro-label"));
  assert.equal(new Set(r.assignments.map((a) => a.image.id)).size, r.assignments.length);
});

test("sélection : un slot macro exige une résolution plus élevée", () => {
  const r = selectForSlots(
    [img({ id: "moyen", slot: "macro-label", width: 800, height: 800 })],
    REQUIRED_SLOTS.beaute,
  );
  assert.equal(r.assignments.length, 0);
  assert.ok(r.rejected.some((x) => x.reason === "low_resolution_macro"));
});

test("sélection : le fournisseur est préféré à un concurrent à qualité égale", () => {
  const a = img({ id: "fourn", slot: "face", provenance: "fournisseur" });
  const b = img({ id: "conc", slot: "face", provenance: "concurrent" });
  assert.ok(scoreImage(a) > scoreImage(b));
});

/* ── score de fidélité ────────────────────────────────────────────────────── */

const fiveSlots = requiredSlots("beaute");

test("fidélité : planche complète → 100, acceptée", () => {
  const images = fiveSlots.map((s, i) =>
    photo(`p${i}`, s.id, `${i}`.repeat(16), { width: 2048, height: 2048 }),
  );

  const r = computeFidelity({
    regime: "detenu",
    specs: fiveSlots,
    filled: fiveSlots.map((s) => s.id),
    images,
    consistency: 1,
    labelOcrConfidence: 1,
    hasMacroLabel: true,
  });

  assert.equal(r.score, 100);
  assert.equal(r.gatePassed, true);
  assert.deepEqual(r.missing, []);
});

test("fidélité : régime détenu, slot manquant → production refusée", () => {
  const filled = fiveSlots.slice(0, 4).map((s) => s.id);
  const r = computeFidelity({
    regime: "detenu",
    specs: fiveSlots,
    filled,
    images: filled.map((s, i) => photo(`p${i}`, s, `${i}`.repeat(16))),
    consistency: 1,
    labelOcrConfidence: 1,
    hasMacroLabel: true,
  });

  assert.equal(r.gate, "MISSING_SLOTS");
  assert.equal(r.gatePassed, false);
  assert.deepEqual(r.missing, ["macro-capuchon"]);
});

test("fidélité : régime non détenu → plafonné à 80, mais non bloqué sur slot manquant", () => {
  const filled = fiveSlots.slice(0, 4).map((s) => s.id);
  const r = computeFidelity({
    regime: "non_detenu",
    specs: fiveSlots,
    filled,
    images: filled.map((s, i) => photo(`p${i}`, s, `${i}`.repeat(16))),
    consistency: 1,
    labelOcrConfidence: 1,
    hasMacroLabel: true,
  });

  assert.equal(r.score, 80);
  assert.equal(r.gatePassed, true);
  assert.match(r.qualityNote ?? "", /fidélité plafonnée à 80/i);
});

test("fidélité : sans macro de label, le texte ne crédite que la moitié", () => {
  const r = computeFidelity({
    regime: "detenu",
    specs: fiveSlots,
    filled: fiveSlots.map((s) => s.id),
    images: fiveSlots.map((s, i) => photo(`p${i}`, s.id, `${i}`.repeat(16))),
    consistency: 1,
    labelOcrConfidence: 1,
    hasMacroLabel: false,
  });
  assert.equal(r.breakdown.text, 7.5);
  assert.ok(r.score < 100);
});

test("fidélité : planche pauvre → refus pour score insuffisant", () => {
  const r = computeFidelity({
    regime: "non_detenu",
    specs: fiveSlots,
    filled: ["face"],
    images: [photo("p0", "face", "0000000000000000", { width: 600, height: 600 })],
    consistency: 0.2,
    labelOcrConfidence: 0,
    hasMacroLabel: false,
  });
  assert.equal(r.gate, "LOW_SCORE");
  assert.equal(r.gatePassed, false);
});

/* ── orchestration ────────────────────────────────────────────────────────── */

test("buildPlan : assemble slots, sources distinctes, consensus et score", () => {
  const images: CandidateImage[] = [
    photo("f1", "face", "1111111111111111", { width: 2048, height: 2048 }),
    photo("f2", "face", "2222222222222222", { width: 700, height: 700, provenance: "utilisateur" }),
    photo("d1", "dos", "3333333333333333", { width: 1600, height: 1600 }),
    img({ id: "wm", slot: "trois-quarts", hasWatermark: true }),
  ];

  const plan = buildPlan({
    category: "beaute",
    regime: "detenu",
    images,
    specObservations: [
      obs("contenance", "30ml", "a", "1111111111111111"),
      obs("contenance", "30ml", "b", "3333333333333333"),
    ],
    labelOcrConfidence: 0.9,
    consistency: 0.9,
  });

  assert.equal(plan.assignments.length, 2);
  assert.equal(plan.assignments.find((a) => a.slot.id === "face")?.image.id, "f1");
  assert.ok(plan.missing.includes("macro-label"));
  assert.ok(plan.rejected.some((r) => r.reason === "watermark"));
  assert.equal(plan.distinctSources, 3);
  assert.equal(plan.consensus[0]?.value, "30ml");
  assert.equal(plan.fidelity.gatePassed, false);

  const message = refusalMessage(plan);
  assert.match(message ?? "", /Planche à \d+\/100/);
  assert.match(message ?? "", /macro-label|macro du label/i);
});

test("buildPlan : planche complète, aucun message de refus", () => {
  const images = fiveSlots.map((s, i) =>
    photo(`p${i}`, s.id, `${i}`.repeat(16), { width: 2048, height: 2048 }),
  );
  const plan = buildPlan({
    category: "beaute",
    regime: "detenu",
    images,
    labelOcrConfidence: 1,
    consistency: 1,
  });
  assert.equal(plan.fidelity.gatePassed, true);
  assert.equal(refusalMessage(plan), undefined);
});
