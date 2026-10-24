/**
 * Lecture des faits mesurables d'un produit : dimensions, poids, contenance,
 * matière, marque, modèle.
 *
 * Principe : **on lit, on n'estime pas.** Une dimension absente reste absente —
 * un prompt d'image qui invente « 15 cm » produit une scène fausse, alors qu'un
 * prompt muet sur la taille reste honnête.
 */
import type { Dimensions } from "./types.ts";

/** Champs canoniques que l'on cherche à corroborer entre sources. */
export const FACT_FIELDS = [
  "volumeMl",
  "weightG",
  "lengthWidthHeightMm",
  "material",
  "brand",
  "model",
] as const;

export type FactField = (typeof FACT_FIELDS)[number];

const toNumber = (raw: string): number => Number(raw.replace(",", "."));

/** Millimètres par unité. */
const MM: Record<string, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  inch: 25.4,
  in: 25.4,
  '"': 25.4,
  pouce: 25.4,
};

const ML: Record<string, number> = { ml: 1, cl: 10, l: 1000, litre: 1000, oz: 29.5735 };

const volumePattern = /(\d+(?:[.,]\d+)?)\s*(ml|cl|l|litre|oz)\b/gi;
const weightPattern = /(\d+(?:[.,]\d+)?)\s*(kg|g)\b/gi;
const triplePattern =
  /(\d+(?:[.,]\d+)?)\s*(mm|cm|m|inch|in|pouce|")?\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m|inch|in|pouce|")?\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m|inch|in|pouce|")?/i;

/**
 * Cherche des dimensions dans une liste de textes (titre, specs, descriptions).
 * Le premier résultat plausible gagne ; on ne cumule pas des sources ici,
 * c'est le rôle de `corroborate`.
 */
export function parseDimensions(texts: readonly string[]): Dimensions {
  const dimensions: Dimensions = {};

  for (const text of texts) {
    if (!text) continue;

    if (dimensions.volumeMl === undefined) {
      for (const match of text.matchAll(volumePattern)) {
        const value = toNumber(match[1] as string) * (ML[(match[2] as string).toLowerCase()] ?? 1);
        // Un volume réaliste pour un produit vendable : 1 ml à 20 L.
        if (value >= 1 && value <= 20_000) {
          dimensions.volumeMl = Math.round(value * 10) / 10;
          break;
        }
      }
    }

    if (dimensions.weightG === undefined) {
      for (const match of text.matchAll(weightPattern)) {
        const value = toNumber(match[1] as string) * ((match[2] as string).toLowerCase() === "kg" ? 1000 : 1);
        if (value >= 1 && value <= 50_000) {
          dimensions.weightG = Math.round(value);
          break;
        }
      }
    }

    if (dimensions.lengthWidthHeightMm === undefined) {
      const triple = triplePattern.exec(text);
      if (triple) {
        // L'unité est souvent écrite une seule fois, à la fin : « 30×20×10 cm ».
        // On retient la première unité trouvée, où qu'elle soit.
        const shared = (triple[2] ?? triple[4] ?? triple[6] ?? "cm") as string;
        const unit = (raw: string | null | undefined) =>
          MM[String(raw ?? shared).toLowerCase()] ?? MM[shared.toLowerCase()] ?? 1;

        const a = toNumber(triple[1] as string) * unit(triple[2]);
        const b = toNumber(triple[3] as string) * unit(triple[4]);
        const c = toNumber(triple[5] as string) * unit(triple[6]);

        const ordered = [a, b, c].map((n) => Math.round(n));
        // Une boîte tient entre 1 cm et 2 m de côté.
        if (ordered.every((n) => n >= 10 && n <= 2000)) {
          dimensions.lengthWidthHeightMm = ordered as [number, number, number];
        }
      }
    }
  }

  return dimensions;
}

/** Matière, marque et modèle : lus dans les spécifications, jamais devinés. */
export function parseNamedFacts(specs: Record<string, string>): {
  material?: string;
  brand?: string;
  model?: string;
} {
  const pick = (patterns: RegExp): { key: string; value: string } | undefined => {
    for (const [key, value] of Object.entries(specs)) {
      if (patterns.test(key) && value.trim()) return { key, value: value.trim() };
    }
    return undefined;
  };

  const material = pick(/^(material|mati[eè]re|main material|exterior material)/i);
  const brand = pick(/^(brand name|brand|marque)/i);
  const model = pick(/^(model number|model|mod[eè]le|article number)/i);

  return {
    ...(material ? { material: material.value } : {}),
    ...(brand ? { brand: brand.value } : {}),
    ...(model ? { model: model.value } : {}),
  };
}

/** Rassemble les faits d'une fiche : dimensions + champs nommés. */
export function factsFromProduct(input: {
  title: string;
  specs: Record<string, string>;
}): Record<string, string | number | number[]> {
  const texts = [input.title, ...Object.values(input.specs)];
  const dimensions = parseDimensions(texts);
  const named = parseNamedFacts(input.specs);

  const facts: Record<string, string | number | number[]> = {};
  if (dimensions.volumeMl !== undefined) facts.volumeMl = dimensions.volumeMl;
  if (dimensions.weightG !== undefined) facts.weightG = dimensions.weightG;
  if (dimensions.lengthWidthHeightMm !== undefined) {
    facts.lengthWidthHeightMm = dimensions.lengthWidthHeightMm;
  }
  if (named.material) facts.material = named.material;
  if (named.brand) facts.brand = named.brand;
  if (named.model) facts.model = named.model;

  return facts;
}
