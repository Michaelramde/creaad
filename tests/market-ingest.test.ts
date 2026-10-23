import assert from "node:assert/strict";
import { test } from "node:test";

import { ingestAds, toAdObservation, type RawAdRow } from "../src/lib/market/ingest.ts";
import { aliexpressSign } from "../src/lib/providers/aliexpress.ts";

/* ── ingestion ────────────────────────────────────────────────────────────── */

const NOW = Date.UTC(2026, 9, 24);
const DAY = 86_400_000;

const row = (over: Partial<RawAdRow> = {}): RawAdRow => ({
  id: "1",
  archetypeSlug: "beaute-serum-30ml",
  country: "ci",
  platform: "meta",
  advertiserId: "page-1",
  advertiserName: "Belle Shop",
  hook: "Avant / après 7 jours",
  startDate: new Date(NOW - 60 * DAY),
  isActive: true,
  url: "https://www.facebook.com/ads/library/?id=1",
  ...over,
});

test("l'annonce est classée et le pays normalisé", () => {
  const o = toAdObservation(row(), NOW);
  assert.equal(o.country, "CI");
  assert.equal(o.family, "avant-apres");
  assert.equal(o.advertiserId, "page-1");
});

test("une date de début absente devient « maintenant » — jamais une preuve de longévité", () => {
  const o = toAdObservation(row({ startDate: null }), NOW);
  assert.equal(new Date(o.startDate).getTime(), NOW);
});

test("les lignes inexploitables sont écartées, avec le motif", () => {
  const { observations, report } = ingestAds(
    [
      row(),
      row({ id: "2", url: "" }),
      row({ id: "3", advertiserId: "" }),
      row({ id: "4", startDate: new Date(NOW + 5 * DAY) }),
    ],
    { now: NOW },
  );

  assert.equal(observations.length, 1);
  assert.equal(report.total, 4);
  assert.equal(report.dropped, 3);
  assert.equal(report.reasons.sans_url, 1);
  assert.equal(report.reasons.sans_annonceur, 1);
  assert.equal(report.reasons.date_future, 1);
});

test("les hooks non reconnus sont comptés, pas cachés", () => {
  const { report } = ingestAds([row({ hook: "xyz" })], { now: NOW });
  assert.equal(report.unclassified, 1);
});

test("une liste vide ne produit rien", () => {
  const { observations, report } = ingestAds([], { now: NOW });
  assert.deepEqual(observations, []);
  assert.equal(report.total, 0);
});

/* ── AliExpress ───────────────────────────────────────────────────────────── */

test("signature AliExpress : 32 hexadécimaux majuscules, déterministe", () => {
  const params = { method: "x", app_key: "k", timestamp: "1" };
  const a = aliexpressSign(params, "secret");
  const b = aliexpressSign({ timestamp: "1", app_key: "k", method: "x" }, "secret");

  assert.match(a, /^[0-9A-F]{32}$/);
  assert.equal(a, b, "l'ordre des clés ne doit pas changer la signature");
});

test("signature AliExpress : un secret différent change la signature", () => {
  const params = { method: "x", app_key: "k" };
  assert.notEqual(aliexpressSign(params, "secret"), aliexpressSign(params, "autre"));
});
