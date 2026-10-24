import assert from "node:assert/strict";
import { test } from "node:test";

import { idem, releaseEntries, reservationEntries, settleEntries } from "../src/lib/wallet/core.ts";

const ANALYSIS = "11111111-2222-3333-4444-555555555555";

/* ── facturation par étape ──────────────────────────────────────────────── */

test("étape 1 : les clés historiques sont conservées", () => {
  assert.equal(idem.reservation(ANALYSIS), `reservation:${ANALYSIS}`);
  assert.equal(idem.reglement(ANALYSIS), `reglement:${ANALYSIS}`);
});

test("étape 2 : espace de noms distinct, aucun conflit avec l'étape 1", () => {
  const step1 = idem.reservation(ANALYSIS, 1);
  const step2 = idem.reservation(ANALYSIS, 2);
  assert.notEqual(step1, step2);
  assert.match(step2, /etape2$/);
});

test("deux réservations d'étapes différentes coexistent", () => {
  const entries = [
    ...reservationEntries(ANALYSIS, 1000, 1),
    ...reservationEntries(ANALYSIS, 1000, 2),
  ];
  const keys = new Set(entries.map((entry) => entry.idempotencyKey));
  assert.equal(keys.size, 2, "les deux étapes doivent produire des clés distinctes");
});

test("règlement de l'étape 2 : clés distinctes de celles de l'étape 1", () => {
  const step1 = settleEntries(ANALYSIS, 1000, 1000, 1).map((e) => e.idempotencyKey);
  const step2 = settleEntries(ANALYSIS, 1000, 1000, 2).map((e) => e.idempotencyKey);
  assert.notDeepEqual(step1, step2);
  assert.equal(new Set([...step1, ...step2]).size, 4);
});

test("libération de l'étape 2 : ne touche pas à l'étape 1", () => {
  const liberation = releaseEntries(ANALYSIS, 1000, 2)[0];
  assert.notEqual(liberation?.idempotencyKey, idem.liberation(ANALYSIS, 1));
  assert.equal(liberation?.amountXof, 1000);
});

test("un montant négatif est toujours traité comme un débit", () => {
  assert.equal(reservationEntries(ANALYSIS, -1000, 2)[0]?.amountXof, -1000);
});
