import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { after, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { analyses } from "@/lib/db/schema";
import { findProductAds } from "@/lib/market/product-market";
import { persistAnalysisOutcome } from "@/lib/pipeline/persist";
import { runAnalysis } from "@/lib/pipeline/run-analysis";
import { createProviders } from "@/lib/providers";
import { getFreshRecord } from "@/lib/products/records";
import { validateSelection } from "@/lib/products/images";
import { releaseAnalysis } from "@/lib/wallet/repo";

export const maxDuration = 300;

const bodySchema = z.object({
  selection: z.record(z.string(), z.string()),
});

/**
 * Reprise après choix du coloris.
 *
 * La fiche produit est en cache : cet appel ne repaie rien. Seule la suite du
 * pipeline (planche, marché, production) est exécutée, puis le crédit réservé
 * est débité si les kits sont livrés.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });

  const [analysis] = await db
    .select()
    .from(analyses)
    .where(and(eq(analyses.id, id), eq(analyses.userId, session.user.id)))
    .limit(1);

  if (!analysis) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (analysis.status !== "variante_a_choisir") {
    return NextResponse.json({ error: "WRONG_STATE", status: analysis.status }, { status: 409 });
  }
  if (!analysis.productRef) {
    return NextResponse.json({ error: "NO_PRODUCT_REF" }, { status: 409 });
  }

  // Le coloris doit exister : sinon on le dit, on ne substitue pas.
  const record = await getFreshRecord("aliexpress", analysis.productRef);
  if (!record) {
    return NextResponse.json(
      { error: "PRODUCT_EXPIRED", message: "La fiche produit a expiré. Relance l'analyse." },
      { status: 410 },
    );
  }

  const check = validateSelection(record, parsed.data.selection);
  if (!check.valid) {
    return NextResponse.json(
      {
        error: "UNKNOWN_VARIANT",
        message: `Ce coloris n'existe pas chez ce fournisseur : ${check.unknown.join(", ")}`,
      },
      { status: 400 },
    );
  }

  try {
    const providers = createProviders();
    const result = await runAnalysis(providers, {
      country: analysis.country,
      photos: analysis.photos,
      productRef: analysis.productRef,
      variantSelection: parsed.data.selection,
      analysisId: analysis.id,
    });

    const outcome = await persistAnalysisOutcome({
      analysisId: analysis.id,
      userId: session.user.id,
      country: analysis.country,
      creditXof: analysis.reservedXof ?? 0,
      result,
    });

    /**
     * Recherche des annonces **de ce produit** — après la réponse.
     *
     * L'échelle peut enchaîner trois appels et dépasser la minute : la faire
     * attendre au commerçant n'a aucun sens alors que le kit archétype est
     * déjà prêt. On la lance derrière, elle enrichit `ad_observations`, et la
     * page se rafraîchit avec les angles du produit.
     *
     * On lit l'archétype sur **l'analyse** : la fiche locale a été lue avant
     * le routage et peut encore être vide à cet instant.
     */
    // Relecture : l'archétype vient d'être résolu pendant la livraison.
    const [fresh] = await db
      .select({ archetypeSlug: analyses.archetypeSlug })
      .from(analyses)
      .where(eq(analyses.id, analysis.id))
      .limit(1);

    const archetypeSlug = fresh?.archetypeSlug ?? record.archetypeSlug;
    if (!archetypeSlug) {
      // Rien à quoi rattacher les annonces : la page restera sur le repli.
    } else {
      const brand = String((record.facts.brand as { value?: unknown } | undefined)?.value ?? "");
      const model = String((record.facts.model as { value?: unknown } | undefined)?.value ?? "");

      after(async () => {
        try {
          const escalation = await findProductAds(
            {
              productRef: record.productId,
              archetypeSlug,
              country: analysis.country,
              brand,
              model,
              category: "produit",
            },
            providers.productPipeline?.metaAds,
            { analysisId: analysis.id },
          );

          await db
            .update(analyses)
            .set({ marketScope: escalation.scope, marketNote: escalation.message, updatedAt: new Date() })
            .where(eq(analyses.id, analysis.id));
        } catch (error) {
          console.warn("[variante] recherche produit échouée", error);
        }
      });
    }

    return NextResponse.json(outcome.payload);
  } catch (error) {
    await releaseAnalysis({
      userId: session.user.id,
      analysisId: analysis.id,
      reservedXof: analysis.reservedXof ?? 0,
    });
    await db
      .update(analyses)
      .set({ status: "echouee", failureCode: "VARIANT_RESUME_FAILED", updatedAt: new Date() })
      .where(eq(analyses.id, analysis.id));

    console.error("[variante] reprise échouée", error);
    return NextResponse.json(
      { error: "PIPELINE_FAILED", message: "La reprise a échoué. Aucun crédit n'a été débité." },
      { status: 503 },
    );
  }
}
