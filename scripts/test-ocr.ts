/**
 * Vérification réelle du fournisseur Gemini (OCR).
 * Exerce le code de production, pas une réécriture.
 *
 *   node --env-file=.env.local .tmp/test-ocr.mjs
 */
import { readFile } from "node:fs/promises";

import { GeminiAttributeProvider, GeminiOcrProvider } from "../src/lib/providers/gemini.ts";

const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error("GEMINI_API_KEY absente.");
  process.exit(1);
}

const buffer = await readFile(".tmp/label.png");
const dataUrl = `data:image/png;base64,${buffer.toString("base64")}`;

console.log("→ OCR…");
const ocr = new GeminiOcrProvider(key);
const result = await ocr.extract(dataUrl);
console.log("texte :", JSON.stringify(result.text));
console.log("confiance :", result.confidence, "· fournisseur :", result.provider);

console.log("\n→ Attributs…");
const attrs = new GeminiAttributeProvider(key);
const attributes = await attrs.describe([dataUrl]);
console.log("attributs :", JSON.stringify(attributes));

const expected = ["VITAMIN C SERUM", "BRIGHTENING", "30 ml", "SANS PARFUM"];
const found = expected.filter((e) => result.text.toUpperCase().includes(e.toUpperCase()));
console.log(`\n${found.length}/${expected.length} mentions retrouvées : ${found.join(" | ")}`);
