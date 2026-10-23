import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { analyses, products } from "@/lib/db/schema";
import { identifyArticle } from "@/lib/pipeline/identify";
import { createProviders, providerStatus } from "@/lib/providers";
import {
  getWalletSummary,
  releaseAnalysis,
  reserveForAnalysis,
} from "@/lib/wallet/repo";

/** Accepte une URL distante (R2, CDN) ou une image inline (mode démonstration). */
const imageUrl = z.union([z.url(), z.string().startsWith("data:image/").max(4_000_000)]);

const bodySchema = z.object({
  category: z.enum(["beaute", "cheveux", "mode", "gadgets"]),
  regime: z.enum(["detenu", "non_detenu"]),
  country: z.string().length(2).default("CI"),
  imageUrls: z.array(imageUrl).min(1).max(6),
  variantLabel: z.string().max(120).optional(),
  userText: z.string().max(500).optional(),
});

/**
 * Crée une analyse et exécute l'étape d'identification.
 *
 * Le crédit est **réservé** au lancement et **libéré** si l'appariement
 * échoue : tant qu'aucun kit n'est livré, le commerçant ne paie rien.
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
      status: "reservee",
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
    await db.update(analyses).set({ status: "ocr" }).where(eq(analyses.id, analysis.id));

    const providers = createProviders();
    const result = await identifyArticle(providers, {
      category: input.category,
      regime: input.regime,
      country: input.country,
      imageUrls: input.imageUrls,
      variantLabel: input.variantLabel,
      userText: input.userText,
    });

    if (result.blocked) {
      // Aucun débit : la réservation est restituée intégralement.
      await releaseAnalysis({
        userId: session.user.id,
        analysisId: analysis.id,
        reservedXof: wallet.creditXof,
      });
      await db
        .update(analyses)
        .set({
          status: "bloquee_article",
          failureCode: result.match.gateReason,
          matchScore: result.match.score,
          matchCoverage: result.match.coverage.toFixed(2),
          matchResult: result.match as unknown as Record<string, unknown>,
          archetypeSlug: result.archetype.slug,
          updatedAt: new Date(),
        })
        .where(eq(analyses.id, analysis.id));

      return NextResponse.json(
        {
          analysisId: analysis.id,
          status: "bloquee_article",
          archetype: result.archetype,
          match: {
            score: result.match.score,
            coverage: result.match.coverage,
            gateReason: result.match.gateReason,
            components: result.match.components,
          },
          candidatesFound: result.candidatesFound,
          warnings: result.warnings,
          providers: providerStatus(providers),
          charged: false,
          next: "CONFIRM_ARTICLE",
        },
        { status: 200 },
      );
    }

    await db
      .update(analyses)
      .set({
        status: "appariement",
        matchScore: result.match.score,
        matchCoverage: result.match.coverage.toFixed(2),
        matchResult: result.match as unknown as Record<string, unknown>,
        archetypeSlug: result.archetype.slug,
        updatedAt: new Date(),
      })
      .where(eq(analyses.id, analysis.id));

    return NextResponse.json(
      {
        analysisId: analysis.id,
        status: "appariement",
        archetype: result.archetype,
        match: {
          score: result.match.score,
          coverage: result.match.coverage,
          accepted: result.match.accepted,
          gateReason: result.match.gateReason,
          components: result.match.components,
        },
        candidatesFound: result.candidatesFound,
        warnings: result.warnings,
        providers: providerStatus(providers),
        charged: false,
        next: "BUILD_PLAN",
      },
      { status: 201 },
    );
  } catch (error) {
    await releaseAnalysis({
      userId: session.user.id,
      analysisId: analysis.id,
      reservedXof: wallet.creditXof,
    });
    await db
      .update(analyses)
      .set({ status: "echouee", failureCode: "IDENTIFY_FAILED", updatedAt: new Date() })
      .where(eq(analyses.id, analysis.id));

    console.error("[analyses] identification échouée", error);
    return NextResponse.json({ error: "IDENTIFY_FAILED" }, { status: 500 });
  }
}
