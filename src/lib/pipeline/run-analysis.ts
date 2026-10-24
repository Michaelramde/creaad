/**
 * Orchestration d'une analyse : identifier → planche → marché.
 *
 * Volontairement synchrone et sans file d'attente : l'ensemble tient en
 * quelques appels réseau (OCR, vision) et deux calculs purs. Une app
 * minimaliste n'a pas besoin d'un orchestrateur distribué.
 */
import { buildCreativeStep, type CreativeStepResult } from "./creative.ts";
import { buildMatrixFor } from "../market/store.ts";
import { buildPortfolio, type Portfolio } from "../market/portfolio.ts";
import type { SaturationMatrix } from "../market/types.ts";
import type { Category, Regime } from "../matching/types.ts";
import {
  identifyArticle,
  type IdentifyOutput,
} from "./identify.ts";
import { buildPlanStep, type PlanStepResult, type UserPhoto } from "./plan.ts";
import type { Providers } from "../providers/types.ts";

export interface RunAnalysisInput {
  category: Category;
  regime: Regime;
  country: string;
  photos: UserPhoto[];
  variantLabel?: string;
  userText?: string;
}

export interface RunAnalysisResult {
  identify: IdentifyOutput;
  plan?: PlanStepResult;
  market?: { matrix: SaturationMatrix; portfolio: Portfolio };
  creative?: CreativeStepResult;
  warnings: string[];
  /** Vrai si l'analyse s'arrête avant de produire des kits. */
  blocked: boolean;
}

export async function runAnalysis(
  providers: Providers,
  input: RunAnalysisInput,
): Promise<RunAnalysisResult> {
  const warnings: string[] = [];

  const identify = await identifyArticle(providers, {
    category: input.category,
    regime: input.regime,
    country: input.country,
    imageUrls: input.photos.map((p) => p.url),
    variantLabel: input.variantLabel,
    userText: input.userText,
  });
  warnings.push(...identify.warnings);

  if (identify.blocked) {
    return { identify, warnings, blocked: true };
  }

  /* ── planche ─────────────────────────────────────────────────────────── */
  const plan = await buildPlanStep(providers, {
    category: input.category,
    regime: input.regime,
    photos: input.photos,
    labelOcrConfidence: identify.ocrConfidence,
    listingImages: identify.match.candidate?.images.map((i) => i.url) ?? [],
  });
  warnings.push(...plan.warnings);

  // Planche refusée : on s'arrête, le commerçant sait quoi reprendre.
  if (!plan.plan.fidelity.gatePassed) {
    return { identify, plan, warnings, blocked: true };
  }

  /* ── marché (calcul pur sur les annonces déjà collectées) ────────────── */
  const { matrix } = await buildMatrixFor(identify.archetype.slug, input.country);
  const portfolio = buildPortfolio(matrix);

  if (!matrix.publishable) {
    warnings.push(
      `Données marché insuffisantes (${matrix.dataQuality.adsFound} annonces) — aucun angle n'est publié.`,
    );
    return { identify, plan, market: { matrix, portfolio }, warnings, blocked: false };
  }

  /* ── production : angles, hooks, scripts, prompts ────────────────────── */
  const variant = identify.match.candidate?.variant;
  const creative = await buildCreativeStep(providers.writer, {
    product: {
      title: identify.match.candidate?.title ?? input.userText ?? identify.archetype.label,
      archetype: identify.archetype.label,
      category: input.category,
      claims: input.userText ? [input.userText] : [],
      specs: [identify.archetype.capacity].filter((v): v is string => Boolean(v)),
      ...(variant?.colorName || variant?.capacity
        ? {
            variant: [variant?.colorName, variant?.capacity].filter(Boolean).join(" "),
          }
        : {}),
    },
    portfolio: portfolio.entries.slice(0, 6).map((entry) => ({
      family: entry.family,
      action: entry.action,
      advertisers: entry.figures.advertisers,
      medianDays: entry.figures.medianDaysRunning,
      rationale: entry.rationale,
    })),
    country: input.country,
    language: "fr",
  });
  warnings.push(...creative.warnings);

  return { identify, plan, market: { matrix, portfolio }, creative, warnings, blocked: false };
}
