/**
 * Score de correspondance annonce ↔ photos utilisateur (SPEC §9.3).
 *
 *   visuel     55   similarité produit (vision, sinon embeddings)
 *   OCR        20   recouvrement de tokens (marque, label, mots-clés)
 *   attributs  15   couleur, forme, catégorie, matière
 *   variante   10   couleur, taille, capacité
 *
 * **Rebarémo du 26/10.** Avec l'ancien barème (40/25/20/15), un produit
 * **sans aucun texte** — pas de nom saisi, pas d'étiquette lisible, c'est-à-dire
 * un produit générique, la majorité du marché visé — ne pouvait pas dépasser
 * **60/100**, seuil fixé à 70. Aucune correspondance visuelle, même parfaite,
 * ne pouvait donc aboutir : le texte était devenu obligatoire sans que ce soit
 * écrit nulle part.
 *
 * Désormais le visuel pèse 55 : une correspondance jugée quasi certaine par le
 * modèle (≥ 0,85) accompagnée d'attributs concordants atteint exactement 70 et
 * passe, sans une ligne de texte. En dessous, on refuse toujours — la doctrine
 * « bloquer plutôt qu'inventer » reste intacte, elle ne rend simplement plus
 * l'identification texte ce qu'elle n'a jamais voulu être : une condition
 * déguisée.
 *
 * Deux conditions pour accepter : `score >= 70` ET `couverture >= 50 %`.
 * Une composante sans preuve rapporte 0 — elle ne compense jamais par du neutre.
 */
import { centroid, clamp01, cosine, normalize, overlap, tokenSet } from "./text.ts";
import type {
  Attributes,
  ComponentScore,
  Embedding,
  ListingCandidate,
  MatchComponents,
  MatchResult,
  Variant,
} from "./types.ts";

export const WEIGHTS = { visual: 55, ocr: 20, attributes: 15, variant: 10 } as const;
export const MATCH_THRESHOLD = 70;
export const MIN_COVERAGE = 0.5;

/**
 * Bornes de calibration du cosinus d'embeddings.
 *
 * Resserrées le 26/10 : avec 0,45 → 0,85, une correspondance réelle (cosinus
 * 0,78-0,88 mesuré sur des produits identiques) ne créditait que 60 à 85 % de
 * la composante. 0,50 → 0,80 place le « même produit » franchement en haut.
 */
export const VISUAL_FLOOR = 0.5;
export const VISUAL_CEIL = 0.8;

/** Bornes de calibration du recouvrement texte (coefficient d'inclusion). */
export const OCR_FLOOR = 0.3;
export const OCR_CEIL = 0.85;

/**
 * Bornes quand la similarité visuelle vient d'un modèle de vision (score 0→1)
 * et non d'un cosinus d'embeddings. Calibrées plus haut : un modèle qui dit
 * « même produit » à 0,8 est plus affirmatif qu'un cosinus à 0,8.
 */
export const VISION_FLOOR = 0.45;
export const VISION_CEIL = 0.85;

const COLOR_SYNONYMS: Record<string, string> = {
  noir: "black", black: "black",
  blanc: "white", white: "white",
  rouge: "red", red: "red",
  bleu: "blue", blue: "blue",
  vert: "green", green: "green",
  jaune: "yellow", yellow: "yellow",
  orange: "orange",
  rose: "pink", pink: "pink",
  violet: "purple", purple: "purple",
  marron: "brown", brun: "brown", brown: "brown",
  gris: "gray", gray: "gray", grey: "gray",
  beige: "beige", dore: "gold", doree: "gold", gold: "gold",
  argente: "silver", silver: "silver",
  transparent: "clear", incolore: "clear",
};

export function canonicalColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const n = normalize(value).replace(/\s+/g, "");
  return COLOR_SYNONYMS[n] ?? (n.length > 0 ? n : undefined);
}

const unknown = (max: number, detail: string): ComponentScore => ({
  points: 0,
  max,
  evidence: false,
  detail,
});

export interface MatchInput {
  userText: string;
  userEmbedding?: Embedding;
  /**
   * Similarité visuelle déjà évaluée par un modèle de vision (0 → 1).
   * Utilisée à la place du cosinus quand aucun embedding n'est disponible.
   */
  visualScore?: number;
  /**
   * Correspondance de texte jugée par un modèle (0 → 1). Indispensable quand
   * l'annonce et le commerçant ne parlent pas la même langue
   * (« vitamin » / « vitamine », « face » / « visage »).
   */
  textScore?: number;
  userAttributes?: Attributes;
  userVariant?: Variant;
  candidate: ListingCandidate;
  /** Embeddings des images du listing, si le fournisseur les a renvoyés. */
  candidateEmbeddings?: Embedding[];
}

export function computeMatch(input: MatchInput): MatchResult {
  const { candidate } = input;

  /* ── visuel ───────────────────────────────────────────────────────────── */
  const candidateVec = candidate.embedding ?? centroid(input.candidateEmbeddings ?? []);
  const sim = cosine(input.userEmbedding, candidateVec);

  const visual: ComponentScore =
    input.visualScore !== undefined
      ? {
          points:
            WEIGHTS.visual *
            clamp01((input.visualScore - VISION_FLOOR) / (VISION_CEIL - VISION_FLOOR)),
          max: WEIGHTS.visual,
          evidence: true,
          detail: `vision ${input.visualScore.toFixed(2)}`,
        }
      : sim === null
        ? unknown(WEIGHTS.visual, "aucun embedding exploitable")
        : {
            points:
              WEIGHTS.visual * clamp01((sim - VISUAL_FLOOR) / (VISUAL_CEIL - VISUAL_FLOOR)),
            max: WEIGHTS.visual,
            evidence: true,
            detail: `cosinus ${sim.toFixed(3)}`,
          };

  /* ── texte (OCR / saisie) ─────────────────────────────────────────────── */
  let ocr: ComponentScore;

  if (input.textScore !== undefined) {
    ocr = {
      points: WEIGHTS.ocr * clamp01((input.textScore - OCR_FLOOR) / (OCR_CEIL - OCR_FLOOR)),
      max: WEIGHTS.ocr,
      evidence: true,
      detail: `texte jugé ${input.textScore.toFixed(2)}`,
    };
  } else {
    const userTokens = tokenSet(input.userText);
    const listingTokens = tokenSet(`${candidate.title} ${candidate.description ?? ""}`);
    const covered = overlap(userTokens, listingTokens);
    const hasOcr = userTokens.size > 0 && listingTokens.size > 0;
    ocr = !hasOcr
      ? unknown(WEIGHTS.ocr, "texte utilisateur ou annonce vide")
      : {
          points: WEIGHTS.ocr * clamp01((covered - OCR_FLOOR) / (OCR_CEIL - OCR_FLOOR)),
          max: WEIGHTS.ocr,
          evidence: true,
          detail: `inclusion ${covered.toFixed(3)}`,
        };
  }

  /* ── attributs (4 critères, 5 points chacun) ──────────────────────────── */
  const userAttrs = input.userAttributes ?? {};
  const candAttrs = candidate.attributes ?? {};
  const attrChecks: { comparable: boolean; match: boolean }[] = [
    {
      comparable: Boolean(canonicalColor(userAttrs.color) && canonicalColor(candAttrs.color)),
      match: canonicalColor(userAttrs.color) === canonicalColor(candAttrs.color),
    },
    {
      comparable: Boolean(userAttrs.form && candAttrs.form),
      match: normalize(userAttrs.form ?? "") === normalize(candAttrs.form ?? ""),
    },
    {
      comparable: Boolean(userAttrs.category && candAttrs.category),
      match: userAttrs.category === candAttrs.category,
    },
    {
      comparable: Boolean(userAttrs.material && candAttrs.material),
      match: normalize(userAttrs.material ?? "") === normalize(candAttrs.material ?? ""),
    },
  ];
  const comparableAttrs = attrChecks.filter((c) => c.comparable);
  const matchedAttrs = comparableAttrs.filter((c) => c.match).length;
  const attributes: ComponentScore =
    comparableAttrs.length === 0
      ? unknown(WEIGHTS.attributes, "aucun attribut comparable")
      : {
          // Normalisé sur les critères réellement comparables : un produit sans
          // matière renseignée n'est pas pénalisé deux fois (score + couverture).
          points: (WEIGHTS.attributes * matchedAttrs) / comparableAttrs.length,
          max: WEIGHTS.attributes,
          evidence: true,
          detail: `${matchedAttrs}/${comparableAttrs.length} attributs concordants`,
        };

  /* ── variante (3 critères, 5 points chacun) ───────────────────────────── */
  const userVar = input.userVariant ?? {};
  const candVar = candidate.variant ?? {};
  const variantChecks: { comparable: boolean; match: boolean }[] = [
    {
      comparable: Boolean(canonicalColor(userVar.colorName) && canonicalColor(candVar.colorName)),
      match: canonicalColor(userVar.colorName) === canonicalColor(candVar.colorName),
    },
    {
      comparable: Boolean(userVar.size && candVar.size),
      match: normalize(userVar.size ?? "") === normalize(candVar.size ?? ""),
    },
    {
      comparable: Boolean(userVar.capacity && candVar.capacity),
      match: normalize(userVar.capacity ?? "") === normalize(candVar.capacity ?? ""),
    },
  ];
  const comparableVariant = variantChecks.filter((c) => c.comparable);
  const matchedVariant = comparableVariant.filter((c) => c.match).length;
  const variant: ComponentScore =
    comparableVariant.length === 0
      ? unknown(WEIGHTS.variant, "aucune variante comparable")
      : {
          points: (WEIGHTS.variant * matchedVariant) / comparableVariant.length,
          max: WEIGHTS.variant,
          evidence: true,
          detail: `${matchedVariant}/${comparableVariant.length} critères de variante concordants`,
        };

  const components: MatchComponents = { visual, ocr, attributes, variant };

  const score = Math.round(
    Math.min(100, Math.max(0, visual.points + ocr.points + attributes.points + variant.points)),
  );
  const coverage =
    Object.values(components).reduce((acc, c) => acc + (c.evidence ? c.max : 0), 0) / 100;

  const accepted = score >= MATCH_THRESHOLD && coverage >= MIN_COVERAGE;
  const gateReason = accepted
    ? "ACCEPTED"
    : coverage < MIN_COVERAGE
      ? "INSUFFICIENT_EVIDENCE"
      : "SCORE_BELOW_THRESHOLD";

  return { score, coverage, components, accepted, gateReason, candidate };
}

export type MatchBase = Omit<MatchInput, "candidate" | "candidateEmbeddings" | "visualScore" | "textScore">;

/** Résultat d'un modèle comparant le produit de référence à une annonce. */
export interface CandidateAssessment {
  visual: number;
  text: number;
}

/** Classe les candidats du meilleur au moins bon, puis applique le seuil. */
export function rankCandidates(
  base: MatchBase,
  candidates: readonly ListingCandidate[],
  assessments?: ReadonlyMap<string, CandidateAssessment>,
): MatchResult[] {
  return candidates
    .map((candidate) =>
      computeMatch({
        ...base,
        candidate,
        candidateEmbeddings: candidate.embedding ? [candidate.embedding] : [],
        visualScore: assessments?.get(candidate.externalId)?.visual,
        textScore: assessments?.get(candidate.externalId)?.text,
      }),
    )
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.coverage - a.coverage;
    });
}

/** Meilleur candidat, ou refus explicite si la liste est vide. */
export function pickBest(
  base: MatchBase,
  candidates: readonly ListingCandidate[],
  assessments?: ReadonlyMap<string, CandidateAssessment>,
): MatchResult {
  const ranked = rankCandidates(base, candidates, assessments);
  const best = ranked[0];
  if (best) return best;

  return {
    score: 0,
    coverage: 0,
    components: {
      visual: unknown(WEIGHTS.visual, "aucun candidat"),
      ocr: unknown(WEIGHTS.ocr, "aucun candidat"),
      attributes: unknown(WEIGHTS.attributes, "aucun candidat"),
      variant: unknown(WEIGHTS.variant, "aucun candidat"),
    },
    accepted: false,
    gateReason: "NO_CANDIDATE",
  };
}
