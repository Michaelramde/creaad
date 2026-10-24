import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyHook } from "../src/lib/market/classify.ts";
import { auditPortfolio, buildPortfolio } from "../src/lib/market/portfolio.ts";
import {
  assessQuality,
  buildMatrix,
  computeStatus,
  daysRunning,
  median,
  MIN_ADS_FOR_MATRIX,
  PROVEN_MIN_MEDIAN_DAYS,
  velocity,
} from "../src/lib/market/saturation.ts";
import type { AdObservation, AngleFamily, Platform } from "../src/lib/market/types.ts";

const NOW = Date.UTC(2026, 9, 23);
const DAY = 86_400_000;

const iso = (ms: number) => new Date(ms).toISOString();

function ad(input: {
  id: string;
  advertiserId: string;
  family: AngleFamily;
  daysAgo: number;
  durationDays?: number;
  country?: string;
  platform?: Platform;
}): AdObservation {
  const start = NOW - input.daysAgo * DAY;
  const ended = input.durationDays !== undefined;
  return {
    id: input.id,
    advertiserId: input.advertiserId,
    family: input.family,
    platform: input.platform ?? "meta",
    country: input.country ?? "CI",
    startDate: iso(start),
    endDate: ended ? iso(start + input.durationDays! * DAY) : undefined,
    isActive: !ended,
    url: `https://ads.example/${input.id}`,
    hook: `hook ${input.id}`,
  };
}

/* ── classification ───────────────────────────────────────────────────────── */

test("classification des hooks en familles d'angles", () => {
  assert.equal(classifyHook("Avant / après 4 semaines").family, "avant-apres");
  assert.equal(classifyHook("Certifié par un dermatologue").family, "autorite");
  assert.equal(classifyHook("Déjà 500 clientes satisfaites").family, "preuve-sociale");
  assert.equal(classifyHook("Livraison offerte dès 15 000 FCFA").family, "prix-offre");
  assert.equal(classifyHook("Satisfait ou remboursé, paiement à la livraison").family, "garantie");
  assert.equal(classifyHook("").family, "non-classe");
  assert.equal(classifyHook(undefined).family, "non-classe");
});

test("classification : le motif long l'emporte sur le mot isolé", () => {
  const long = classifyHook("Livraison offerte dès maintenant");
  const short = classifyHook("offre");
  assert.equal(long.family, "prix-offre");
  assert.ok(
    long.score > short.score,
    `score long ${long.score} devrait dépasser ${short.score}`,
  );
});

/* ── mesures ──────────────────────────────────────────────────────────────── */

test("durée de diffusion : annonce active ou arrêtée", () => {
  const active = ad({ id: "a", advertiserId: "x", family: "urgence", daysAgo: 60 });
  assert.equal(Math.round(daysRunning(active, NOW)), 60);

  const ended = ad({ id: "b", advertiserId: "x", family: "urgence", daysAgo: 90, durationDays: 30 });
  assert.equal(Math.round(daysRunning(ended, NOW)), 30);
});

test("médiane : pair et impair", () => {
  assert.equal(median([10, 20, 30]), 20);
  assert.equal(median([10, 20, 30, 40]), 25);
  assert.equal(median([]), 0);
});

test("accélération : ratio 30 j vs 30 j précédents", () => {
  const ads = [
    ad({ id: "1", advertiserId: "a", family: "urgence", daysAgo: 5 }),
    ad({ id: "2", advertiserId: "b", family: "urgence", daysAgo: 10 }),
    ad({ id: "3", advertiserId: "a", family: "urgence", daysAgo: 45 }),
  ];
  assert.equal(velocity(ads, NOW), 2);
  assert.equal(velocity([], NOW), null);
  assert.equal(
    velocity([ad({ id: "4", advertiserId: "a", family: "urgence", daysAgo: 5 })], NOW),
    Number.POSITIVE_INFINITY,
  );
});

/* ── statuts ──────────────────────────────────────────────────────────────── */

const proven = (n = 3) => ({
  advertisers: Array.from({ length: n }, (_, i) => `adv-${i}`),
  medianDaysRunning: PROVEN_MIN_MEDIAN_DAYS + 15,
});

test("statut : prouvé ici quand assez d'annonceurs et de longévité", () => {
  assert.equal(
    computeStatus({ local: { ads: 10, ...proven(), velocity: null } }),
    "proven_here",
  );
});

test("statut : prouvé ailleurs quand c'est prouvé en référence et absent ici", () => {
  assert.equal(
    computeStatus({
      local: { ads: 0, advertisers: [], medianDaysRunning: 0, velocity: null },
      reference: proven(),
    }),
    "proven_elsewhere",
  );
});

test("statut : en montée quand la fréquence accélère avec plusieurs annonceurs", () => {
  assert.equal(
    computeStatus({
      local: { ads: 6, advertisers: ["a", "b"], medianDaysRunning: 12, velocity: 2.5 },
    }),
    "rising",
  );
});

test("statut : observé non prouvé — ni copié, ni écarté", () => {
  assert.equal(
    computeStatus({
      local: { ads: 3, advertisers: ["a"], medianDaysRunning: 10, velocity: 1 },
    }),
    "observed_unproven",
  );
});

test("statut : non observé — jamais une opportunité par défaut", () => {
  assert.equal(
    computeStatus({
      local: { ads: 0, advertisers: [], medianDaysRunning: 0, velocity: null },
    }),
    "unobserved",
  );
});

test("statut : un angle prouvé localement n'est pas « importé »", () => {
  // Même si une référence existe, le local gagne : inutile d'importer ce qui est installé.
  assert.equal(
    computeStatus({
      local: { ads: 20, ...proven(5), velocity: null },
      reference: proven(),
    }),
    "proven_here",
  );
});

/* ── qualité des données ──────────────────────────────────────────────────── */

test("statut : deux annonces ne suffisent pas à déclarer « en montée »", () => {
  // Vélocité forte et deux annonceurs, mais seulement deux annonces :
  // le médian et la vélocité n'ont pas de sens sur si peu.
  assert.equal(
    computeStatus({
      local: { ads: 2, advertisers: ["a", "b"], medianDaysRunning: 5, velocity: 4 },
    }),
    "observed_unproven",
  );
});

test("statut : deux annonces ne suffisent pas à déclarer « prouvé ici »", () => {
  assert.equal(
    computeStatus({
      local: { ads: 2, advertisers: ["a", "b", "c"], medianDaysRunning: 90, velocity: null },
    }),
    "observed_unproven",
  );
});

test("statut : l'import reste possible avec une seule annonce locale", () => {
  // Ici la preuve vient du marché de référence, pas du volume local.
  assert.equal(
    computeStatus({
      local: { ads: 1, advertisers: ["a"], medianDaysRunning: 5, velocity: null },
      reference: proven(),
    }),
    "proven_elsewhere",
  );
});

test("qualité : sous le seuil, aucune carte n'est publiée", () => {
  const ads = Array.from({ length: 10 }, (_, i) =>
    ad({ id: `q${i}`, advertiserId: `adv${i % 2}`, family: "urgence", daysAgo: 10 }),
  );
  const q = assessQuality(ads, NOW);
  assert.equal(q.confidence, "insufficient");
  assert.equal(q.adsFound, 10);
  assert.ok(q.gaps.some((g) => g.includes("Moins de 3 annonceurs")));

  const matrix = buildMatrix({ country: "CI", ads, now: NOW });
  assert.equal(matrix.publishable, false);

  const portfolio = buildPortfolio(matrix);
  assert.equal(portfolio.publishable, false);
  assert.match(portfolio.message ?? "", /Données insuffisantes/);
  assert.deepEqual(portfolio.entries, []);
});

test("qualité : la fenêtre d'observation trop courte est signalée", () => {
  const ads = Array.from({ length: 20 }, (_, i) =>
    ad({ id: `w${i}`, advertiserId: `adv${i % 4}`, family: "urgence", daysAgo: 5 }),
  );
  const q = assessQuality(ads, NOW);
  assert.ok(q.gaps.some((g) => g.includes("30 jours")));
  assert.ok(q.gaps.some((g) => g.includes("TikTok")));
});

/* ── matrice & portefeuille ───────────────────────────────────────────────── */

function richDataset(): AdObservation[] {
  const ads: AdObservation[] = [];
  // « avant-apres » : 4 annonceurs, 60 jours de diffusion → prouvé ici
  for (let a = 0; a < 4; a += 1) {
    for (let i = 0; i < 4; i += 1) {
      ads.push(ad({ id: `aa-${a}-${i}`, advertiserId: `adv-aa-${a}`, family: "avant-apres", daysAgo: 60 }));
    }
  }
  // « urgence » : 2 annonceurs récents → observé non prouvé
  for (let i = 0; i < 4; i += 1) {
    ads.push(ad({ id: `ur-${i}`, advertiserId: `adv-ur-${i % 2}`, family: "urgence", daysAgo: 8 }));
  }
  return ads;
}

function referenceDataset(): AdObservation[] {
  const ads: AdObservation[] = [];
  // « autorite » prouvé au Nigeria, absent en CI
  for (let a = 0; a < 3; a += 1) {
    for (let i = 0; i < 2; i += 1) {
      ads.push(
        ad({
          id: `ng-${a}-${i}`,
          advertiserId: `ng-adv-${a}`,
          family: "autorite",
          daysAgo: 70,
          country: "NG",
        }),
      );
    }
  }
  return ads;
}

test("matrice : un angle prouvé ailleurs ressort en espace blanc", () => {
  const matrix = buildMatrix({
    country: "CI",
    ads: richDataset(),
    referenceAds: referenceDataset(),
    referenceMarkets: ["Nigeria"],
    now: NOW,
  });

  assert.equal(matrix.publishable, true);
  assert.ok(matrix.dataQuality.adsFound >= MIN_ADS_FOR_MATRIX);

  const portfolio = buildPortfolio(matrix);
  assert.equal(portfolio.publishable, true);
  assert.equal(portfolio.whiteSpace.length, 1);
  assert.equal(portfolio.whiteSpace[0]?.family, "autorite");
  assert.match(portfolio.whiteSpace[0]?.rationale ?? "", /Nigeria/);

  assert.deepEqual(auditPortfolio(portfolio), []);
});

test("matrice : un angle prouvé ici est conservé, pas abandonné", () => {
  const matrix = buildMatrix({ country: "CI", ads: richDataset(), now: NOW });
  const portfolio = buildPortfolio(matrix);
  const entry = portfolio.entries.find((e) => e.family === "avant-apres");

  assert.equal(entry?.action, "garder-differencier");
  assert.equal(entry?.recommended, true);
  assert.match(entry?.rationale ?? "", /changer l'exécution/);
});

test("matrice : les angles non observés ne sont pas recommandés", () => {
  const matrix = buildMatrix({ country: "CI", ads: richDataset(), now: NOW });
  const portfolio = buildPortfolio(matrix);

  for (const entry of portfolio.entries.filter((e) => e.action === "ignorer")) {
    assert.equal(entry.recommended, false);
    assert.match(entry.rationale, /inconnue/);
  }
  // Et ils ne polluent pas l'espace blanc.
  assert.ok(portfolio.whiteSpace.every((e) => e.action === "importer"));
});

test("matrice : tri par priorité — import > montée > prouvé ici", () => {
  const matrix = buildMatrix({
    country: "CI",
    ads: richDataset(),
    referenceAds: referenceDataset(),
    referenceMarkets: ["Nigeria"],
    now: NOW,
  });
  const portfolio = buildPortfolio(matrix);
  const priorities = portfolio.entries.map((e) => e.priority);
  assert.deepEqual(priorities, [...priorities].sort((a, b) => b - a));
  assert.equal(portfolio.entries[0]?.action, "importer");
});

test("garde-fou : un angle sans URL source est dénoncé par l'audit", () => {
  const matrix = buildMatrix({ country: "CI", ads: richDataset(), now: NOW });
  const portfolio = buildPortfolio(matrix);
  portfolio.entries[0]!.evidenceUrls = [];
  assert.ok(auditPortfolio(portfolio).some((p) => p.includes("sans URL source")));
});
