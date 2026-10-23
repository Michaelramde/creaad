import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCreativeKit, parseMarketKit, parseProductKit } from "../src/lib/contracts/index.ts";
import { demoCreativeKit, demoMarketKit, demoProductKit } from "../src/lib/demo/fixtures.ts";

/**
 * La démonstration publique est un livrable : elle ne doit pas pouvoir
 * dériver vers des données que la production refuserait.
 */
test("la démonstration respecte les contrats de production", () => {
  assert.doesNotThrow(() => parseProductKit(demoProductKit), "R1");
  const market = parseMarketKit(demoMarketKit);
  assert.doesNotThrow(() => parseCreativeKit(demoCreativeKit, { market }), "R3");
});

test("la démonstration contient bien un angle importé et un angle inconnu", () => {
  const market = parseMarketKit(demoMarketKit);
  assert.ok(market.anglePortfolio.some((a) => a.status === "proven_elsewhere"));
  assert.ok(market.anglePortfolio.some((a) => a.status === "unobserved"));
  assert.ok(market.whiteSpaceImported.length > 0);
});

test("la démonstration ne promet aucun résultat non sourcé", () => {
  const kit = parseProductKit(demoProductKit);
  const unsourced = kit.claims.filter((c) => !c.source && !c.hypothesis);
  assert.equal(unsourced.length, 0);
});

test("les plans sont ordonnés et le hook tient dans 2 secondes", () => {
  const kit = parseCreativeKit(demoCreativeKit);
  for (const script of kit.scripts) {
    assert.equal(script.scenes[0]?.atS, 0);
    assert.ok(script.hookEndsAtS <= 2);
  }
});
