import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { after, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { putMarketKit } from "@/lib/cache/store";
import { db } from "@/lib/db";
import { adObservations, analyses, products } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { enrichMarket } from "@/lib/market/enrich";
import { buildPortfolio } from "@/lib/market/portfolio";
import { findProductAds } from "@/lib/market/product-market";
import { buildMatrixFor, ensureArchetype } from "@/lib/market/store";
import { verifyProductAds } from "@/lib/market/verify-ads";
import { repairCreativeKit } from "@/lib/pipeline/repair";
import { createProviders } from "@/lib/providers";
import { getFreshRecord } from "@/lib/products/records";
import { releaseAnalysis, reserveForAnalysis, settleAnalysis } from "@/lib/wallet/repo";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * ÉTAPE 2 — l'étude de marché. **Seconde demande, second crédit.**
 *
 * Elle suppose le dossier produit déjà livré : on refuse tout autre état.
 * Le marché de l'archétype donne les angles immédiatement ; les annonces du
 * produit, les désirs et les objections arrivent derrière (after), parce que
 * l'élargissement pays → zone → monde dépasse la minute.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const { id } = await params;
  const [analysis] = await db
    .select()
    .from(analyses)
    .where(and(eq(analyses.id, id), eq(analyses.userId, session.user.id)))
    .limit(1);

  if (!analysis) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (analysis.status !== "produit_pret") {
    return NextResponse.json(
      {
        error: "WRONG_STATE",
        status: analysis.status,
        message: "L'étude de marché demande un dossier produit déjà livré.",
      },
      { status: 409 },
    );
  }
  if (!analysis.archetypeSlug) {
    return NextResponse.json({ error: "NO_ARCHETYPE" }, { status: 409 });
  }

  const [product] = await db
    .select({ name: products.name })
    .from(products)
    .where(eq(products.id, analysis.productId))
    .limit(1);

  const creditXof = env.CREDIT_XOF;
  const reservation = await reserveForAnalysis({
    userId: session.user.id,
    analysisId: analysis.id,
    amountXof: creditXof,
    step: 2,
  });

  if (!reservation.debited) {
    // Déjà réservée (rejeu) : on continue sans redébiter.
  }

  try {
    const { matrix } = await buildMatrixFor(analysis.archetypeSlug, analysis.country);
    const portfolio = buildPortfolio(matrix);

    if (matrix.publishable) {
      const archetypeId = await ensureArchetype({
        slug: analysis.archetypeSlug,
        label: analysis.archetypeSlug.replace(/-/g, " "),
        category: (analysis.archetypeSlug.split("-")[0] ?? "beaute") as
          | "beaute"
          | "cheveux"
          | "mode"
          | "gadgets",
      });

      await putMarketKit({
        archetypeId,
        country: analysis.country,
        content: { portfolio, dataQuality: matrix.dataQuality },
        adsFound: matrix.dataQuality.adsFound,
        confidence: matrix.dataQuality.confidence,
      });
    }

    await settleAnalysis({
      userId: session.user.id,
      analysisId: analysis.id,
      reservedXof: creditXof,
      actualXof: creditXof,
      step: 2,
    });

    await db
      .update(analyses)
      .set({ status: "livree", step2SettledXof: creditXof, updatedAt: new Date() })
      .where(eq(analyses.id, analysis.id));

    /* ── Le reste après la réponse ────────────────────────────────────────── */
    const record = analysis.productRef ? await getFreshRecord("aliexpress", analysis.productRef) : null;
    const providers = createProviders();

    after(async () => {
      try {
        // 1. Les créas, qui découlent des angles.
        const repair = await repairCreativeKit(providers, analysis.id);
        if (!repair.repaired && repair.reason && repair.reason !== "Kit déjà présent.") {
          console.warn("[marche] kit production non réparé :", repair.reason);
        }

        if (!record) return;

        // 2. Les annonces du produit, élargies jusqu'à en trouver.
        const escalation = await findProductAds(
          {
            productRef: record.productId,
            archetypeSlug: analysis.archetypeSlug as string,
            country: analysis.country,
            brand: String((record.facts.brand as { value?: unknown } | undefined)?.value ?? ""),
            model: String((record.facts.model as { value?: unknown } | undefined)?.value ?? ""),
            category: "produit",
          },
          providers.productPipeline?.metaAds,
          { analysisId: analysis.id },
        );

        await db
          .update(analyses)
          .set({ marketScope: escalation.scope, marketNote: escalation.message, updatedAt: new Date() })
          .where(eq(analyses.id, analysis.id));

        if (escalation.ads === 0) return;

        // 3. Vérification visuelle : l'annonce montre-t-elle bien ce produit ?
        if (env.GEMINI_API_KEY && record.gallery[0]?.url) {
          const verified = await verifyProductAds({
            productRef: record.productId,
            productImageUrl: record.gallery[0].url,
            apiKey: env.GEMINI_API_KEY,
          });
          if (verified.checked > 0) {
            await db
              .update(analyses)
              .set({
                marketNote: `${escalation.message} ${verified.confirmed}/${verified.checked} visuels confirment le produit.`,
                updatedAt: new Date(),
              })
              .where(eq(analyses.id, analysis.id));
          }
        }

        // 4. Concurrents, désirs et objections — désirs et objections
        //    s'appuient sur les **avis clients** autant que sur les annonces.
        const rows = await db
          .select({
            advertiserId: adObservations.advertiserId,
            advertiserName: adObservations.advertiserName,
            hook: adObservations.hook,
            startDate: adObservations.startDate,
            url: adObservations.url,
            isActive: adObservations.isActive,
          })
          .from(adObservations)
          .where(eq(adObservations.productRef, record.productId))
          .limit(100);

        const { enrichment } = await enrichMarket({
          writer: providers.writer,
          ads: rows.map((row) => ({ ...row, hook: row.hook ?? "" })),
          reviews: record.reviews,
          product: {
            title: record.title,
            category: "produit",
            country: analysis.country,
          },
        });

        if (enrichment) {
          await db
            .update(analyses)
            .set({ marketEnrichment: enrichment as unknown as Record<string, unknown>, updatedAt: new Date() })
            .where(eq(analyses.id, analysis.id));
        }
      } catch (error) {
        console.warn("[marche] enrichissement échoué", error);
      }
    });

    return NextResponse.json({
      analysisId: analysis.id,
      status: "livree",
      step: 2,
      product: product?.name ?? null,
      market: {
        publishable: matrix.publishable,
        adsFound: matrix.dataQuality.adsFound,
        advertisers: matrix.dataQuality.distinctAdvertisers,
        confidence: matrix.dataQuality.confidence,
        angles: portfolio.entries.slice(0, 6).map((entry) => ({
          family: entry.family,
          action: entry.action,
          advertisers: entry.figures.advertisers,
          medianDays: Math.round(entry.figures.medianDaysRunning),
        })),
      },
      charged: true,
      creditXof,
    });
  } catch (error) {
    await releaseAnalysis({
      userId: session.user.id,
      analysisId: analysis.id,
      reservedXof: creditXof,
      step: 2,
    });

    console.error("[marche] étape 2 échouée", error);
    return NextResponse.json(
      { error: "MARKET_STEP_FAILED", message: "L'étude de marché a échoué. Aucun crédit n'a été débité." },
      { status: 503 },
    );
  }
}
