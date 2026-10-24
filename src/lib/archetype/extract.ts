/**
 * Extraction d'archétype — première couche, déterministe.
 *
 * Sans code-barres, on n'identifie pas un SKU : on identifie un **type de
 * produit** et ses attributs (« sérum vitamine C 30 ml »), qui devient la clé
 * du cache marché (SPEC §3, §10).
 */
import { normalize } from "../matching/text.ts";
import type { Category } from "../matching/types.ts";

/**
 * Synonymes anglais → nom canonique français.
 *
 * Les fiches fournisseur sont en anglais (« Messenger Bags Men's… ») alors que
 * le lexique et la collecte sont en français. Sans cette table, tout produit
 * importé tombait sur le repli « produit » — et donc sur un marché vide.
 */
const ENGLISH_NOUNS: { pattern: RegExp; noun: string; category: Category }[] = [
  { pattern: /\b(bag|bags|purse|handbag|tote|backpack|messenger|sling|clutch)\b/, noun: "sac", category: "mode" },
  { pattern: /\b(wig|wigs|closure|bundle|bundles|lace front)\b/, noun: "perruque", category: "cheveux" },
  { pattern: /\b(earbuds|earbud|headphone|headphones|earphone|earphones|tws)\b/, noun: "ecouteur", category: "gadgets" },
  { pattern: /\b(dress|dresses|gown)\b/, noun: "robe", category: "mode" },
  { pattern: /\b(shoe|shoes|sneaker|sneakers|sandal|sandals|boot|boots)\b/, noun: "chaussure", category: "mode" },
  { pattern: /\b(watch|watches|smartwatch)\b/, noun: "montre", category: "gadgets" },
  { pattern: /\b(phone case|case for|shell)\b/, noun: "coque", category: "gadgets" },
  { pattern: /\b(fan|fans)\b/, noun: "ventilateur", category: "gadgets" },
  { pattern: /\b(power bank|charger|charging)\b/, noun: "batterie", category: "gadgets" },
  { pattern: /\b(speaker|soundbox)\b/, noun: "enceinte", category: "gadgets" },
  { pattern: /\b(serum|ampoule|essence)\b/, noun: "serum", category: "beaute" },
  { pattern: /\b(cream|moisturizer|moisturiser|lotion)\b/, noun: "creme", category: "beaute" },
  { pattern: /\b(soap|cleanser)\b/, noun: "savon", category: "beaute" },
  { pattern: /\b(perfume|fragrance|parfum)\b/, noun: "parfum", category: "beaute" },
  { pattern: /\b(body oil|hair oil|growth oil)\b/, noun: "huile", category: "beaute" },
];

/** « Men's » / « women's » : le catalogue distingue parfois les deux. */
export type Gender = "masculin" | "feminin" | undefined;

export function detectGender(text: string): Gender {
  const n = normalize(text);
  if (/\b(women|woman|female|ladies|lady|femme|fille|girl)\b/.test(n)) return "feminin";
  if (/\b(men|man|male|gents|homme|garcon|boy)\b/.test(n)) return "masculin";
  return undefined;
}

const CATEGORY_KEYWORDS: Record<Category, string[]> = {
  beaute: [
    "serum", "creme", "lotion", "huile", "parfum", "savon", "gel", "shampoing",
    "masque", "fond de teint", "mascara", "rouge a levres", "gloss", "correcteur",
    "anti taches", "eclaircissant", "hydratant", "nettoyant", "deodorant", "baume",
  ],
  cheveux: [
    "perruque", "frontale", "extension", "meche", "tissage",
    "cran", "tresse", "huile capillaire", "serum capillaire",
  ],
  mode: [
    "robe", "chemise", "tshirt", "t-shirt", "pantalon", "jean", "jupe", "sac",
    "chaussure", "sandale", "basket", "ensemble", "abaya", "boubou", "foulard",
    "montre", "lunettes", "bijou", "collier", "bracelet", "boucles",
  ],
  gadgets: [
    "ecouteur", "casque", "chargeur", "batterie", "lampe",
    "ventilateur", "montre connectee", "enceinte", "camera",
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

  // Fiches fournisseur en anglais : on traduit vers le nom canonique français,
  // sans quoi tout produit importé retombait sur « produit ».
  if (!noun) {
    for (const entry of ENGLISH_NOUNS) {
      if (category && entry.category !== category) continue;
      if (entry.pattern.test(n)) {
        noun = entry.noun;
        break;
      }
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
