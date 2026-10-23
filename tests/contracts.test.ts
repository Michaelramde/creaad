import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ContractError,
  contractSummary,
  parseCreativeKit,
  parseMarketKit,
  parseProductKit,
} from "../src/lib/contracts/index.ts";

/* ── fixtures valides ─────────────────────────────────────────────────────── */

const productKit = () => ({
  source: {
    listingUrl: "https://www.aliexpress.com/item/1",
    title: "Serum Vitamine C 30ml",
    matchScore: 88,
  },
  identity: { archetype: "beaute-serum-30ml", category: "beaute" },
  specs: {},
  claims: [{ text: "Sans parfum", verified: false, hypothesis: true }],
  labelOcr: { raw: "SERUM C", corrected: "SERUM C", fields: [] },
  variant: { colorHex: "#FFF8DC" },
  images: [
    { id: "i1", url: "https://cdn.example/i1.jpg", slot: "face", provenance: "fournisseur" },
  ],
  coverage: { requiredSlots: ["face"], filled: ["face"], missing: [] as string[] },
  fidelity: {
    score: 90,
    breakdown: { resolution: 20, coverage: 30, consistency: 15, text: 15, consensus: 10 },
    gatePassed: true,
  },
  evidence: {
    sources: [{ url: "https://www.aliexpress.com/item/1", platform: "aliexpress" }],
    conflicts: [],
    consensusNote: "2 sources concordantes",
  },
});

const marketKit = () => ({
  market: { country: "CI", language: "fr", currency: "XOF", maturityStage: "emerging" },
  anglePortfolio: [
    {
      angleFamily: "avant-apres",
      status: "proven_here",
      advertisersCount: 4,
      medianDaysRunning: 62,
      markets: [],
      evidenceUrls: ["https://ads.example/1"],
      proofAvailable: ["témoignages"],
      priority: 60,
    },
  ],
  dataQuality: { adsFound: 22, confidence: "low", gaps: [] },
});

const creativeKit = () => ({
  bigIdea: "La preuve par le résultat visible",
  angles: [
    {
      id: "a1",
      insight: "Elles ont déjà tout essayé",
      promise: "Résultat visible en 4 semaines",
      mechanism: "Vitamine C stabilisée",
      proof: "Photos avant/après",
      objectionHandled: "Ça ne marche pas sur moi",
      hook: "Regarde ce qui se passe en 4 semaines",
      awarenessLevel: 2,
      sourceAngleRef: "avant-apres",
    },
  ],
  hooks: [{ format: "ugc", text: "Regarde ce qui se passe", durationS: 15 }],
  scripts: [
    {
      format: "ugc",
      durationS: 15,
      hookEndsAtS: 2,
      scenes: [
        { atS: 0, visual: "Gros plan sur le flacon" },
        { atS: 2, visual: "Application sur le visage" },
      ],
    },
  ],
  visualDirection: { palette: ["#F5E6C8"], motifs: [], do: [], dont: [] },
});

/* ── R1 ───────────────────────────────────────────────────────────────────── */

test("R1 : un kit matière complet passe", () => {
  const kit = parseProductKit(productKit());
  assert.equal(kit.identity.archetype, "beaute-serum-30ml");
  assert.match(contractSummary(kit), /90\/100/);
});

test("R1 : une affirmation sans source ni hypothèse est refusée", () => {
  const raw = productKit();
  raw.claims = [{ text: "Guérit l'acné", verified: false, hypothesis: false }];
  assert.throws(() => parseProductKit(raw), (e: unknown) => {
    assert.ok(e instanceof ContractError);
    assert.match(e.issues.join(" "), /source ou être marquée/);
    return true;
  });
});

test("R1 : planche déclarée valide sous le seuil → refus", () => {
  const raw = productKit();
  raw.fidelity.score = 50;
  assert.throws(() => parseProductKit(raw), ContractError);
});

test("R1 : planche valide avec slot manquant → refus", () => {
  const raw = productKit();
  raw.coverage.missing = ["dos"];
  assert.throws(() => parseProductKit(raw), ContractError);
});

test("R1 : image hors slot requis → refus", () => {
  const raw = productKit();
  raw.images[0]!.slot = "inconnu";
  assert.throws(() => parseProductKit(raw), ContractError);
});

test("R1 : couleur non hexadécimale → refus", () => {
  const raw = productKit();
  raw.variant.colorHex = "jaune";
  assert.throws(() => parseProductKit(raw), ContractError);
});

/* ── R2 ───────────────────────────────────────────────────────────────────── */

test("R2 : un kit argumentaire cohérent passe", () => {
  const kit = parseMarketKit(marketKit());
  assert.equal(kit.anglePortfolio[0]?.status, "proven_here");
  assert.match(contractSummary(kit), /22 annonces/);
});

test("R2 : échantillon faible déclaré autre chose qu'insufficient → refus", () => {
  const raw = marketKit();
  raw.dataQuality.adsFound = 9;
  raw.dataQuality.confidence = "medium";
  assert.throws(() => parseMarketKit(raw), ContractError);
});

test("R2 : données insuffisantes mais portefeuille fourni → refus", () => {
  const raw = marketKit();
  raw.dataQuality.adsFound = 5;
  raw.dataQuality.confidence = "insufficient";
  assert.throws(() => parseMarketKit(raw), ContractError);
});

test("R2 : angle prouvé avec trop peu d'annonceurs → refus", () => {
  const raw = marketKit();
  raw.anglePortfolio[0]!.advertisersCount = 2;
  assert.throws(() => parseMarketKit(raw), ContractError);
});

test("R2 : angle prouvé sans longévité → refus", () => {
  const raw = marketKit();
  raw.anglePortfolio[0]!.medianDaysRunning = 20;
  assert.throws(() => parseMarketKit(raw), ContractError);
});

test("R2 : angle importé sans marché source → refus", () => {
  const raw = marketKit();
  raw.anglePortfolio[0]!.status = "proven_elsewhere";
  raw.anglePortfolio[0]!.markets = [];
  assert.throws(() => parseMarketKit(raw), ContractError);
});

test("R2 : angle affirmé sans URL source → refus", () => {
  const raw = marketKit();
  raw.anglePortfolio[0]!.evidenceUrls = [];
  assert.throws(() => parseMarketKit(raw), ContractError);
});

test("R2 : angle non observé sans source est toléré", () => {
  const raw = marketKit();
  raw.anglePortfolio[0]!.status = "unobserved";
  raw.anglePortfolio[0]!.advertisersCount = 0;
  raw.anglePortfolio[0]!.medianDaysRunning = 0;
  raw.anglePortfolio[0]!.evidenceUrls = [];
  assert.doesNotThrow(() => parseMarketKit(raw));
});

/* ── R3 ───────────────────────────────────────────────────────────────────── */

test("R3 : un kit production cohérent passe", () => {
  const market = parseMarketKit(marketKit());
  const kit = parseCreativeKit(creativeKit(), { market });
  assert.equal(kit.angles.length, 1);
  assert.match(contractSummary(kit), /1 hooks/);
});

test("R3 : hook qui dépasse 2 secondes → refus", () => {
  const raw = creativeKit();
  raw.scripts[0]!.hookEndsAtS = 4;
  assert.throws(() => parseCreativeKit(raw), ContractError);
});

test("R3 : premier plan qui ne démarre pas à 0 s → refus", () => {
  const raw = creativeKit();
  raw.scripts[0]!.scenes[0]!.atS = 1;
  assert.throws(() => parseCreativeKit(raw), ContractError);
});

test("R3 : angle référençant un angle absent du kit argumentaire → refus", () => {
  const market = parseMarketKit(marketKit());
  const raw = creativeKit();
  raw.angles[0]!.sourceAngleRef = "angle-invente";
  assert.throws(
    () => parseCreativeKit(raw, { market }),
    (e: unknown) => {
      assert.ok(e instanceof ContractError);
      assert.match(e.issues.join(" "), /angle-invente/);
      return true;
    },
  );
});

test("R3 : identifiants d'angles dupliqués → refus", () => {
  const raw = creativeKit();
  raw.angles.push({ ...raw.angles[0]! });
  assert.throws(() => parseCreativeKit(raw), ContractError);
});
