/**
 * Écriture du résultat d'analyse.
 *
 * Extrait de la route pour être partagé par les deux points d'entrée :
 * la création (`POST /api/analyses`) et la reprise après choix du coloris
 * (`POST /api/analyses/:id/variante`). Sans ça, la logique de débit et de
 * livraison existerait en double — et divergerait.
 */
import { and, eq, gte, inArray, ne } from "drizzle-orm";

import { putMarketKit } from "../cache/store.ts";
import { db } from "../db/index.ts";
import { analyses, creativeKits, planImages, plans, products } from "../db/schema.ts";
import { ensureArchetype } from "../market/store.ts";

/**
 * Renseigne enfin `products.archetype_id`.
 *
 * La colonne existait depuis la migration 0000 et n'avait **jamais** été
 * écrite : la jointure réelle passait par `analyses.archetype_slug`, une
 * chaîne. On garde le slug pour l'affichage, et on remplit la vraie clé
 * étrangère pour que le produit sache à quel marché il appartient.
 */
async function linkProductArchetype(input: {
  analysisId: string;
  slug: string;
  category: "beaute" | "cheveux" | "mode" | "gadgets";
}): Promise<void> {
  try {
    const archetypeId = await ensureArchetype({
      slug: input.slug,
      label: input.slug.replace(/-/g, " "),
      category: input.category,
    });

    const [row] = await db
      .select({ productId: analyses.productId })
      .from(analyses)
      .where(eq(analyses.id, input.analysisId))
      .limit(1);

    if (row) {
      await db.update(products).set({ archetypeId }).where(eq(products.id, row.productId));
    }
  } catch (error) {
    // Un lien manquant ne doit pas faire échouer une analyse livrée.
    console.warn("[persist] rattachement de l'archétype impossible", error);
  }
}
import { releaseAnalysis, settleAnalysis } from "../wallet/repo.ts";
import type { RunAnalysisResult } from "./run-analysis.ts";

export interface PersistContext {
  analysisId: string;
  userId: string;
  country: string;
  creditXof: number;
  /**
   * `produit` = étape 1 : on ne livre que la planche et le dossier produit.
   * `complet` = parcours en une seule étape (ancien comportement).
   */
  phase?: "produit" | "complet";
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

  /* ── 4. Étape 1 : le dossier produit s'arrête ici ─────────────────────── */
  if (ctx.phase === "produit") {
    /**
     * Re-run gratuit 7 jours.
     *
     * La SPEC §12.3 le promettait et rien ne l'implémentait. Si ce commerçant
     * a déjà reçu un dossier pour CE produit il y a moins de sept jours, la
     * seconde analyse ne coûte rien : refaire ses photos ne se facture pas
     * deux fois.
     */
    const reRunProductRef = result.product?.record.productId;
    let freeRerun = false;

    if (reRunProductRef) {
      const [previous] = await db
        .select({ id: analyses.id })
        .from(analyses)
        .where(
          and(
            eq(analyses.userId, userId),
            eq(analyses.productRef, reRunProductRef),
            ne(analyses.id, analysisId),
            inArray(analyses.status, ["livree", "produit_pret"]),
            gte(analyses.createdAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
          ),
        )
        .limit(1);
      freeRerun = Boolean(previous);
    }

    if (freeRerun) {
      await releaseAnalysis({ userId, analysisId, reservedXof: creditXof, step: 1 });
    } else {
      await settleAnalysis({
        userId,
        analysisId,
        reservedXof: creditXof,
        actualXof: creditXof,
        step: 1,
      });
    }

    await db
      .update(analyses)
      .set({
        status: result.blocked ? "planche_prete" : "produit_pret",
        settledXof: result.blocked || freeRerun ? 0 : creditXof,
        failureCode: result.blocked ? (plan?.plan.fidelity.gate ?? "PLAN_REFUSED") : null,
        matchScore: result.product ? 95 : result.identify.match.score,
        matchCoverage: result.identify.match.coverage.toFixed(2),
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

    await linkProductArchetype({
      analysisId,
      slug: result.identify.archetype.slug,
      category: result.identify.archetype.category,
    });

    // Planche refusée : on restitue, l'étape n'a pas été livrée.
    if (result.blocked) await releaseAnalysis({ userId, analysisId, reservedXof: creditXof, step: 1 });

    return {
      status: result.blocked ? "planche_prete" : "produit_pret",
      charged: !result.blocked && !freeRerun,
      payload: {
        analysisId,
        status: result.blocked ? "planche_prete" : "produit_pret",
        step: 1,
        archetype: result.identify.archetype,
        product: result.product
          ? {
              productId: result.product.record.productId,
              title: result.product.record.title,
              url: result.product.record.url,
            }
          : null,
        facts: result.product?.facts ?? {},
        plan: summarizePlan(plan),
        warnings: result.warnings,
        charged: !result.blocked && !freeRerun,
        freeRerun,
      },
    };
  }

  /* ── 5. Marché : mis en cache, et offert même si la planche est refusée ── */
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

  await linkProductArchetype({
    analysisId,
    slug: result.identify.archetype.slug,
    category: result.identify.archetype.category,
  });

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
