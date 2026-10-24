/**
 * Écriture du résultat d'analyse.
 *
 * Extrait de la route pour être partagé par les deux points d'entrée :
 * la création (`POST /api/analyses`) et la reprise après choix du coloris
 * (`POST /api/analyses/:id/variante`). Sans ça, la logique de débit et de
 * livraison existerait en double — et divergerait.
 */
import { eq } from "drizzle-orm";

import { putMarketKit } from "../cache/store.ts";
import { db } from "../db/index.ts";
import { analyses, creativeKits, planImages, plans } from "../db/schema.ts";
import { ensureArchetype } from "../market/store.ts";
import { releaseAnalysis, settleAnalysis } from "../wallet/repo.ts";
import type { RunAnalysisResult } from "./run-analysis.ts";

export interface PersistContext {
  analysisId: string;
  userId: string;
  country: string;
  creditXof: number;
  result: RunAnalysisResult;
}

export interface PersistOutcome {
  status: string;
  charged: boolean;
  payload: Record<string, unknown>;
}

export async function persistAnalysisOutcome(ctx: PersistContext): Promise<PersistOutcome> {
  const { result, analysisId, userId, country, creditXof } = ctx;

  /* ── 1. Le coloris doit être choisi : rien n'est débité, rien n'est perdu ── */
  if (result.pendingVariant) {
    const product = result.pendingVariant;

    await db
      .update(analyses)
      .set({
        status: "variante_a_choisir",
        productRef: product.record.productId,
        pendingVariants: product.record.variantAxes,
        archetypeSlug: result.identify.archetype.slug,
        matchScore: Math.round(product.hit.isBestMatch ? 95 : 75),
        matchCoverage: "0.90",
        // Conservé pour l'affichage : le produit identifié, pas les candidats.
        matchResult: {
          product: {
            productId: product.record.productId,
            title: product.record.title,
            url: product.record.url,
            image: product.record.gallery[0]?.url ?? null,
            price: product.record.price ?? null,
            currency: product.record.currency ?? null,
          },
          facts: product.facts,
        } as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(analyses.id, analysisId));

    return {
      status: "variante_a_choisir",
      charged: false,
      payload: {
        analysisId,
        status: "variante_a_choisir",
        product: {
          productId: product.record.productId,
          title: product.record.title,
          url: product.record.url,
          price: product.record.price ?? null,
          currency: product.record.currency ?? null,
          rating: product.record.rating ?? null,
          image: product.record.gallery[0]?.url ?? null,
        },
        variants: product.record.variantAxes,
        facts: product.facts,
        warnings: result.warnings,
        charged: false,
      },
    };
  }

  /* ── 2. Article non reconnu : aucun débit ─────────────────────────────── */
  if (!result.identify.match.accepted && !result.product) {
    await releaseAnalysis({ userId, analysisId, reservedXof: creditXof });
    await db
      .update(analyses)
      .set({
        status: "bloquee_article",
        failureCode: result.identify.match.gateReason,
        matchScore: result.identify.match.score,
        matchCoverage: result.identify.match.coverage.toFixed(2),
        matchResult: result.identify.match as unknown as Record<string, unknown>,
        archetypeSlug: result.identify.archetype.slug,
        updatedAt: new Date(),
      })
      .where(eq(analyses.id, analysisId));

    return {
      status: "bloquee_article",
      charged: false,
      payload: {
        analysisId,
        status: "bloquee_article",
        archetype: result.identify.archetype,
        match: summarizeMatch(result.identify.match),
        candidatesFound: result.identify.candidatesFound,
        warnings: result.warnings,
        charged: false,
      },
    };
  }

  /* ── 3. Planche : enregistrée dans tous les cas ──────────────────────── */
  const plan = result.plan;
  let planId: string | undefined;

  if (plan) {
    const variantUrls = new Set(
      (result.product?.record.variantAxes ?? []).flatMap((axis) =>
        axis.values.map((value) => value.image).filter((url): url is string => Boolean(url)),
      ),
    );

    const [row] = await db
      .insert(plans)
      .values({
        analysisId,
        fidelityScore: plan.plan.fidelity.score,
        breakdown: plan.plan.fidelity.breakdown,
        gatePassed: plan.plan.fidelity.gatePassed,
        gateReason: plan.plan.fidelity.gate,
        qualityNote: plan.plan.fidelity.qualityNote ?? null,
      })
      .returning({ id: plans.id });
    planId = row?.id;

    if (planId && plan.plan.assignments.length > 0) {
      await db.insert(planImages).values(
        plan.plan.assignments.map((assignment) => ({
          planId: planId as string,
          slot: assignment.slot.id,
          url: assignment.image.url,
          provenance: (result.product ? "fournisseur" : "utilisateur") as "fournisseur" | "utilisateur",
          width: assignment.image.width ?? null,
          height: assignment.image.height ?? null,
          isDistinctSource: true,
          isVariantReference: variantUrls.has(assignment.image.url),
        })),
      );
    }
  }

  /* ── 4. Marché : mis en cache, et offert même si la planche est refusée ── */
  let marketSummary: unknown = null;

  if (result.market) {
    const { matrix, portfolio } = result.market;
    marketSummary = {
      publishable: matrix.publishable,
      adsFound: matrix.dataQuality.adsFound,
      advertisers: matrix.dataQuality.distinctAdvertisers,
      confidence: matrix.dataQuality.confidence,
      angles: portfolio.entries.slice(0, 6).map((entry) => ({
        family: entry.family,
        action: entry.action,
        advertisers: entry.figures.advertisers,
        medianDays: Math.round(entry.figures.medianDaysRunning),
        rationale: entry.rationale,
      })),
      gaps: matrix.dataQuality.gaps,
    };

    if (matrix.publishable) {
      const archetypeId = await ensureArchetype({
        slug: result.identify.archetype.slug,
        label: result.identify.archetype.label,
        category: result.identify.archetype.category,
      });
      await putMarketKit({
        archetypeId,
        country,
        content: { portfolio, dataQuality: matrix.dataQuality },
        adsFound: matrix.dataQuality.adsFound,
        confidence: matrix.dataQuality.confidence,
      });
    }
  }

  /* ── 5. Planche refusée : rien n'est débité ───────────────────────────── */
  if (result.blocked) {
    await releaseAnalysis({ userId, analysisId, reservedXof: creditXof });
    await db
      .update(analyses)
      .set({
        status: "planche_prete",
        failureCode: plan?.plan.fidelity.gate ?? "PLAN_REFUSED",
        matchScore: result.identify.match.score,
        matchCoverage: result.identify.match.coverage.toFixed(2),
        matchResult: result.identify.match as unknown as Record<string, unknown>,
        archetypeSlug: result.identify.archetype.slug,
        updatedAt: new Date(),
      })
      .where(eq(analyses.id, analysisId));

    return {
      status: "planche_prete",
      charged: false,
      payload: {
        analysisId,
        status: "planche_prete",
        archetype: result.identify.archetype,
        match: summarizeMatch(result.identify.match),
        plan: summarizePlan(plan),
        market: marketSummary,
        warnings: result.warnings,
        charged: false,
      },
    };
  }

  /* ── 6. Production ────────────────────────────────────────────────────── */
  let creativeSummary: unknown = null;
  if (result.creative?.kit) {
    await db
      .insert(creativeKits)
      .values({ analysisId, content: result.creative.kit as unknown as object })
      .onConflictDoNothing();

    creativeSummary = {
      bigIdea: result.creative.kit.bigIdea,
      angles: result.creative.kit.angles.length,
      hooks: result.creative.kit.hooks.length,
      scripts: result.creative.kit.scripts.length,
      prompts: result.creative.kit.imagePrompts.length,
    };
  }

  /* ── 7. Livraison + débit ─────────────────────────────────────────────── */
  await settleAnalysis({ userId, analysisId, reservedXof: creditXof, actualXof: creditXof });

  await db
    .update(analyses)
    .set({
      status: "livree",
      settledXof: creditXof,
      matchScore: result.product ? 95 : result.identify.match.score,
      matchCoverage: result.identify.match.coverage.toFixed(2),
      /**
       * On conserve le produit identifié **avec** la décision du matcher :
       * sans lui, la page affichait « produit non retrouvé » avec un score
       * de 95, et proposait un candidat qui n'était pas le bon.
       */
      matchResult: {
        ...(result.identify.match as unknown as Record<string, unknown>),
        ...(result.product
          ? {
              product: {
                productId: result.product.record.productId,
                title: result.product.record.title,
                url: result.product.record.url,
                image: result.product.record.gallery[0]?.url ?? null,
                price: result.product.record.price ?? null,
                currency: result.product.record.currency ?? null,
                facts: result.product.facts,
              },
            }
          : {}),
      },
      archetypeSlug: result.identify.archetype.slug,
      ...(result.product ? { productRef: result.product.record.productId } : {}),
      pendingVariants: null,
      updatedAt: new Date(),
    })
    .where(eq(analyses.id, analysisId));

  return {
    status: "livree",
    charged: true,
    payload: {
      analysisId,
      status: "livree",
      archetype: result.identify.archetype,
      match: summarizeMatch(result.identify.match),
      product: result.product
        ? {
            productId: result.product.record.productId,
            title: result.product.record.title,
            url: result.product.record.url,
            price: result.product.record.price ?? null,
            currency: result.product.record.currency ?? null,
          }
        : null,
      facts: result.product?.facts ?? {},
      plan: summarizePlan(plan),
      planId,
      market: marketSummary,
      creative: creativeSummary,
      warnings: result.warnings,
      charged: true,
    },
  };
}

function summarizeMatch(match: {
  score: number;
  coverage: number;
  accepted: boolean;
  gateReason: string;
  candidate?: { title: string; url: string };
  components: Record<string, { points: number; max: number; evidence: boolean; detail: string }>;
}) {
  return {
    score: match.score,
    coverage: match.coverage,
    accepted: match.accepted,
    gateReason: match.gateReason,
    candidate: match.candidate ? { title: match.candidate.title, url: match.candidate.url } : null,
    components: match.components,
  };
}

function summarizePlan(plan?: {
  plan: {
    fidelity: {
      score: number;
      gatePassed: boolean;
      gate: string;
      missing: string[];
      qualityNote?: string;
    };
    assignments: { slot: { id: string; label: string }; image: { url: string } }[];
  };
}) {
  if (!plan) return null;
  return {
    score: plan.plan.fidelity.score,
    gatePassed: plan.plan.fidelity.gatePassed,
    gate: plan.plan.fidelity.gate,
    missing: plan.plan.fidelity.missing,
    qualityNote: plan.plan.fidelity.qualityNote ?? null,
    slots: plan.plan.assignments.map((assignment) => ({
      id: assignment.slot.id,
      label: assignment.slot.label,
      url: assignment.image.url,
    })),
  };
}
