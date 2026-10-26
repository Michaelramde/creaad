/**
 * Mesure du classifieur de repli sur des annonces réelles.
 *
 * L'audit adversarial avait mesuré **29 % de précision** (7/24) avec la
 * version par sous-chaîne. Ce test verrouille la version corrigée :
 * frontières de mot, NFKC, seuil conservateur.
 *
 * Un test qui n'affirme qu'un pourcentage serait fragile. On affirme donc
 * aussi les **trois régressions nommées** qui avaient été constatées.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyHook, MIN_SCORE } from "../src/lib/market/classify.ts";
import { normalize } from "../src/lib/matching/text.ts";
import { LABELLED_HOOKS } from "./fixtures/hooks-labelled.ts";

function evaluate() {
  let correct = 0;
  let abstained = 0;
  const wrong: { id: string; got: string; expected: string }[] = [];

  for (const item of LABELLED_HOOKS) {
    const got = classifyHook(item.hook).family;
    if (got === item.family) correct += 1;
    else if (got === "non-classe") abstained += 1;
    else wrong.push({ id: item.id, got, expected: item.family });
  }

  return {
    total: LABELLED_HOOKS.length,
    correct,
    abstained,
    wrong,
    accuracy: correct / LABELLED_HOOKS.length,
    precisionOnClassified: correct / (correct + wrong.length),
  };
}

test("repli regex : précision mesurée sur 24 annonces réelles", () => {
  const m = evaluate();
  // Baseline historique : 29 %. Plancher verrouillé à 70 %.
  assert.ok(
    m.accuracy >= 0.7,
    `précision ${(m.accuracy * 100).toFixed(0)} % < 70 % (${m.correct}/${m.total})`,
  );
  assert.ok(
    m.precisionOnClassified >= 0.8,
    `précision sur les cas tranchés ${(m.precisionOnClassified * 100).toFixed(0)} % < 80 %`,
  );
  // Une abstention est préférable à une famille fausse : elle sort de la matrice.
  assert.ok(m.abstained <= 4, `trop d'abstentions : ${m.abstained}`);
});

test("régression : un possessif ne suffit plus à classer en témoignage", () => {
  // Avant : « mon » était cherché en sous-chaîne, donc « Montre » matchait.
  assert.notEqual(classifyHook("Montre connectée homme, étanche, IP67").family, "temoignage");
  assert.notEqual(classifyHook("Smart Watch ULTRA, notifications en temps réel").family, "temoignage");
  // Un vrai témoignage, lui, reste reconnu : « j ai » est un motif multi-mots.
  assert.equal(classifyHook("J'ai acheté ce sac, je l'utilise tous les jours").family, "temoignage");
});

test("régression : les caractères « gras » ne vident plus le texte", () => {
  // 𝐋𝐄 𝐆𝐄𝐒𝐓𝐄 … 𝟒.𝟗𝟗𝟗 tombaient en « non classé » : NFKC les ramène en ASCII.
  assert.equal(normalize("𝐋𝐄 𝐆𝐄𝐒𝐓𝐄 𝟒.𝟗𝟗𝟗 𝐅𝐂𝐅𝐀"), "le geste 4.999 fcfa");
  assert.equal(classifyHook("𝐋𝐄 𝐆𝐄𝐒𝐓𝐄 𝐁𝐄𝐀𝐔𝐓𝐄́ ! ✅ 𝐏𝐑𝐈𝐗 : 𝟒.𝟗𝟗𝟗 𝐅𝐂𝐅𝐀").family, "prix-offre");
});

test("régression : « avant » ne capture plus « avant qu'il soit trop tard »", () => {
  assert.notEqual(
    classifyHook("Les stocks fondent, finalise ton achat avant qu'il soit trop tard").family,
    "avant-apres",
  );
});

test("un indice unique et faible ne classe pas", () => {
  assert.equal(MIN_SCORE, 2);
  assert.equal(classifyHook("Bonjour, souhaitez-vous prendre rendez-vous ?").family, "non-classe");
  assert.equal(classifyHook("").family, "non-classe");
  assert.equal(classifyHook(undefined).family, "non-classe");
});

test("départage par spécificité, jamais par l'ordre du tableau", () => {
  // « dernier lot » (urgence) ne doit pas être absorbé par « lot » (prix).
  assert.equal(classifyHook("Il reste 3 pièces en stock, dernier lot").family, "urgence");
});
