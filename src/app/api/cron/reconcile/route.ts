import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { analyses } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { pendingTopupsOlderThan, syncTopup } from "@/lib/payments/settle";
import { releaseAnalysis } from "@/lib/wallet/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Au-delà, une analyse laissée en cours est considérée abandonnée. */
const ABANDON_MINUTES = 30;

/**
 * Filet de sécurité des webhooks perdus — et des analyses abandonnées.
 *
 * Un commerçant qui ferme l'onglet après le lancement laisse une réservation
 * de 1 000 FCFA bloquée. Sans ce nettoyage, son solde baisse sans contrepartie.
 */
export async function GET(req: Request) {
  const secret = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const pending = await pendingTopupsOlderThan(60);
  const results: Record<string, number> = { credited: 0, already: 0, pending: 0, failed: 0 };

  for (const row of pending) {
    if (!row.reference) continue;
    try {
      const outcome = await syncTopup(row.reference);
      if (outcome.result === "credited") results.credited! += 1;
      else if (outcome.result === "already_credited") results.already! += 1;
      else if (outcome.result === "not_completed") results.pending! += 1;
      else results.failed! += 1;
    } catch (error) {
      console.error("[cron/reconcile] échec", row.reference, error);
      results.failed! += 1;
    }
  }

  /* ── Analyses abandonnées : on rend la réservation ────────────────────── */
  // `variante_a_choisir` en fait partie : c'est l'état où l'on attend une
  // réponse de l'utilisateur, et donc celui où il peut fermer l'onglet.
  const abandoned = await db
    .select({ id: analyses.id, userId: analyses.userId, reservedXof: analyses.reservedXof })
    .from(analyses)
    .where(
      and(
        inArray(analyses.status, ["ocr", "appariement", "reservee", "creee", "variante_a_choisir"]),
        sql`${analyses.reservedXof} > 0`,
        sql`${analyses.createdAt} < now() - (${ABANDON_MINUTES} || ' minutes')::interval`,
      ),
    )
    .limit(20);

  let released = 0;
  for (const row of abandoned) {
    try {
      await releaseAnalysis({
        userId: row.userId,
        analysisId: row.id,
        reservedXof: row.reservedXof,
        step: 1,
      });
      await db
        .update(analyses)
        .set({ status: "echouee", failureCode: "ABANDONED", updatedAt: new Date() })
        .where(eq(analyses.id, row.id));
      released += 1;
    } catch (error) {
      console.error("[cron/reconcile] libération impossible", row.id, error);
    }
  }

  return NextResponse.json({
    checked: pending.length,
    results,
    abandoned: { found: abandoned.length, released },
    base: env.GP_BASE,
    at: new Date().toISOString(),
  });
}
