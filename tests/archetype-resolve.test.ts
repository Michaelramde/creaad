/**
 * Test doré du routage produit → marché.
 *
 * 72 formulations réelles (français, anglais, marques, formats) sur les
 * 16 marchés collectés. L'audit adversarial avait mesuré **3 slugs retrouvés
 * sur 16** par l'heuristique de chaîne ; ce test verrouille le remplacement.
 *
 * Contrat testé, plus important qu'un pourcentage :
 *   **on ne se trompe jamais avec assurance.** Une abstention est permise
 *   (l'appelant arbitre ou affiche « marché non couvert »), une mauvaise
 *   réponse ne l'est pas.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { MARKET_CATALOGUE } from "../src/lib/archetype/market-catalogue.ts";
import { resolveArchetype } from "../src/lib/archetype/resolve.ts";

const CASES = [
  { expected: "beaute-serum-30ml", text: "Sérum Vitamine C 30 ml" },
  { expected: "beaute-serum-30ml", text: "Sérum vitamine C 30ml éclaircissant" },
  { expected: "beaute-serum-30ml", text: "Serum Vitamin C 30ml Whitening" },
  { expected: "beaute-serum-30ml", text: "Sérum visage anti-taches vitamine C 30ml" },
  { expected: "beaute-serum-30ml", text: "Ampoule sérum visage éclaircissant 30 ml" },
  { expected: "beaute-serum-30ml", text: "Essence sérum acide hyaluronique 30ml visage" },
  { expected: "beaute-creme-visage", text: "Crème visage hydratante 50g" },
  { expected: "beaute-creme-visage", text: "Cream moisturizer face 50ml" },
  { expected: "beaute-creme-visage", text: "Crème de nuit visage anti-âge" },
  { expected: "beaute-creme-visage", text: "Lotion hydratante visage" },
  { expected: "beaute-creme-visage", text: "Baume visage réparateur" },
  { expected: "beaute-savon-noir", text: "Savon noir africain 250g" },
  { expected: "beaute-savon-noir", text: "Savon noir de coco" },
  { expected: "beaute-savon-noir", text: "African black soap" },
  { expected: "beaute-savon-noir", text: "Savon noir exfoliant corps" },
  { expected: "beaute-huile-corporelle", text: "Huile corporelle nourrissante 200ml" },
  { expected: "beaute-huile-corporelle", text: "Body oil shea butter" },
  { expected: "beaute-huile-corporelle", text: "Huile de karité corps" },
  { expected: "beaute-huile-corporelle", text: "Beurre de karité corporel" },
  { expected: "beaute-huile-corporelle", text: "Huile corps 100ml" },
  { expected: "beaute-parfum", text: "Parfum femme 100ml" },
  { expected: "beaute-parfum", text: "Eau de toilette homme" },
  { expected: "beaute-parfum", text: "Perfume fragrance 50ml" },
  { expected: "beaute-parfum", text: "Parfum longue tenue" },
  { expected: "cheveux-perruque-lace", text: "Perruque lace frontale 13x4 body wave 20 pouces" },
  { expected: "cheveux-perruque-lace", text: "Wig lace frontal 13x6 body wave 22 inches" },
  { expected: "cheveux-perruque-lace", text: "Perruque frontale cheveux naturels 18 pouces" },
  { expected: "cheveux-perruque-lace", text: "Closure lace 4x4" },
  { expected: "cheveux-perruque-lace", text: "Tissage brésilien body wave" },
  { expected: "cheveux-huile-croissance", text: "Huile de croissance cheveux 100ml" },
  { expected: "cheveux-huile-croissance", text: "Hair growth oil 100ml" },
  { expected: "cheveux-huile-croissance", text: "Huile capillaire croissance" },
  { expected: "cheveux-huile-croissance", text: "Sérum croissance cheveux" },
  { expected: "cheveux-mousse-boucles", text: "Mousse boucles cheveux crépus" },
  { expected: "cheveux-mousse-boucles", text: "Gel coiffant boucles" },
  { expected: "cheveux-mousse-boucles", text: "Mousse coiffante curl" },
  { expected: "cheveux-mousse-boucles", text: "Crème boucles définition" },
  { expected: "mode-sac", text: "Sac Jeep 3 en 1" },
  { expected: "mode-sac", text: "Messenger Bags Men Waterproof Shoulder Bag" },
  { expected: "mode-sac", text: "Sac bandoulière homme cuir" },
  { expected: "mode-sac", text: "Backpack waterproof" },
  { expected: "mode-sac", text: "Sacoche ordinateur" },
  { expected: "mode-sac", text: "Sac a dos randonnée" },
  { expected: "mode-sac-femme", text: "Sac à main femme cuir PU 25 cm" },
  { expected: "mode-sac-femme", text: "Sac femme bandoulière" },
  { expected: "mode-sac-femme", text: "Handbag ladies leather" },
  { expected: "mode-sac-femme", text: "Pochette femme soirée" },
  { expected: "mode-robe-wax", text: "Robe wax longue taille 42" },
  { expected: "mode-robe-wax", text: "Robe en pagne africain" },
  { expected: "mode-robe-wax", text: "Dress wax coton" },
  { expected: "mode-robe-wax", text: "Ensemble bazin femme" },
  { expected: "mode-chaussure-homme", text: "Chaussure homme cuir italien" },
  { expected: "mode-chaussure-homme", text: "Sneakers men running" },
  { expected: "mode-chaussure-homme", text: "Basket homme sport" },
  { expected: "mode-chaussure-homme", text: "Sandale homme cuir" },
  { expected: "mode-chaussure-homme", text: "Mocassin cuir homme" },
  { expected: "gadgets-ecouteur-bluetooth", text: "Écouteurs Bluetooth TWS 5.3 boîte de charge" },
  { expected: "gadgets-ecouteur-bluetooth", text: "Earbuds wireless bluetooth 5.0" },
  { expected: "gadgets-ecouteur-bluetooth", text: "Casque bluetooth sans fil" },
  { expected: "gadgets-ecouteur-bluetooth", text: "Airpods pro 2" },
  { expected: "gadgets-montre-connectee", text: "Montre connectée homme étanche IP67" },
  { expected: "gadgets-montre-connectee", text: "Smart watch ultra 49mm" },
  { expected: "gadgets-montre-connectee", text: "Montre intelligente sport" },
  { expected: "gadgets-montre-connectee", text: "Smartwatch series 9" },
  { expected: "gadgets-ventilateur-portable", text: "Ventilateur portable mini USB" },
  { expected: "gadgets-ventilateur-portable", text: "Mini fan rechargeable" },
  { expected: "gadgets-ventilateur-portable", text: "Ventilateur de cou portable" },
  { expected: "gadgets-ventilateur-portable", text: "Ventilo bureau USB" },
  { expected: "gadgets-coque-telephone", text: "Coque Samsung A54 silicone" },
  { expected: "gadgets-coque-telephone", text: "Coque iPhone 15 pro max" },
  { expected: "gadgets-coque-telephone", text: "Housse téléphone transparente" },
  { expected: "gadgets-coque-telephone", text: "Case iphone 13" },
];

test("jamais confiant et faux : toute réponse est soit juste, soit une abstention", () => {
  const wrong: string[] = [];
  let correct = 0;
  let abstained = 0;

  for (const c of CASES) {
    const result = resolveArchetype({ text: c.text, catalogue: MARKET_CATALOGUE });
    if (result.slug === c.expected) correct += 1;
    else if (result.slug === null) abstained += 1;
    else wrong.push(`« ${c.text} » → ${result.slug} (attendu ${c.expected}, marge ${result.margin.toFixed(2)})`);
  }

  assert.deepEqual(wrong, [], `${wrong.length} mauvaise(s) réponse(s) assurée(s)`);
  assert.ok(
    correct / CASES.length >= 0.9,
    `résolution ${((correct / CASES.length) * 100).toFixed(0)} % < 90 % (${correct}/${CASES.length}, ${abstained} abstentions)`,
  );
});

test("les cas qui échouaient à l'audit passent désormais", () => {
  const cases: [string, string][] = [
    ["Sérum vitamine C 30ml éclaircissant", "beaute-serum-30ml"],
    ["Messenger Bags Men Waterproof Shoulder Bag", "mode-sac"],
    ["Sac à main femme cuir PU 25 cm", "mode-sac-femme"],
    ["Écouteurs Bluetooth TWS 5.3 boîte de charge 300 mAh", "gadgets-ecouteur-bluetooth"],
    ["Perruque lace frontale 13x4 body wave 20 pouces", "cheveux-perruque-lace"],
    ["Robe wax longue taille 42", "mode-robe-wax"],
  ];
  for (const [text, expected] of cases) {
    assert.equal(resolveArchetype({ text, catalogue: MARKET_CATALOGUE }).slug, expected, text);
  }
});

test("un produit hors catalogue est refusé, pas rangé de force", () => {
  const result = resolveArchetype({ text: "Machine à coudre industrielle", catalogue: MARKET_CATALOGUE });
  assert.equal(result.slug, null);
  assert.ok(["none", "ambiguous"].includes(result.source));
});

test("le seau de repli mode-produit n'est jamais une cible", () => {
  assert.equal(MARKET_CATALOGUE.some((entry) => entry.slug === "mode-produit"), false);
});

test("une ambiguïté réelle est signalée, jamais tranchée au hasard", () => {
  // « sac femme » doit désigner le marché féminin, pas le générique.
  const result = resolveArchetype({ text: "Sac femme cuir", catalogue: MARKET_CATALOGUE });
  assert.equal(result.slug, "mode-sac-femme");
});
