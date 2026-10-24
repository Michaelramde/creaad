/**
 * Corroboration multi-sources.
 *
 * Un fait annoncé par une seule source est une rumeur. Annoncé par deux
 * sources indépendantes, c'est un fait. Contredit, il ne sort pas.
 *
 * Indépendance : deux fiches du **même** `productId` ne comptent que pour une
 * source. AliExpress, avis acheteurs et fournisseurs Alibaba sont distincts.
 */
import type { Fact, Facts } from "./types.ts";

export type RawFacts = Record<string, string | number | number[]>;

export interface SourceFacts {
  /** Identifiant de la source : « aliexpress », « avis », « alibaba »… */
  source: string;
  facts: RawFacts;
}

/** Tolérance relative pour comparer deux mesures (5 %). */
export const TOLERANCE = 0.05;

function closeEnough(a: number, b: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  if (scale === 0) return true;
  return Math.abs(a - b) / scale <= TOLERANCE;
}

/** Deux triplets de dimensions égaux à une permutation près. */
function sameDimensions(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  return left.every((value, index) => closeEnough(value, right[index] as number));
}

function sameValue(a: string | number | number[], b: string | number | number[]): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return sameDimensions(a, b);
  if (typeof a === "number" && typeof b === "number") return closeEnough(a, b);
  if (typeof a === "string" && typeof b === "string") {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }
  return false;
}

/**
 * Regroupe les valeurs par accord mutuel. Une valeur retenue par deux sources
 * ou plus l'emporte ; deux groupes concurrents produisent une contradiction.
 */
export function corroborate(sources: readonly SourceFacts[]): Facts {
  const byField = new Map<string, { value: string | number | number[]; sources: string[] }[]>();

  for (const { source, facts } of sources) {
    for (const [field, value] of Object.entries(facts)) {
      const groups = byField.get(field) ?? [];
      const existing = groups.find((group) => sameValue(group.value, value));

      if (existing) {
        if (!existing.sources.includes(source)) existing.sources.push(source);
      } else {
        groups.push({ value, sources: [source] });
      }

      byField.set(field, groups);
    }
  }

  const result: Facts = {};

  for (const [field, groups] of byField) {
    groups.sort((a, b) => b.sources.length - a.sources.length);
    const best = groups[0] as { value: string | number | number[]; sources: string[] };

    if (groups.length === 1) {
      result[field] = {
        value: best.value,
        sources: best.sources,
        confidence: best.sources.length >= 2 ? "corroboré" : "unique",
      } satisfies Fact;
      continue;
    }

    // Plusieurs valeurs : corroboré seulement si la meilleure devance les autres.
    if (best.sources.length >= 2 && best.sources.length > (groups[1]?.sources.length ?? 0)) {
      result[field] = {
        value: best.value,
        sources: best.sources,
        confidence: "corroboré",
      } satisfies Fact;
    } else {
      result[field] = {
        value: best.value,
        sources: best.sources,
        confidence: "contradictoire",
        conflicts: groups.slice(1).map((group) => group.value),
      } satisfies Fact;
    }
  }

  return result;
}

/** Les faits utilisables dans un kit : corroborés ou à source unique. */
export function assertableFacts(facts: Facts): Facts {
  return Object.fromEntries(
    Object.entries(facts).filter(([, fact]) => fact.confidence !== "contradictoire"),
  );
}

/** Texte prêt à être injecté dans un prompt d'image — vide si rien n'est sûr. */
export function factsForPrompt(facts: Facts): string {
  const parts: string[] = [];
  const usable = assertableFacts(facts);

  const volume = usable.volumeMl;
  if (volume) parts.push(`${volume.value} ml`);

  const dims = usable.lengthWidthHeightMm;
  if (dims && Array.isArray(dims.value)) {
    const [l, w, h] = dims.value;
    parts.push(`${(l as number) / 10} × ${(w as number) / 10} × ${(h as number) / 10} cm`);
  }

  const material = usable.material;
  if (material && typeof material.value === "string") parts.push(material.value);

  return parts.join(", ");
}
