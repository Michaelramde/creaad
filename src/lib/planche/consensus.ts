/**
 * Consensus inter-annonces pour les specs (dimensions, poids, contenance…).
 *
 * ⚠️ Règle centrale : **seules les sources réellement distinctes comptent.**
 * Trois annonces qui recopient la même photo ne corroborent rien — c'est le
 * « faux consensus », le risque n°2 du produit.
 *
 * Divergence → fourchette affichée, jamais une valeur choisie arbitrairement.
 */
import { countDistinctSources, type HashedImage } from "./phash.ts";

export type Confidence = "none" | "low" | "medium" | "high";

export interface SpecObservation extends HashedImage {
  field: string;
  value: string;
  /** Renseigné par `dedupe()` : faux si l'image est une copie d'une autre source. */
  isDistinctSource?: boolean;
}

export interface SpecConsensus {
  field: string;
  value?: string;
  range?: [string, string];
  confidence: Confidence;
  distinctSources: number;
  observations: number;
  conflicts: string[];
}

const NUM_RE = /^(-?\d+(?:[.,]\d+)?)\s*([a-zA-Z%]*)$/;

function parseNumber(value: string): { n: number; unit: string } | undefined {
  const m = NUM_RE.exec(value.trim().replace(/\s+/g, ""));
  if (!m) return undefined;
  return { n: Number((m[1] as string).replace(",", ".")), unit: (m[2] as string).toLowerCase() };
}

function sameUnit(a: string, b: string): boolean {
  return a === b || a === "" || b === "";
}

/** Regroupe les observations par champ, en écartant les copies d'images. */
export function consensus(observations: readonly SpecObservation[]): SpecConsensus[] {
  const byField = new Map<string, SpecObservation[]>();
  for (const o of observations) {
    const list = byField.get(o.field) ?? [];
    list.push(o);
    byField.set(o.field, list);
  }

  const out: SpecConsensus[] = [];

  for (const [field, list] of byField) {
    // Une observation par source distincte : les doublons d'image sont écartés.
    const distinctCount = countDistinctSources(list);
    const kept = list.filter((o) => o.isDistinctSource !== false);
    const values = [...new Set(kept.map((o) => o.value.trim()))];

    if (values.length === 0) {
      out.push({
        field,
        confidence: "none",
        distinctSources: 0,
        observations: list.length,
        conflicts: [],
      });
      continue;
    }

    if (values.length === 1) {
      out.push({
        field,
        value: values[0],
        // Une valeur unique mais issue d'une seule source n'est pas corroborée.
        confidence: distinctCount >= 3 ? "high" : distinctCount === 2 ? "medium" : "low",
        distinctSources: distinctCount,
        observations: list.length,
        conflicts: [],
      });
      continue;
    }

    // Divergence : on expose une fourchette quand c'est numérique.
    const numbers = values.map(parseNumber);
    const allNumeric = numbers.every(Boolean);
    const units = values.map((v) => parseNumber(v)?.unit ?? "");
    const comparable =
      allNumeric && units.every((u) => sameUnit(u, units[0] as string));

    let range: [string, string] | undefined;
    if (comparable) {
      const sorted = [...values].sort((a, b) => (parseNumber(a)?.n ?? 0) - (parseNumber(b)?.n ?? 0));
      range = [sorted[0] as string, sorted.at(-1) as string];
    }

    out.push({
      field,
      range,
      confidence: "low",
      distinctSources: distinctCount,
      observations: list.length,
      conflicts: values,
    });
  }

  return out.sort((a, b) => a.field.localeCompare(b.field));
}

/** Nombre de sources distinctes sur un ensemble d'observations. */
export function corroborationCount(observations: readonly HashedImage[]): number {
  return countDistinctSources(observations);
}
