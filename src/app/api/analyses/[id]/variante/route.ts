import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { analyses } from "@/lib/db/schema";
import { persistAnalysisOutcome } from "@/lib/pipeline/persist";
import { runAnalysis } from "@/lib/pipeline/run-analysis";
import { createProviders } from "@/lib/providers";
import { getFreshRecord } from "@/lib/products/records";
import { validateSelection } from "@/lib/products/images";
import { releaseAnalysis } from "@/lib/wallet/repo";

export const maxDuration = 300;

const bodySchema = z.object({
  // Un ou plusieurs coloris par axe : le commerçant peut en vendre plusieurs.
  selection: z.record(z.string(), z.array(z.string()).min(1).max(20)),
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
      phase: "produit",
      result,
    });

    /**
     * Étape 1 terminée : le dossier produit est livré et débité.
     * L' étude de marché est une **seconde demande**, facturée séparément,
     * déclenchée par `POST /api/analyses/:id/marche`.
     */
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
