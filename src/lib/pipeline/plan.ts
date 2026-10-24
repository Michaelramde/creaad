/**
 * Étape planche : classer les photos du commerçant, puis construire la planche.
 *
 * Sans classificateur, chaque photo reste sans emplacement et la planche
 * échoue. Avec lui, la planche se construit sur les photos réelles —
 * c'est ce qui rend le refus actionnable (« il manque le dos »).
 */
import { buildPlan, type PlanResult } from "../planche/build.ts";
import type { CandidateImage } from "../planche/select.ts";
import { requiredSlots } from "../planche/slots.ts";
import type { Category, Regime } from "../matching/types.ts";
import type { Providers } from "../providers/types.ts";

export interface UserPhoto {
  url: string;
  width?: number;
  height?: number;
}

export interface PlanStepInput {
  category: Category;
  regime: Regime;
  photos: readonly UserPhoto[];
  labelOcrConfidence: number;
  /** Images du listing retenu, ajoutées comme références sans emplacement. */
  listingImages?: readonly string[];
}

export interface PlanStepResult {
  plan: PlanResult;
  /** Emplacements reconnus, dans l'ordre des photos. */
  assigned: (string | null)[];
  warnings: string[];
}

export async function buildPlanStep(
  providers: Providers,
  input: PlanStepInput,
): Promise<PlanStepResult> {
  const specs = requiredSlots(input.category);
  const warnings: string[] = [];

  let assigned: (string | null)[] = input.photos.map(() => null);

  if (providers.slots) {
    try {
      const result = await providers.slots.classify(
        input.photos.map((p) => p.url),
        specs.map((s) => ({ id: s.id, label: s.label })),
      );
      assigned = input.photos.map((_, index) => result.get(index) ?? null);
    } catch (error) {
      warnings.push(`Classement des vues indisponible (${providers.slots.name})`);
      console.warn("[plan] classement des emplacements échoué", error);
    }
  } else {
    warnings.push("Aucun classificateur de vues : la planche ne peut pas être construite.");
  }

  const images: CandidateImage[] = input.photos.map((photo, index) => ({
    id: `photo-${index}`,
    url: photo.url,
    slot: (assigned[index] ?? undefined) as CandidateImage["slot"],
    provenance: "utilisateur",
    width: photo.width,
    height: photo.height,
  }));

  const plan = buildPlan({
    category: input.category,
    regime: input.regime,
    images,
    labelOcrConfidence: input.labelOcrConfidence,
    consistency: 0.7,
  });

  return { plan, assigned, warnings };
}
