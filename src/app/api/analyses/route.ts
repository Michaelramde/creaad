import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { analyses, products } from "@/lib/db/schema";
import { persistAnalysisOutcome } from "@/lib/pipeline/persist";
import { runAnalysis } from "@/lib/pipeline/run-analysis";
import { createProviders } from "@/lib/providers";
import { getWalletSummary, releaseAnalysis, reserveForAnalysis } from "@/lib/wallet/repo";

/** Accepte une URL distante (R2, CDN) ou une image inline. */
const imageUrl = z.union([z.url(), z.string().startsWith("data:image/").max(4_000_000)]);

const bodySchema = z.object({
  // Catégorie et mode ne sont plus demandés : le moteur les déduit.
  category: z.enum(["beaute", "cheveux", "mode", "gadgets"]).optional(),
  regime: z.enum(["detenu", "non_detenu"]).optional(),
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

/** URL publique d'une photo, pour que la recherche inversée puisse la lire. */
function publicPhotoUrl(request: Request, analysisId: string): string {
  const origin = new URL(request.url).origin;
  return `${origin}/api/photos/${analysisId}/0`;
}

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
      category: input.category ?? "beaute",
      regime: input.regime ?? "non_detenu",
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
      photos: input.images,
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
      ...(input.category ? { category: input.category } : {}),
      ...(input.regime ? { regime: input.regime } : {}),
      country: input.country,
      photos: input.images,
      variantLabel: input.variantLabel,
      userText: input.userText,
      publicImageUrl: publicPhotoUrl(req, analysis.id),
      analysisId: analysis.id,
    });

    const outcome = await persistAnalysisOutcome({
      analysisId: analysis.id,
      userId: session.user.id,
      country: input.country,
      creditXof: wallet.creditXof,
      result,
    });

    return NextResponse.json(outcome.payload);
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
