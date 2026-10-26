import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { after, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { analyses } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { persistAnalysisOutcome } from "@/lib/pipeline/persist";
import { runAnalysis } from "@/lib/pipeline/run-analysis";
import { createProviders } from "@/lib/providers";
import { classifyProductRecord } from "@/lib/products/enrich-images";
import { validateSelection } from "@/lib/products/images";
import { getFreshRecord } from "@/lib/products/records";
import { releaseAnalysis } from "@/lib/wallet/repo";

export const maxDuration = 300;

const bodySchema = z.object({
  // Un ou plusieurs coloris par axe : le commerçant peut en vendre plusieurs.
  selection: z.record(z.string(), z.array(z.string()).min(1).max(20)),
});

/**
 * Reprise après choix du coloris.
 *
 * Réponse 202 immédiate, comme la création : la fiche produit est en cache,
 * donc rien n'est repayé, mais la construction de la planche et du marché dure
 * des dizaines de secondes. La suite s'exécute dans after(), la progression
 * réelle est écrite en base, et la page de résultat se rafraîchit d'elle-même.
 *
 * Avant : la requête attendait 30-60 s en affichant des étapes inventées.
 * Un timeout coupait la fonction au milieu du travail.
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
        message: `Ce coloris n’existe pas chez ce fournisseur : ${check.unknown.join(", ")}`,
      },
      { status: 400 },
    );
  }

  const analysisId = analysis.id;
  const userId = session.user.id;
  const country = analysis.country;
  const reservedXof = analysis.reservedXof ?? 0;
  const productRef = analysis.productRef;
  const photos = analysis.photos;
  const selection = parsed.data.selection;

  // État « en vol » : la page de résultat affiche la progression réelle.
  await db
    .update(analyses)
    .set({ status: "ocr", updatedAt: new Date() })
    .where(eq(analyses.id, analysisId));

  after(async () => {
    try {
      const providers = createProviders();
      const result = await runAnalysis(providers, {
        country,
        photos,
        productRef,
        variantSelection: selection,
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
        creditXof: reservedXof,
        phase: "produit",
        result,
      });

      /**
       * Le classement des images relie chaque photo à un coloris : sans lui,
       * cocher un coloris ne changerait rien à l'export. Long, donc après la
       * réponse — et un échec ici ne défait pas la livraison.
       */
      if (env.GEMINI_API_KEY) {
        try {
          await classifyProductRecord(productRef, env.GEMINI_API_KEY);
        } catch (error) {
          console.warn("[variante] classement des images échoué", error);
        }
      }
    } catch (error) {
      await releaseAnalysis({ userId, analysisId, reservedXof }).catch(() => undefined);
      await db
        .update(analyses)
        .set({ status: "echouee", failureCode: "VARIANT_RESUME_FAILED", updatedAt: new Date() })
        .where(eq(analyses.id, analysisId))
        .catch(() => undefined);

      console.error("[variante] reprise échouée", error);
    }
  });

  return NextResponse.json({ analysisId, status: "ocr", resumed: true }, { status: 202 });
}
