import assert from "node:assert/strict";
import { test } from "node:test";

import { adLibraryUrl } from "../src/lib/providers/meta-ads.ts";

/* Le module product-market touche la base : on teste ici ce qui est pur. */

test("URL d'Ad Library : phrase exacte imposée par défaut", () => {
  const url = adLibraryUrl("CI", "jeep buluo");
  assert.match(url, /country=CI/);
  assert.match(url, /search_type=keyword_exact_phrase/);
  assert.match(url, /q=jeep\+buluo/);
  assert.match(url, /active_status=active/);
});

test("URL d'Ad Library : le mode approximatif reste possible mais explicite", () => {
  assert.match(adLibraryUrl("SN", "sac", false), /search_type=keyword_unordered/);
});

test("URL d'Ad Library : le mot-clé est encodé, jamais injecté brut", () => {
  const url = adLibraryUrl("CI", "sac & homme");
  assert.match(url, /q=sac\+%26\+homme/);
});
