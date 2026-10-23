/** Lecture d'une variante à partir d'un libellé libre (« Noir, 30 ml »). */
import { extractCapacity } from "../archetype/extract.ts";
import { canonicalColor } from "./score.ts";
import { normalize } from "./text.ts";
import type { Variant } from "./types.ts";

const COLOR_WORDS = [
  "noir", "black", "blanc", "white", "rouge", "red", "bleu", "blue", "vert", "green",
  "jaune", "yellow", "orange", "rose", "pink", "violet", "purple", "marron", "brun",
  "brown", "gris", "gray", "grey", "beige", "dore", "doree", "gold", "argente",
  "silver", "transparent", "incolore",
];

const SIZE_RE = /\b(xxs|xs|s|m|l|xl|xxl|xxxl|\d{2,3})\b/i;

export function extractColorName(text: string | undefined): string | undefined {
  if (!text) return undefined;
  // Découpage sur tout ce qui n'est pas alphanumérique : « Noir, 30 ml » → "noir".
  const tokens = normalize(text).split(/[^a-z0-9]+/);
  for (const word of COLOR_WORDS) {
    if (tokens.includes(word)) return canonicalColor(word);
  }
  return undefined;
}

export function extractSize(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const match = SIZE_RE.exec(normalize(text));
  return match ? (match[1] as string).toUpperCase() : undefined;
}

export function parseVariantLabel(label: string | undefined): Variant {
  if (!label) return {};
  return {
    colorName: extractColorName(label),
    size: extractSize(label),
    capacity: extractCapacity(label),
  };
}

/** Ne conserve que les champs réellement renseignés. */
export function compactVariant(variant: Variant): Variant {
  return Object.fromEntries(
    Object.entries(variant).filter(([, v]) => typeof v === "string" && v.length > 0),
  ) as Variant;
}
