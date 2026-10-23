/**
 * Extraction d'archétype — première couche, déterministe.
 *
 * Sans code-barres, on n'identifie pas un SKU : on identifie un **type de
 * produit** et ses attributs (« sérum vitamine C 30 ml »), qui devient la clé
 * du cache marché (SPEC §3, §10).
 */
import { normalize } from "../matching/text.ts";
import type { Category } from "../matching/types.ts";

const CATEGORY_KEYWORDS: Record<Category, string[]> = {
  beaute: [
    "serum", "creme", "lotion", "huile", "parfum", "savon", "gel", "shampoing",
    "masque", "fond de teint", "mascara", "rouge a levres", "gloss", "correcteur",
    "anti taches", "eclaircissant", "hydratant", "nettoyant", "deodorant", "baume",
  ],
  cheveux: [
    "perruque", "wig", "lace", "frontale", "extension", "meche", "tissage",
    "closure", "bundle", "cran", "tresse", "huile capillaire", "serum capillaire",
  ],
  mode: [
    "robe", "chemise", "tshirt", "t-shirt", "pantalon", "jean", "jupe", "sac",
    "chaussure", "sandale", "basket", "ensemble", "abaya", "boubou", "foulard",
    "montre", "lunettes", "bijou", "collier", "bracelet", "boucles",
  ],
  gadgets: [
    "ecouteur", "casque", "chargeur", "power bank", "batterie", "lampe",
    "ventilateur", "montre connectee", "smartwatch", "enceinte", "camera",
    "support telephone", "cable", "adaptateur", "projecteur", "mini fer",
  ],
};

/** Unités reconnues, normalisées vers une forme canonique. */
const UNIT_CANON: Record<string, string> = {
  ml: "ml", cl: "cl", l: "l", g: "g", kg: "kg", mg: "mg",
  mm: "mm", cm: "cm", m: "m",
  pouce: "pouce", pouces: "pouce", inch: "pouce", inches: "pouce",
  piece: "piece", pieces: "piece", pcs: "piece", pc: "piece",
};

const MEASURE_RE = /(\d+(?:[.,]\d+)?)\s*(ml|cl|kg|mg|g|l|mm|cm|m|pouces?|inch(?:es)?|pieces?|pcs?|pc)\b/g;

export interface Archetype {
  slug: string;
  label: string;
  category: Category;
  noun: string;
  capacity?: string;
}

export function detectCategory(text: string): Category | undefined {
  const n = normalize(text);
  let best: { category: Category; score: number } | undefined;

  for (const [category, words] of Object.entries(CATEGORY_KEYWORDS) as [Category, string[]][]) {
    const score = words.reduce((acc, w) => (n.includes(w) ? acc + w.length : acc), 0);
    if (score > 0 && (!best || score > best.score)) best = { category, score };
  }

  return best?.category;
}

/** Mot-clé de catégorie le plus long trouvé = le « nom » du produit. */
export function detectNoun(text: string, category?: Category): string | undefined {
  const n = normalize(text);
  const pool = category
    ? ([[category, CATEGORY_KEYWORDS[category]]] as [Category, string[]][])
    : (Object.entries(CATEGORY_KEYWORDS) as [Category, string[]][]);

  let noun: string | undefined;
  for (const [, words] of pool) {
    for (const w of words) {
      if (n.includes(w) && (!noun || w.length > noun.length)) noun = w;
    }
  }
  return noun;
}

/** Première mesure trouvée — contenance, longueur, poids. */
export function extractCapacity(text: string): string | undefined {
  MEASURE_RE.lastIndex = 0;
  const match = MEASURE_RE.exec(normalize(text));
  if (!match) return undefined;
  const value = (match[1] as string).replace(",", ".");
  const unit = UNIT_CANON[(match[2] as string).replace(/s$/, "")] ?? match[2];
  return `${value}${unit === "piece" ? "pc" : unit}`;
}

export function buildArchetype(input: {
  text: string;
  fallbackCategory: Category;
}): Archetype {
  const category = detectCategory(input.text) ?? input.fallbackCategory;
  const noun = detectNoun(input.text, category) ?? "produit";
  const capacity = extractCapacity(input.text);

  const slug = [category, noun, capacity]
    .filter(Boolean)
    .join("-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

  const label = [noun, capacity].filter(Boolean).join(" ");

  return { slug, label: label.charAt(0).toUpperCase() + label.slice(1), category, noun, capacity };
}
