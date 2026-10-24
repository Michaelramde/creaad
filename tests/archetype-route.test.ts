import assert from "node:assert/strict";
import { test } from "node:test";

import { buildArchetype, detectGender, detectNoun } from "../src/lib/archetype/extract.ts";
import {
  buildRouterPrompt,
  deterministicSlug,
  routeArchetype,
  type CatalogueEntry,
} from "../src/lib/archetype/route.ts";

const CATALOGUE: CatalogueEntry[] = [
  { slug: "mode-sac", label: "sac", ads: 40 },
  { slug: "mode-sac-femme", label: "sac femme", ads: 24 },
  { slug: "beaute-serum-30ml", label: "serum 30ml", ads: 51 },
  { slug: "gadgets-ecouteur-bluetooth", label: "ecouteur bluetooth", ads: 53 },
];

const JEEP = "JEEP BULUO Messenger Bags Men's Large Capacity Chest Sling Split Leather Bag";

/* ── lexique bilingue ───────────────────────────────────────────────────── */

test("lexique : un titre anglais produit un nom français", () => {
  assert.equal(detectNoun(JEEP, "mode"), "sac");
  assert.equal(detectNoun("Vitamin C Serum 30ml", "beaute"), "serum");
  assert.equal(detectNoun("Bluetooth TWS earbuds", "gadgets"), "ecouteur");
  assert.equal(detectNoun("Lace Front Wig human hair", "cheveux"), "perruque");
});

test("lexique : un titre français continue de fonctionner", () => {
  assert.equal(detectNoun("Sérum visage vitamine C", "beaute"), "serum");
  assert.equal(detectNoun("Robe en wax", "mode"), "robe");
});

test("lexique : inconnu → repli « produit »", () => {
  const archetype = buildArchetype({ text: "OBJET-8842 XYZ", fallbackCategory: "mode" });
  assert.equal(archetype.noun, "produit");
  assert.equal(archetype.slug, "mode-produit");
});

test("genre : men's / women's / français", () => {
  assert.equal(detectGender("Messenger Bags Men's"), "masculin");
  assert.equal(detectGender("sac pour femme"), "feminin");
  assert.equal(detectGender("sac"), undefined);
});

/* ── slug déterministe ──────────────────────────────────────────────────── */

test("routage : le sac Jeep tombe sur mode-sac, pas mode-produit", () => {
  const { slug } = deterministicSlug(JEEP, "mode", CATALOGUE);
  assert.equal(slug, "mode-sac");
});

test("routage : le genre départage quand les deux marchés existent", () => {
  const { slug } = deterministicSlug("Women's leather handbag tote bag", "mode", CATALOGUE);
  assert.equal(slug, "mode-sac-femme");
});

test("routage : un sérum anglais tombe sur beaute-serum-30ml", () => {
  const { slug } = deterministicSlug("Vitamin C Serum 30ml for face", "beaute", CATALOGUE);
  assert.equal(slug, "beaute-serum-30ml");
});

/* ── routeur ────────────────────────────────────────────────────────────── */

test("routeur : le lexique suffit quand le type est connu", async () => {
  let asked = false;
  const result = await routeArchetype({
    text: JEEP,
    category: "mode",
    catalogue: CATALOGUE,
    ask: async () => {
      asked = true;
      return '{"slug":"mode-sac"}';
    },
  });

  assert.equal(result.slug, "mode-sac");
  assert.equal(result.source, "lexique");
  assert.equal(asked, false, "le modèle ne doit pas être appelé si le lexique suffit");
});

test("routeur : appelé une fois quand le lexique échoue, et retenu", async () => {
  const result = await routeArchetype({
    text: "OBJET-8842 XYZ",
    category: "mode",
    catalogue: CATALOGUE,
    ask: async () => '{"slug":"mode-sac"}',
  });

  assert.equal(result.slug, "mode-sac");
  assert.equal(result.source, "routeur");
});

test("routeur : un slug inventé est rejeté", async () => {
  const result = await routeArchetype({
    text: "OBJET-8842 XYZ",
    category: "mode",
    catalogue: CATALOGUE,
    ask: async () => '{"slug":"mode-sac-extra-large"}',
  });

  assert.equal(result.slug, null);
  assert.equal(result.source, "aucun");
  assert.match(result.reason ?? "", /n'existe pas dans le catalogue/);
});

test("routeur : null assumé → aucun marché, jamais un mauvais", async () => {
  const result = await routeArchetype({
    text: "OBJET-8842 XYZ",
    category: "mode",
    catalogue: CATALOGUE,
    ask: async () => '{"slug":null}',
  });

  assert.equal(result.slug, null);
  assert.equal(result.source, "aucun");
});

test("routeur : sans modèle disponible, on ne devine pas", async () => {
  const result = await routeArchetype({
    text: "OBJET-8842 XYZ",
    category: "mode",
    catalogue: CATALOGUE,
  });

  assert.equal(result.slug, null);
  assert.equal(result.source, "aucun");
});

test("routeur : catalogue vide → aucun marché", async () => {
  const result = await routeArchetype({ text: JEEP, category: "mode", catalogue: [] });
  assert.equal(result.slug, null);
  assert.equal(result.reason, "Aucun marché collecté.");
});

test("routeur : le prompt contient la liste fermée des marchés", () => {
  const prompt = buildRouterPrompt(JEEP, "mode", CATALOGUE);
  assert.match(prompt, /mode-sac/);
  assert.match(prompt, /N'invente jamais un slug/);
  assert.match(prompt, /\{"slug": null\}/);
});
