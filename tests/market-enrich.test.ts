import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCompetitors } from "../src/lib/market/competitors.ts";
import { sanitizeEnrichment } from "../src/lib/market/enrich.ts";

const NOW = new Date("2026-10-24T12:00:00Z").getTime();
const day = (n: number) => new Date(NOW - n * 86_400_000);

const ADS = [
  { advertiserId: "a1", advertiserName: "Bezihubb", hook: "Cuir véritable, livraison 24 h", startDate: day(120), url: "https://ads.test/1", isActive: true },
  { advertiserId: "a1", advertiserName: "Bezihubb", hook: "Stock limité", startDate: day(30), url: "https://ads.test/2", isActive: true },
  { advertiserId: "a2", advertiserName: "Noliva", hook: "Le sac que tout Abidjan porte", startDate: day(60), url: "https://ads.test/3", isActive: true },
];

/* ── concurrents (déterministe) ─────────────────────────────────────────── */

test("concurrents : un annonceur qui publie deux annonces reste un concurrent", () => {
  const competitors = buildCompetitors(ADS, { now: NOW });
  assert.equal(competitors.length, 2);
  const bezihubb = competitors.find((c) => c.name === "Bezihubb");
  assert.equal(bezihubb?.adsCount, 2);
});

test("concurrents : le plus persévérant d'abord", () => {
  const competitors = buildCompetitors(ADS, { now: NOW });
  assert.equal(competitors[0]?.name, "Bezihubb");
  assert.equal(competitors[0]?.longestRunDays, 120);
});

test("concurrents : l'annonce la plus ancienne sert de lien", () => {
  const competitors = buildCompetitors(ADS, { now: NOW });
  assert.equal(competitors[0]?.url, "https://ads.test/1");
});

/* ── garde-fou des preuves ──────────────────────────────────────────────── */

const ALLOWED = new Set(ADS.map((ad) => ad.url));

test("enrichissement : un désir sans preuve réelle est supprimé", () => {
  const enrichment = sanitizeEnrichment(
    {
      desires: [
        { level: 3, statement: "Paraître soigné", evidence: ["https://ads.test/1"] },
        { level: 5, statement: "Être respecté", evidence: ["https://inventé.test/x"] },
      ],
    },
    ALLOWED,
  );
  assert.equal(enrichment.desires.length, 1);
  assert.equal(enrichment.desires[0]?.statement, "Paraître soigné");
});

test("enrichissement : un désir sans aucune preuve est supprimé", () => {
  const enrichment = sanitizeEnrichment({ desires: [{ level: 2, statement: "Être à la mode" }] }, ALLOWED);
  assert.equal(enrichment.desires.length, 0);
});

test("enrichissement : le niveau est ramené entre 1 et 5", () => {
  const enrichment = sanitizeEnrichment(
    { desires: [{ level: 99, statement: "Test de niveau", evidence: ["https://ads.test/1"] }] },
    ALLOWED,
  );
  assert.equal(enrichment.desires[0]?.level, 5);
});

test("enrichissement : une objection sans contre-angle utile reste, mais sans preuve elle part", () => {
  const enrichment = sanitizeEnrichment(
    {
      objections: [
        { objection: "Trop cher", counterAngle: "Paiement à la livraison", evidence: ["https://ads.test/3"] },
        { objection: "Pas confiance", counterAngle: "…", evidence: ["https://ailleurs.test/y"] },
      ],
    },
    ALLOWED,
  );
  assert.equal(enrichment.objections.length, 1);
  assert.equal(enrichment.objections[0]?.objection, "Trop cher");
});

test("enrichissement : un verbatim dont la source n'existe pas est écarté", () => {
  const enrichment = sanitizeEnrichment(
    {
      personas: [
        {
          name: "Commerçant pressé",
          profile: "Homme de 30 ans, achète pour revendre",
          verbatims: [
            { quote: "Livraison 24 h", sourceUrl: "https://ads.test/1" },
            { quote: "Inventé", sourceUrl: "https://nulle-part.test/z" },
          ],
        },
      ],
    },
    ALLOWED,
  );
  assert.equal(enrichment.personas[0]?.verbatims.length, 1);
});

test("enrichissement : un risque trop court n'est pas retenu", () => {
  const enrichment = sanitizeEnrichment({ riskFlags: [{ type: "meta_policy", severity: "warning", note: "court" }] }, ALLOWED);
  assert.equal(enrichment.riskFlags.length, 0);
});
