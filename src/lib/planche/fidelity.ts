/**
 * Score de fidélité de la planche — 0 à 100.
 *
 *   couverture  50   slots obligatoires remplis, pondérés
 *   résolution  25   taille des visuels retenus
 *   texte       25   lisibilité du label (OCR + macro)
 *
 * ⚠️ Recalibré le 24/10 après exécution réelle : la version initiale
 * (30/20/20/15/15) réservait 35 points au « consensus » et à la « cohérence »
 * inter-vues — deux mesures qui exigent un décodage d'image et plusieurs
 * sources, que le pipeline ne fournit pas encore. Ces 35 points étaient donc
 * distribués à partir d'une constante inventée (0,7), ce qui gonflait le score
 * sans rien mesurer. On ne note désormais que ce qui est mesuré.
 *
 * Le consensus inter-annonces reste calculé — mais dans le **kit matière**
 * (specs), là où il a un sens.
 */
import type { Regime } from "../matching/types.ts";
import { countDistinctSources } from "./phash.ts";
import { resolutionRatio, type CandidateImage } from "./select.ts";
import type { SlotId, SlotSpec } from "./slots.ts";

export const FIDELITY_THRESHOLD = 65;
/** Régime non détenu : impossible d'exiger des prises de vue, plafond assumé. */
export const NON_DETENU_CAP = 80;

export const FIDELITY_WEIGHTS = { coverage: 50, resolution: 25, text: 25 } as const;

export type FidelityGate = "PASSED" | "LOW_SCORE" | "MISSING_SLOTS";

export interface FidelityBreakdown {
  coverage: number;
  resolution: number;
  text: number;
  /** Informations non notées, pour l'audit. */
  distinctSources: number;
}

export interface FidelityInput {
  regime: Regime;
  specs: readonly SlotSpec[];
  filled: readonly SlotId[];
  images: readonly CandidateImage[];
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

  const coverage =
    totalWeight === 0 ? 0 : (filledWeight / totalWeight) * FIDELITY_WEIGHTS.coverage;

  const resAvg =
    input.images.length === 0
      ? 0
      : input.images.reduce((acc, img) => acc + resolutionRatio(img), 0) / input.images.length;
  const resolution = resAvg * FIDELITY_WEIGHTS.resolution;

  // Sans macro de label, le texte n'est jamais considéré comme pleinement fiable.
  const text =
    clamp01(input.labelOcrConfidence) *
    FIDELITY_WEIGHTS.text *
    (input.hasMacroLabel ? 1 : 0.5);

  const hashed = input.images.filter(
    (i): i is CandidateImage & { phash: string } => typeof i.phash === "string",
  );

  const breakdown: FidelityBreakdown = {
    coverage: round(coverage),
    resolution: round(resolution),
    text: round(text),
    distinctSources: countDistinctSources(hashed),
  };

  const raw = Math.round(
    breakdown.coverage + breakdown.resolution + breakdown.text,
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
