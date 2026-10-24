import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { putMarketKit } from "@/lib/cache/store";
import { db } from "@/lib/db";
import { analyses, planImages, plans, products } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { ensureArchetype } from "@/lib/market/store";
import { createProviders } from "@/lib/providers";
import { runAnalysis } from "@/lib/pipeline/run-analysis";
import { getWalletSummary, releaseAnalysis, reserveForAnalysis, settleAnalysis } from "@/lib/wallet/repo";

/** Accepte une URL distante (R2, CDN) ou une image inline (démonstration). */
const imageUrl = z.union([z.url(), z.string().startsWith("data:image/").max(4_000_000)]);

const bodySchema = z.object({
  category: z.enum(["beaute", "cheveux", "mode", "gadgets"]),
  regime: z.enum(["detenu", "non_detenu"]),
  country: z.string().length(2).default("CI"),
  images: z
    .array(
      z.object({
        url: imageUrl,
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
      }),
    )
    .min(1)
    .max(6),
  variantLabel: z.string().max(120).optional(),
  userText: z.string().max(500).optional(),
});

/**
 * Crée une analyse et exécute le pipeline complet : identification,
 * planche, marché. Le crédit n'est débité qu'à la livraison.
 */
export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "BAD_REQUEST", issues: parsed.error.issues }, { status: 400 });
  }
  const input = parsed.data;

  const wallet = await getWalletSummary(session.user.id);
  if (!wallet.canLaunch) {
    return NextResponse.json(
      {
        error: "INSUFFICIENT_FUNDS",
        balanceXof: wallet.balanceXof,
        creditXof: wallet.creditXof,
        minimum: wallet.minTopupXof,
      },
      { status: 402 },
    );
  }

  const [product] = await db
    .insert(products)
    .values({
      userId: session.user.id,
      category: input.category,
      regime: input.regime,
      name: input.userText ?? null,
      variantLabel: input.variantLabel ?? null,
    })
    .returning();
  if (!product) return NextResponse.json({ error: "PRODUCT_CREATE_FAILED" }, { status: 500 });

  const [analysis] = await db
    .insert(analyses)
    .values({
      productId: product.id,
      userId: session.user.id,
      country: input.country,
      status: "ocr",
      reservedXof: wallet.creditXof,
    })
    .returning();
  if (!analysis) return NextResponse.json({ error: "ANALYSIS_CREATE_FAILED" }, { status: 500 });

  await reserveForAnalysis({
    userId: session.user.id,
    analysisId: analysis.id,
    amountXof: wallet.creditXof,
  });

  try {
    const providers = createProviders();
    const result = await runAnalysis(providers, {
      category: input.category,
      regime: input.regime,
      country: input.country,
      photos: input.images,
      variantLabel: input.variantLabel,
      userText: input.userText,
    });

    /* ── identification bloquée : aucun débit ──────────────────────────── */
    if (!result.identify.match.accepted) {
      await releaseAnalysis({
        userId: session.user.id,
        analysisId: analysis.id,
        reservedXof: wallet.creditXof,
      });
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
        .where(eq(analyses.id, analysis.id));

      return NextResponse.json({
        analysisId: analysis.id,
        status: "bloquee_article",
        archetype: result.identify.archetype,
        match: summarizeMatch(result.identify.match),
        candidatesFound: result.identify.candidatesFound,
        warnings: result.warnings,
        charged: false,
      });
    }

    /* ── planche ───────────────────────────────────────────────────────── */
    const plan = result.plan;
    let planId: string | undefined;

    if (plan) {
      const [row] = await db
        .insert(plans)
        .values({
          analysisId: analysis.id,
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
            provenance: "utilisateur" as const,
            width: assignment.image.width ?? null,
            height: assignment.image.height ?? null,
            isDistinctSource: true,
          })),
        );
      }
    }

    /* ── planche refusée : rien n'est livré, rien n'est débité ─────────── */
    if (result.blocked) {
      await releaseAnalysis({
        userId: session.user.id,
        analysisId: analysis.id,
        reservedXof: wallet.creditXof,
      });
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
        .where(eq(analyses.id, analysis.id));

      return NextResponse.json({
        analysisId: analysis.id,
        status: "planche_prete",
        archetype: result.identify.archetype,
        match: summarizeMatch(result.identify.match),
        plan: summarizePlan(plan),
        warnings: result.warnings,
        charged: false,
      });
    }

    /* ── marché : on met en cache et on débite ─────────────────────────── */
    let marketSummary: unknown = null;
    if (result.market) {
      const { matrix, portfolio } = result.market;
      marketSummary = {
        publishable: matrix.publishable,
        adsFound: matrix.dataQuality.adsFound,
        advertisers: matrix.dataQuality.distinctAdvertisers,
        confidence: matrix.dataQuality.confidence,
        angles: portfolio.entries.slice(0, 6).map((e) => ({
          family: e.family,
          action: e.action,
          advertisers: e.figures.advertisers,
          medianDays: Math.round(e.figures.medianDaysRunning),
          rationale: e.rationale,
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
          country: input.country,
          content: { portfolio, dataQuality: matrix.dataQuality },
          adsFound: matrix.dataQuality.adsFound,
          confidence: matrix.dataQuality.confidence,
        });
      }
    }

    await settleAnalysis({
      userId: session.user.id,
      analysisId: analysis.id,
      reservedXof: wallet.creditXof,
      actualXof: wallet.creditXof,
    });

    await db
      .update(analyses)
      .set({
        status: "livree",
        settledXof: wallet.creditXof,
        matchScore: result.identify.match.score,
        matchCoverage: result.identify.match.coverage.toFixed(2),
        matchResult: result.identify.match as unknown as Record<string, unknown>,
        archetypeSlug: result.identify.archetype.slug,
        updatedAt: new Date(),
      })
      .where(eq(analyses.id, analysis.id));

    return NextResponse.json({
      analysisId: analysis.id,
      status: "livree",
      archetype: result.identify.archetype,
      match: summarizeMatch(result.identify.match),
      plan: summarizePlan(plan),
      planId,
      market: marketSummary,
      warnings: result.warnings,
      charged: true,
    });
  } catch (error) {
    await releaseAnalysis({
      userId: session.user.id,
      analysisId: analysis.id,
      reservedXof: wallet.creditXof,
    });
    await db
      .update(analyses)
      .set({ status: "echouee", failureCode: "PIPELINE_FAILED", updatedAt: new Date() })
      .where(eq(analyses.id, analysis.id));

    console.error("[analyses] pipeline échoué", error);

    // Une panne de fournisseur ne doit pas ressembler à un mauvais produit.
    const saturated = /429|503|quota|high demand|timeout/i.test(String(error));
    return NextResponse.json(
      {
        error: "PIPELINE_FAILED",
        message: saturated
          ? "Le service d'analyse est momentanément saturé. Réessaie dans une minute — aucun crédit n'a été débité."
          : "L'analyse a échoué. Aucun crédit n'a été débité.",
      },
      { status: 503 },
    );
  }
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
    candidate: match.candidate
      ? { title: match.candidate.title, url: match.candidate.url }
      : null,
    components: match.components,
  };
}

function summarizePlan(plan?: { plan: { fidelity: { score: number; gatePassed: boolean; gate: string; missing: string[]; qualityNote?: string }; assignments: { slot: { id: string; label: string }; image: { url: string } }[] } }) {
  if (!plan) return null;
  return {
    score: plan.plan.fidelity.score,
    gatePassed: plan.plan.fidelity.gatePassed,
    gate: plan.plan.fidelity.gate,
    missing: plan.plan.fidelity.missing,
    qualityNote: plan.plan.fidelity.qualityNote ?? null,
    slots: plan.plan.assignments.map((a) => ({
      id: a.slot.id,
      label: a.slot.label,
      url: a.image.url,
    })),
  };
}
