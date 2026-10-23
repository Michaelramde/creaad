import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyEntries,
  balanceOf,
  canLaunch,
  creditEntry,
  idem,
  InsufficientFundsError,
  remainingAnalyses,
  releaseEntries,
  reservationEntries,
  settleEntries,
} from "../src/lib/wallet/core.ts";

const CREDIT = 1000;

test("le solde est la somme signée du registre", () => {
  assert.equal(balanceOf([{ amountXof: 5000 }, { amountXof: -1000 }, { amountXof: 200 }]), 4200);
  assert.equal(balanceOf([]), 0);
});

test("réserver puis régler laisse un débit net égal au coût réel", () => {
  const afterTopup = 5000;
  const reserved = reservationEntries("a1", CREDIT);
  const mid = applyEntries(afterTopup, reserved);
  assert.equal(mid, 4000);

  // Coût réel inférieur à la réservation : le trop-perçu est restitué.
  // 5 000 − 1 000 (réservation) + 1 000 (libération) − 700 (règlement) = 4 300
  const settled = applyEntries(mid, settleEntries("a1", CREDIT, 700));
  assert.equal(settled, 4300);
  assert.equal(balanceOf([...reserved, ...settleEntries("a1", CREDIT, 700)]), -700);
});

test("un échec restitue intégralement la réservation", () => {
  const reserved = reservationEntries("a2", CREDIT);
  const mid = applyEntries(5000, reserved);
  const after = applyEntries(mid, releaseEntries("a2", CREDIT));
  assert.equal(after, 5000);
  assert.equal(balanceOf([...reserved, ...releaseEntries("a2", CREDIT)]), 0);
});

test("aucune écriture ne peut rendre le solde négatif", () => {
  assert.throws(
    () => applyEntries(500, reservationEntries("a3", CREDIT)),
    InsufficientFundsError,
  );
});

test("le règlement d'un coût supérieur à la réservation reste borné par le solde", () => {
  // 5 000 → réservation 1 000 → solde 4 000. Coût réel 1 200.
  const settled = applyEntries(4000, settleEntries("a4", CREDIT, 1200));
  assert.equal(settled, 3800);
  // Un coût réel absurde ne peut pas passer sous zéro.
  assert.throws(() => applyEntries(4000, settleEntries("a4", CREDIT, 999_999)), InsufficientFundsError);
});

test("les clés d'idempotence sont stables et distinctes par opération", () => {
  assert.equal(idem.recharge("MTX-1"), "recharge:MTX-1");
  assert.equal(idem.reservation("a1"), "reservation:a1");
  assert.equal(idem.reglement("a1"), "reglement:a1");

  const keys = new Set([
    idem.reservation("a1"),
    idem.liberation("a1"),
    idem.reglement("a1"),
  ]);
  assert.equal(keys.size, 3);
});

test("une recharge rejouée produit la même clé — donc une seule écriture", () => {
  const e1 = creditEntry({ topupId: "t1", providerTxnId: "MTX-9", amountXof: 5000 });
  const e2 = creditEntry({ topupId: "t1", providerTxnId: "MTX-9", amountXof: 5000 });
  assert.equal(e1.idempotencyKey, e2.idempotencyKey);
  assert.equal(e1.amountXof, 5000);
});

test("la recharge est toujours créditrice, même passée en négatif", () => {
  const e = creditEntry({ topupId: "t1", providerTxnId: "MTX-9", amountXof: -5000 });
  assert.equal(e.amountXof, 5000);
});

test("le lancement dépend du plancher de crédit", () => {
  assert.equal(canLaunch(999, CREDIT), false);
  assert.equal(canLaunch(1000, CREDIT), true);
  assert.equal(remainingAnalyses(5000, CREDIT), 5);
  assert.equal(remainingAnalyses(4999, CREDIT), 4);
  assert.equal(remainingAnalyses(0, CREDIT), 0);
});
