import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CACHE_TTL_DAYS,
  cacheKey,
  describeLookup,
  expiryFor,
  isFresh,
  shouldCache,
  ttlDays,
} from "../src/lib/cache/policy.ts";

const DAY = 86_400_000;

test("durée de vie par niveau de confiance", () => {
  assert.equal(ttlDays("high"), 30);
  assert.equal(ttlDays("medium"), 21);
  assert.equal(ttlDays("low"), 14);
  assert.equal(ttlDays("insufficient"), 0);
});

test("un rapport insuffisant n'est jamais mis en cache", () => {
  assert.equal(shouldCache("insufficient"), false);
  assert.equal(expiryFor("insufficient"), null);
  assert.equal(shouldCache("low"), true);
});

test("expiration calculée depuis la confiance", () => {
  const now = Date.UTC(2026, 0, 1);
  assert.equal(expiryFor("high", now)?.getTime(), now + 30 * DAY);
  assert.equal(expiryFor("low", now)?.getTime(), now + 14 * DAY);
});

test("fraîcheur : stricte à la borne", () => {
  const now = Date.UTC(2026, 0, 10);
  assert.equal(isFresh(new Date(now + 1), now), true);
  assert.equal(isFresh(new Date(now), now), false);
  assert.equal(isFresh(new Date(now - DAY), now), false);
  assert.equal(isFresh("pas une date", now), false);
});

test("clé de cache : pays normalisé, langue par défaut", () => {
  assert.equal(cacheKey("arch-1", "ci"), "arch-1:CI:fr");
  assert.equal(cacheKey("arch-1", "SN", "wo"), "arch-1:SN:wo");
});

test("diagnostic de lecture : âge et jours restants", () => {
  const created = Date.UTC(2026, 0, 1);
  const expires = created + 21 * DAY;
  const now = created + 7 * DAY;

  const l = describeLookup(new Date(expires), new Date(created), now);
  assert.equal(l.hit, true);
  assert.equal(l.stale, false);
  assert.equal(l.ageDays, 7);
  assert.equal(l.remainingDays, 14);
});

test("diagnostic de lecture : entrée périmée", () => {
  const created = Date.UTC(2026, 0, 1);
  const l = describeLookup(new Date(created + DAY), new Date(created), created + 5 * DAY);
  assert.equal(l.hit, false);
  assert.equal(l.stale, true);
  assert.equal(l.remainingDays, 0);
});

test("tous les niveaux de confiance ont une politique explicite", () => {
  assert.deepEqual(Object.keys(CACHE_TTL_DAYS).sort(), ["high", "insufficient", "low", "medium"]);
});
