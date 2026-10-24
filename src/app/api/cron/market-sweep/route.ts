import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { analyses } from "@/lib/db/schema";
import { findProductAds } from "@/lib/market/product-market";
import { createProviders } from "@/lib/providers";
import { getFreshRecord } from "@/lib/products/records";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Rattrapage de la recherche marché produit.
 *
 * L'élargissement tourne après la réponse : si la fonction est interrompue,
 * l'analyse reste livrée mais sans annonces de produit. Ce balayage reprend
 * ces analyses — sinon elles resteraient sur le marché générique pour toujours.
 */
export async function GET(req: Request) {
  const secret = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const pending = await db
    .select({
      id: analyses.id,
      productRef: analyses.productRef,
      country: analyses.country,
    })
    .from(analyses)
    .where(
      and(
        eq(analyses.status, "livree"),
        isNull(analyses.marketScope),
        sql`${analyses.productRef} IS NOT NULL`,
        sql`${analyses.createdAt} > now() - interval '7 days'`,
      ),
    )
    .orderBy(desc(analyses.createdAt))
    .limit(5);

  if (pending.length === 0) return NextResponse.json({ swept: 0 });

  const providers = createProviders();
  const results: { analysisId: string; scope: string; ads: number }[] = [];

  for (const row of pending) {
    if (!row.productRef) continue;

    const record = await getFreshRecord("aliexpress", row.productRef);
    if (!record?.archetypeSlug) continue;

    try {
      const escalation = await findProductAds(
        {
          productRef: record.productId,
          archetypeSlug: record.archetypeSlug,
          country: row.country,
          brand: String((record.facts.brand as { value?: unknown } | undefined)?.value ?? ""),
          model: String((record.facts.model as { value?: unknown } | undefined)?.value ?? ""),
          category: "produit",
        },
        providers.productPipeline?.metaAds,
        { analysisId: row.id },
      );

      await db
        .update(analyses)
        .set({ marketScope: escalation.scope, marketNote: escalation.message, updatedAt: new Date() })
        .where(eq(analyses.id, row.id));

      results.push({ analysisId: row.id, scope: escalation.scope, ads: escalation.ads });
    } catch (error) {
      console.warn("[market-sweep] échec", row.id, error);
    }
  }

  return NextResponse.json({ swept: results.length, results });
}
