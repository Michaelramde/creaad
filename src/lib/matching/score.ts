/**
 * Score de correspondance annonce ↔ photos utilisateur (SPEC §9.3).
 *
 *   visuel     40   similarité produit (embeddings)
 *   OCR        25   recouvrement de tokens (marque, label, mots-clés)
 *   attributs  20   couleur, forme, catégorie, matière
 *   variante   15   couleur, taille, capacité
 *
 * Deux conditions pour accepter : `score >= 70` ET `couverture >= 50 %`.
 * Une composante sans preuve rapporte 0 — elle ne compense jamais par du neutre.
 */
import { centroid, clamp01, cosine, jaccard, normalize, tokenSet } from "./text.ts";
import type {
  Attributes,
  ComponentScore,
  Embedding,
  ListingCandidate,
  MatchComponents,
  MatchResult,
  Variant,
} from "./types.ts";

export const WEIGHTS = { visual: 40, ocr: 25, attributes: 20, variant: 15 } as const;
export const MATCH_THRESHOLD = 70;
export const MIN_COVERAGE = 0.5;

/** Bornes de calibration de la similarité cosinus. À réétalonner sur données réelles. */
export const VISUAL_FLOOR = 0.45;
export const VISUAL_CEIL = 0.85;

/** Bornes de calibration du recouvrement OCR. */
export const OCR_FLOOR = 0.15;
export const OCR_CEIL = 0.6;

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
    sim === null
      ? unknown(WEIGHTS.visual, "aucun embedding exploitable")
      : {
          points:
            WEIGHTS.visual * clamp01((sim - VISUAL_FLOOR) / (VISUAL_CEIL - VISUAL_FLOOR)),
          max: WEIGHTS.visual,
          evidence: true,
          detail: `cosinus ${sim.toFixed(3)}`,
        };

  /* ── OCR ──────────────────────────────────────────────────────────────── */
  const userTokens = tokenSet(input.userText);
  const listingTokens = tokenSet(`${candidate.title} ${candidate.description ?? ""}`);
  const jac = jaccard(userTokens, listingTokens);
  const hasOcr = userTokens.size > 0 && listingTokens.size > 0;
  const ocr: ComponentScore = !hasOcr
    ? unknown(WEIGHTS.ocr, "texte utilisateur ou annonce vide")
    : {
        points: WEIGHTS.ocr * clamp01((jac - OCR_FLOOR) / (OCR_CEIL - OCR_FLOOR)),
        max: WEIGHTS.ocr,
        evidence: true,
        detail: `jaccard ${jac.toFixed(3)}`,
      };

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

/** Classe les candidats du meilleur au moins bon, puis applique le seuil. */
export function rankCandidates(
  base: Omit<MatchInput, "candidate" | "candidateEmbeddings">,
  candidates: readonly ListingCandidate[],
): MatchResult[] {
  return candidates
    .map((candidate) =>
      computeMatch({
        ...base,
        candidate,
        candidateEmbeddings: candidate.embedding ? [candidate.embedding] : [],
      }),
    )
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.coverage - a.coverage;
    });
}

/** Meilleur candidat, ou refus explicite si la liste est vide. */
export function pickBest(
  base: Omit<MatchInput, "candidate" | "candidateEmbeddings">,
  candidates: readonly ListingCandidate[],
): MatchResult {
  const ranked = rankCandidates(base, candidates);
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
