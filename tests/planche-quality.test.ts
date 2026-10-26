/**
 * Qualité d'image mesurée — la correction du score de fidélité.
 *
 * L'audit relevait que les 50 points de « couverture » mesuraient la réussite
 * du classificateur de vues, pas la photo. On mesure désormais les pixels :
 * une image floue ou sur fond encombré fait baisser le score, jamais monter.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { computeFidelity } from "../src/lib/planche/fidelity.ts";
import { borderStdDev, laplacianVariance, qualityFromPixels } from "../src/lib/planche/quality.ts";
import { REQUIRED_SLOTS } from "../src/lib/planche/slots.ts";

/** Image synthétique : damier net ou dégradé lisse (donc « flou »). */
function checkerboard(size = 64): Uint8Array {
  const gray = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      gray[y * size + x] = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0 ? 255 : 0;
    }
  }
  return gray;
}

function gradient(size = 64): Uint8Array {
  const gray = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) gray[y * size + x] = Math.round((x / size) * 255);
  }
  return gray;
}

test("une image nette a une variance de Laplacien très supérieure à un dégradé", () => {
  const sharp = laplacianVariance(checkerboard(), 64, 64);
  const blurry = laplacianVariance(gradient(), 64, 64);
  assert.ok(sharp > blurry * 50, `nette ${sharp.toFixed(0)} vs floue ${blurry.toFixed(2)}`);
  assert.ok(sharp > 0);
});

test("un fond uni est reconnu comme uniforme, un damier non", () => {
  const uniform = new Uint8Array(64 * 64).fill(240);
  assert.ok(borderStdDev(uniform, 64, 64) < 1);
  assert.ok(borderStdDev(checkerboard(), 64, 64) > 80);
});

test("la synthèse privilégie la netteté sans oublier le fond", () => {
  const net = qualityFromPixels(checkerboard(), 64, 64);
  const flou = qualityFromPixels(gradient(), 64, 64);
  assert.ok(net.sharpness > flou.sharpness);
  assert.ok(net.quality > flou.quality);
  assert.ok(net.quality >= 0 && net.quality <= 1);
  assert.ok(flou.quality >= 0 && flou.quality <= 1);
});

test("le score de fidélité baisse quand la qualité mesurée est mauvaise", () => {
  const specs = REQUIRED_SLOTS.beaute;
  const filled = specs.filter((spec) => !spec.macro).map((spec) => spec.id);

  const base = {
    regime: "non_detenu" as const,
    specs: specs.filter((spec) => !spec.macro),
    filled,
    images: [{ id: "a", url: "https://cdn.example/a.jpg", provenance: "fournisseur" as const, width: 2048, height: 2048 }],
    labelOcrConfidence: 1,
    hasMacroLabel: false,
  };

  const sansMesure = computeFidelity(base);
  const bonne = computeFidelity({ ...base, imageQuality: 1 });
  const mauvaise = computeFidelity({ ...base, imageQuality: 0 });

  assert.equal(sansMesure.score, bonne.score, "qualité 1 ne change rien");
  assert.ok(mauvaise.score < bonne.score, `${mauvaise.score} devrait être < ${bonne.score}`);
  // Le facteur est borné : il ne peut pas effondrer une planche correcte.
  assert.ok(mauvaise.score >= Math.round(bonne.score * 0.7) - 1);
  assert.equal(mauvaise.breakdown.imageQuality, 0);
});
