/**
 * Types du moteur d'appariement (J1).
 *
 * Règle structurante : **une information absente ne vaut jamais un accord**.
 * Chaque composante du score dit si elle disposait d'une preuve (`evidence`).
 * Sans preuve, elle rapporte 0 point et fait baisser la couverture.
 * C'est ce qui empêche la planche « fidèle au mauvais produit ».
 */

export type Category = "beaute" | "cheveux" | "mode" | "gadgets";
export type Regime = "detenu" | "non_detenu";

/** Origine d'une image — détermine sa confiance et son usage. */
export type Provenance = "utilisateur" | "fournisseur" | "marchand" | "concurrent" | "generee";

export interface Attributes {
  color?: string;
  form?: string;
  category?: Category;
  material?: string;
}

export interface Variant {
  colorName?: string;
  colorHex?: string;
  size?: string;
  capacity?: string;
}

export interface OcrResult {
  text: string;
  confidence: number;
  provider: string;
}

/** Vecteur d'embedding visuel (SigLIP/CLIP côté fournisseur). */
export type Embedding = number[];

export interface ListingImage {
  url: string;
  width?: number;
  height?: number;
  angle?: string;
}

export interface ListingCandidate {
  provider: string;
  externalId: string;
  url: string;
  title: string;
  description?: string;
  images: ListingImage[];
  attributes?: Attributes;
  variant?: Variant;
  /** Image(s) pré-encodée(s) — le fournisseur peut les renvoyer avec le listing. */
  embedding?: Embedding;
}

export interface ComponentScore {
  points: number;
  max: number;
  evidence: boolean;
  detail: string;
}

export type MatchComponents = {
  visual: ComponentScore;
  ocr: ComponentScore;
  attributes: ComponentScore;
  variant: ComponentScore;
};

export type GateReason =
  | "ACCEPTED"
  | "SCORE_BELOW_THRESHOLD"
  | "INSUFFICIENT_EVIDENCE"
  | "NO_CANDIDATE"
  | "MANUALLY_CONFIRMED";

export interface MatchResult {
  score: number;
  coverage: number;
  components: MatchComponents;
  accepted: boolean;
  gateReason: GateReason;
  candidate?: ListingCandidate;
}
