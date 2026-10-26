import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { after, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { analyses, products } from "@/lib/db/schema";
import { persistAnalysisOutcome } from "@/lib/pipeline/persist";
import { runAnalysis } from "@/lib/pipeline/run-analysis";
import { createProviders } from "@/lib/providers";
import { checkAnalysisLimit } from "@/lib/rate-limit";
import { getWalletSummary, releaseAnalysis, reserveForAnalysis } from "@/lib/wallet/repo";

export const maxDuration = 300;

/** Accepte une URL distante (R2, CDN) ou une image inline. */
const imageUrl = z.union([z.url(), z.string().startsWith("data:image/").max(4_000_000)]);

const bodySchema = z.object({
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

/**
 * Création d'une analyse.
 *
 * **Réponse 202 en moins d'une seconde.** Le pipeline (30-55 s) s'exécute
 * après la réponse, dans `after()` : la plateforme ne coupe plus la fonction
 * au milieu d'un appel Apify déjà payé, et le navigateur n'attend plus
 * trente secondes devant un écran figé.
 *
 * La progression réelle est écrite en base (`ocr` → `appariement`) ; la page
 * de résultat la lit et se rafraîchit toute seule.
 */
export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "BAD_REQUEST", issues: parsed.error.issues }, { status: 400 });
  }
  const input = parsed.data;

  const quota = await checkAnalysisLimit(session.user.id);
  if (!quota.allowed) {
    return NextResponse.json(
      {
        error: "RATE_LIMITED",
        message: `${quota.max} analyses par heure maximum. Réessaie dans un moment.`,
        used: quota.used,
        max: quota.max,
      },
      { status: 429, headers: { "Retry-After": "3600" } },
    );
  }

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

  const reserved = await reserveForAnalysis({
    userId: session.user.id,
    analysisId: analysis.id,
    amountXof: wallet.creditXof,
  });

  if (!reserved.debited) {
    // Rejeu immédiat : la réservation existait déjà, on ne relance pas.
    return NextResponse.json({ analysisId: analysis.id, status: analysis.status }, { status: 202 });
  }

  const analysisId = analysis.id;
  const userId = session.user.id;
  const country = input.country;

  after(async () => {
    try {
      const providers = createProviders();
      const result = await runAnalysis(providers, {
        ...(input.category ? { category: input.category } : {}),
        ...(input.regime ? { regime: input.regime } : {}),
        country,
        photos: input.images,
        variantLabel: input.variantLabel,
        userText: input.userText,
        publicImageUrl: publicPhotoUrl(req, analysisId),
        analysisId,
        onStage: async (stage) => {
          await db
            .update(analyses)
            .set({ status: stage, updatedAt: new Date() })
            .where(eq(analyses.id, analysisId));
        },
      });

      await persistAnalysisOutcome({
        analysisId,
        userId,
        country,
        creditXof: wallet.creditXof,
        phase: "produit",
        result,
      });
    } catch (error) {
      // Une exception dans after() ne doit jamais laisser un crédit bloqué.
      await releaseAnalysis({ userId, analysisId, reservedXof: wallet.creditXof }).catch(() => undefined);
      await db
        .update(analyses)
        .set({ status: "echouee", failureCode: "PIPELINE_FAILED", updatedAt: new Date() })
        .where(eq(analyses.id, analysisId))
        .catch(() => undefined);

      console.error("[analyses] pipeline échoué", error);
    }
  });

  return NextResponse.json({ analysisId, status: "ocr", reserved: wallet.creditXof }, { status: 202 });
}
