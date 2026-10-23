/**
 * Modèle du marché publicitaire (SPEC §10).
 *
 * Le vocabulaire est volontairement restreint : **fréquence ≠ performance**.
 * On observe des annonces, on ne connaît pas leur rentabilité. Toute
 * conclusion doit donc rester prudente et sourcée.
 */

export type Platform = "meta" | "tiktok";

/** Familles d'angles — taxonomie fermée, pour que les comptages soient comparables. */
export type AngleFamily =
  | "preuve-sociale"
  | "avant-apres"
  | "probleme-solution"
  | "prix-offre"
  | "autorite"
  | "urgence"
  | "demonstration"
  | "temoignage"
  | "identite"
  | "comparaison"
  | "garantie"
  | "nouveaute"
  | "non-classe";

/**
 * Statuts. `observed_unproven` comble un trou de la spécification : la plupart
 * des angles observés ne sont ni « prouvés » ni « en montée » ni « absents ».
 * Les forcer dans une des quatre cases aurait produit un mensonge.
 */
export type AngleStatus =
  | "proven_elsewhere"
  | "rising"
  | "proven_here"
  | "observed_unproven"
  | "unobserved";

export interface AdObservation {
  id: string;
 /** Identifiant de l'annonceur — c'est lui qui compte, pas l'annonce. */
  advertiserId: string;
  advertiserName?: string;
  family: AngleFamily;
  platform: Platform;
  country: string;
  startDate: string;
  endDate?: string;
  isActive: boolean;
  url: string;
  hook?: string;
}

export interface AngleStats {
  family: AngleFamily;
  status: AngleStatus;
  /** Nombre d'annonces différentes. */
  ads: number;
  /** Nombre d'annonceurs **distincts** — l'indicateur qui compte. */
  advertisers: string[];
  /** Durée médiane de diffusion, en jours. */
  medianDaysRunning: number;
  /** Ratio d'accélération sur 30 jours (récent / période précédente). */
  velocity: number | null;
  evidenceUrls: string[];
  /** Notes de diagnostic (domination, échantillon faible…). */
  notes: string[];
  /** Preuve observée sur les marchés de référence (pour l'import d'angle). */
  reference?: {
    advertisers: string[];
    medianDaysRunning: number;
  };
  priority: number;
}

export interface DataQuality {
  adsFound: number;
  distinctAdvertisers: number;
  platforms: Platform[];
  /** `insufficient` < 15 annonces : aucune matrice n'est publiée. */
  confidence: Confidence;
  gaps: string[];
}

/** Solidité de l'échantillon collecté (distinct de la confiance d'une spec). */
export type Confidence = "insufficient" | "low" | "medium" | "high";

export interface SaturationMatrix {
  country: string;
  referenceMarkets: string[];
  dataQuality: DataQuality;
  angles: AngleStats[];
  /** Faux si `confidence === "insufficient"` : rien ne doit être affiché. */
  publishable: boolean;
}

export const ANGLE_FAMILIES: AngleFamily[] = [
  "preuve-sociale",
  "avant-apres",
  "probleme-solution",
  "prix-offre",
  "autorite",
  "urgence",
  "demonstration",
  "temoignage",
  "identite",
  "comparaison",
  "garantie",
  "nouveaute",
  "non-classe",
];
