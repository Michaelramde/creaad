import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { analyses } from "@/lib/db/schema";
import { refundAnalysis } from "@/lib/wallet/repo";

export const runtime = "nodejs";

const REFUNDABLE = new Set(["livree", "produit_pret"]);

/**
 * « Ce n'est pas mon produit. »
 *
 * Le pire échec du produit n'était pas le blocage : c'était le faux positif —
 * une planche construite sur l'article de quelqu'un d'autre, facturée, sans
 * recours. Il n'existait aucun bouton pour le dire.
 *
 * Ici : on rembourse le crédit (idempotent), on conserve la trace
 * (`failure_code`) et on n'efface pas les kits déjà produits — le commerçant
 * peut les relire, mais l'analyse n'est plus comptée comme livrée.
 *
 * Chaque clic produit en plus une étiquette gratuite pour recalibrer le seuil
 * d'appariement, qui n'a jamais été mesuré.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const { id } = await ctx.params;
  const [analysis] = await db
    .select()
    .from(analyses)
    .where(and(eq(analyses.id, id), eq(analyses.userId, session.user.id)))
    .limit(1);

  if (!analysis) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  if (analysis.failureCode === "WRONG_PRODUCT") {
    return NextResponse.json({ analysisId: id, refunded: false, already: true });
  }

  if (!REFUNDABLE.has(analysis.status)) {
    return NextResponse.json({ error: "WRONG_STATE", status: analysis.status }, { status: 409 });
  }

  const amount = analysis.settledXof > 0 ? analysis.settledXof : analysis.reservedXof;
  const refund =
    amount > 0
      ? await refundAnalysis({ userId: session.user.id, analysisId: id, amountXof: amount })
      : { balance: 0, refunded: false };

  await db
    .update(analyses)
    .set({
      status: "echouee",
      failureCode: "WRONG_PRODUCT",
      settledXof: 0,
      updatedAt: new Date(),
    })
    .where(eq(analyses.id, id));

  return NextResponse.json({
    analysisId: id,
    refunded: refund.refunded,
    amountXof: refund.refunded ? amount : 0,
    balanceXof: refund.balance,
    message: refund.refunded
      ? `Remboursé : ${amount} FCFA rendus sur ton solde.`
      : "Aucun crédit à rembourser sur cette analyse.",
  });
}
