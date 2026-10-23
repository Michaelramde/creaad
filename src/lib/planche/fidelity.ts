/**
 * Score de fidélité de la planche (SPEC §9.4) — 0 à 100.
 *
 *   couverture  30   slots obligatoires remplis, pondérés
 *   résolution  20   taille des visuels retenus
 *   consensus   20   nombre de sources réellement distinctes
 *   cohérence   15   les vues montrent-elles le même article ?
 *   texte       15   lisibilité du label (OCR + macro)
 *
 * Seuil 65. En dessous, la production est **refusée** : produire un brief
 * sur une planche douteuse coûte plus cher qu'un refus.
 */
import type { Regime } from "../matching/types.ts";
import { countDistinctSources } from "./phash.ts";
import { resolutionRatio, type CandidateImage } from "./select.ts";
import type { SlotId, SlotSpec } from "./slots.ts";

export const FIDELITY_THRESHOLD = 65;
/** Régime non détenu : impossible d'exiger des prises de vue, plafond assumé. */
export const NON_DETENU_CAP = 80;

export type FidelityGate = "PASSED" | "LOW_SCORE" | "MISSING_SLOTS";

export interface FidelityBreakdown {
  coverage: number;
  resolution: number;
  consensus: number;
  consistency: number;
  text: number;
}

export interface FidelityInput {
  regime: Regime;
  specs: readonly SlotSpec[];
  filled: readonly SlotId[];
  images: readonly CandidateImage[];
  consistency: number;
  labelOcrConfidence: number;
  hasMacroLabel: boolean;
}

export interface FidelityResult {
  score: number;
  breakdown: FidelityBreakdown;
  missing: SlotId[];
  gatePassed: boolean;
  gate: FidelityGate;
  qualityNote?: string;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function computeFidelity(input: FidelityInput): FidelityResult {
  const totalWeight = input.specs.reduce((acc, s) => acc + s.weight, 0);
  const filledWeight = input.specs
    .filter((s) => input.filled.includes(s.id))
    .reduce((acc, s) => acc + s.weight, 0);

  const coverage = totalWeight === 0 ? 0 : (filledWeight / totalWeight) * 30;

  const resAvg =
    input.images.length === 0
      ? 0
      : input.images.reduce((acc, img) => acc + resolutionRatio(img), 0) / input.images.length;
  const resolution = resAvg * 20;

  // Trois sources distinctes suffisent à considérer une spec comme corroborée.
  const hashed = input.images.filter(
    (i): i is CandidateImage & { phash: string } => typeof i.phash === "string",
  );
  const distinct = countDistinctSources(hashed);
  const consensus = Math.min(1, distinct / 3) * 20;

  const consistency = clamp01(input.consistency) * 15;

  // Sans macro de label, le texte n'est jamais considéré comme pleinement fiable.
  const textScore = clamp01(input.labelOcrConfidence) * 15 * (input.hasMacroLabel ? 1 : 0.5);

  const breakdown: FidelityBreakdown = {
    coverage: round(coverage),
    resolution: round(resolution),
    consensus: round(consensus),
    consistency: round(consistency),
    text: round(textScore),
  };

  const raw = Math.round(
    breakdown.coverage +
      breakdown.resolution +
      breakdown.consensus +
      breakdown.consistency +
      breakdown.text,
  );

  const missing = input.specs.filter((s) => !input.filled.includes(s.id)).map((s) => s.id);
  const score = input.regime === "non_detenu" ? Math.min(raw, NON_DETENU_CAP) : raw;

  // Régime détenu : on peut exiger les prises de vue manquantes, donc on bloque.
  // Régime non détenu : le commerçant n'a pas le produit, bloquer serait absurde.
  const gate: FidelityGate =
    input.regime === "detenu" && missing.length > 0
      ? "MISSING_SLOTS"
      : score < FIDELITY_THRESHOLD
        ? "LOW_SCORE"
        : "PASSED";

  const qualityNote =
    input.regime === "non_detenu"
      ? `Planche bâtie sur des visuels fournisseur — fidélité plafonnée à ${NON_DETENU_CAP}. ${
          missing.length > 0 ? `Vues manquantes : ${missing.join(", ")}.` : "Toutes les vues requises sont couvertes."
        }`
      : missing.length > 0
        ? `Vues manquantes : ${missing.join(", ")}. Reprends ces photos pour débloquer la production.`
        : undefined;

  return {
    score,
    breakdown,
    missing,
    gatePassed: gate === "PASSED",
    gate,
    qualityNote,
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
