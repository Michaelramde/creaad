/**
 * Construction de la planche : slots → sélection → dédup → consensus → score.
 *
 * Fonction pure d'orchestration, sans I/O : elle reçoit des images et des
 * observations déjà collectées. C'est ce qui la rend testable intégralement
 * hors ligne, comme l'étape d'identification.
 */
import type { Category, Regime } from "../matching/types.ts";
import { consensus, type SpecConsensus, type SpecObservation } from "./consensus.ts";
import { computeFidelity, type FidelityResult } from "./fidelity.ts";
import { countDistinctSources } from "./phash.ts";
import { selectForSlots, type CandidateImage, type RejectionReason, type SlotAssignment } from "./select.ts";
import { requiredSlots, type SlotId, type SlotSpec } from "./slots.ts";

export interface BuildPlanInput {
  category: Category;
  regime: Regime;
  images: readonly CandidateImage[];
  specObservations?: readonly SpecObservation[];
  labelOcrConfidence?: number;
  /** Similarité inter-vues estimée (0 → 1). */
  consistency?: number;
}

export interface PlanResult {
  slots: SlotSpec[];
  assignments: SlotAssignment[];
  missing: SlotId[];
  rejected: { image: CandidateImage; reason: RejectionReason }[];
  distinctSources: number;
  consensus: SpecConsensus[];
  fidelity: FidelityResult;
}

export function buildPlan(input: BuildPlanInput): PlanResult {
  const slots = requiredSlots(input.category);

  const selection = selectForSlots(input.images, slots);
  const hashed = input.images.filter(
    (i): i is CandidateImage & { phash: string } => typeof i.phash === "string",
  );
  const distinctSources = countDistinctSources(hashed);

  const fidelity = computeFidelity({
    regime: input.regime,
    specs: slots,
    filled: selection.filled,
    images: selection.assignments.map((a) => a.image),
    consistency: input.consistency ?? 0.5,
    labelOcrConfidence: input.labelOcrConfidence ?? 0,
    hasMacroLabel: selection.filled.includes("macro-label"),
  });

  return {
    slots,
    assignments: selection.assignments,
    missing: selection.missing.map((s) => s.id),
    rejected: selection.rejected,
    distinctSources,
    consensus: consensus(input.specObservations ?? []),
    fidelity,
  };
}

/** Formate un refus de planche en message actionnable pour le commerçant. */
export function refusalMessage(result: PlanResult): string | undefined {
  const { fidelity } = result;
  if (fidelity.gatePassed) return undefined;

  if (fidelity.gate === "MISSING_SLOTS") {
    const labels = result.slots
      .filter((s) => result.missing.includes(s.id))
      .map((s) => s.label.toLowerCase());
    return `Planche à ${fidelity.score}/100. Il manque : ${labels.join(", ")}. Reprends ces photos et relance.`;
  }

  return `Planche à ${fidelity.score}/100, sous le seuil de ${65}. ${fidelity.qualityNote ?? ""}`.trim();
}
