/**
 * Sélection d'images, **slot par slot** (SPEC §9.5).
 *
 * Chaque slot est un concours indépendant : l'utilisateur peut avoir le
 * meilleur « face » et une image fournisseur combler le « dos » manquant.
 * Une image ne peut remplir qu'un seul slot.
 */
import type { SlotSpec, SlotId } from "./slots.ts";
import type { Provenance } from "../matching/types.ts";

export interface CandidateImage {
  id: string;
  url: string;
  slot?: SlotId;
  provenance: Provenance;
  width?: number;
  height?: number;
  phash?: string;
  sharpness?: number;
  backgroundClean?: boolean;
  hasWatermark?: boolean;
  hasTextOverlay?: boolean;
  hasHand?: boolean;
  isCollage?: boolean;
  isDistinctSource?: boolean;
  sourceUrl?: string;
}

export type RejectionReason =
  | "watermark"
  | "text_overlay"
  | "hand"
  | "collage"
  | "low_resolution"
  | "low_resolution_macro";

const PROVENANCE_BONUS: Record<Provenance, number> = {
  // Fournisseur et utilisateur d'abord : packshots propres, donc plus fidèles.
  // Les visuels « concurrent » servent de référence, jamais de source primaire.
  fournisseur: 15,
  utilisateur: 15,
  marchand: 10,
  concurrent: 3,
  generee: 0,
};

const RES_MIN = 512;
const RES_MAX = 2048;
const MACRO_MIN = 1024;

export function rejectReason(image: CandidateImage, spec?: SlotSpec): RejectionReason | undefined {
  if (image.hasWatermark) return "watermark";
  if (image.hasTextOverlay) return "text_overlay";
  if (image.hasHand) return "hand";
  if (image.isCollage) return "collage";

  const minSide = Math.min(image.width ?? 0, image.height ?? 0);
  if (minSide > 0 && minSide < RES_MIN) return "low_resolution";
  if (spec?.macro && minSide > 0 && minSide < MACRO_MIN) return "low_resolution_macro";
  return undefined;
}

/** Qualité intrinsèque d'une image, 0 → 100. */
export function scoreImage(image: CandidateImage, spec?: SlotSpec): number {
  const minSide = Math.min(image.width ?? 0, image.height ?? 0);
  let resolution = 0;
  if (minSide >= RES_MAX) resolution = 50;
  else if (minSide > RES_MIN) {
    // Progression logarithmique entre 512 et 2048.
    const t = Math.log2(minSide / RES_MIN) / Math.log2(RES_MAX / RES_MIN);
    resolution = 50 * Math.min(1, Math.max(0, t));
  }

  const sharpness = 20 * Math.min(1, Math.max(0, image.sharpness ?? 0.5));
  const background = 15 * (image.backgroundClean === false ? 0.3 : 1);
  const provenance = PROVENANCE_BONUS[image.provenance] ?? 0;

  return Math.round(resolution + sharpness + background + provenance);
}

export interface SlotAssignment {
  slot: SlotSpec;
  image: CandidateImage;
  score: number;
}

export interface SelectionResult {
  assignments: SlotAssignment[];
  missing: SlotSpec[];
  filled: SlotId[];
  rejected: { image: CandidateImage; reason: RejectionReason }[];
}

/** Les slots les plus lourds (macros) choisissent en premier. */
export function selectForSlots(
  images: readonly CandidateImage[],
  specs: readonly SlotSpec[],
): SelectionResult {
  const rejected: { image: CandidateImage; reason: RejectionReason }[] = [];
  const usable: CandidateImage[] = [];

  for (const image of images) {
    // Rejeté sans spec : les seuils macro sont évalués slot par slot plus bas.
    const reason = rejectReason(image);
    if (reason) rejected.push({ image, reason });
    else usable.push(image);
  }

  const taken = new Set<string>();
  const assignments: SlotAssignment[] = [];
  const missing: SlotSpec[] = [];

  const ordered = [...specs].sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));

  for (const spec of ordered) {
    const contenders = usable
      .filter((img) => !taken.has(img.id) && img.slot === spec.id)
      .filter((img) => {
        const reason = rejectReason(img, spec);
        if (reason) {
          rejected.push({ image: img, reason });
          return false;
        }
        return true;
      });

    const best = contenders.sort((a, b) => scoreImage(b, spec) - scoreImage(a, spec))[0];
    if (!best) {
      missing.push(spec);
      continue;
    }

    taken.add(best.id);
    assignments.push({ slot: spec, image: best, score: scoreImage(best, spec) });
  }

  return {
    assignments,
    missing,
    filled: assignments.map((a) => a.slot.id),
    rejected,
  };
}

/** Résolution normalisée 0 → 1, utilisée par le score de fidélité. */
export function resolutionRatio(image: CandidateImage): number {
  const minSide = Math.min(image.width ?? 0, image.height ?? 0);
  if (minSide <= RES_MIN) return 0;
  if (minSide >= RES_MAX) return 1;
  return Math.min(1, Math.log2(minSide / RES_MIN) / Math.log2(RES_MAX / RES_MIN));
}
