/**
 * Application d'un paiement vérifié — logique partagée par le webhook
 * et le job de réconciliation. Une seule implémentation = une seule vérité.
 */
import { and, eq, gt, lt, sql } from "drizzle-orm";

import { logPipelineCost, XOF_PER_USD } from "@/lib/costs";
import { db } from "@/lib/db";
import { topups } from "@/lib/db/schema";
import { verifyPayment } from "@/lib/geniuspay/client";
import { creditTopup } from "@/lib/wallet/repo";

export type SyncOutcome =
  | { result: "credited"; topupId: string; balance: number }
  | { result: "already_credited"; topupId: string }
  | { result: "not_completed"; topupId: string; status: string }
  | { result: "unknown_reference" }
  | { result: "amount_mismatch"; topupId: string; expected: number; paid: number };

/**
 * Idempotent de bout en bout : appelable autant de fois que nécessaire
 * (webhook rejoué, cron, retry manuel).
 */
export async function syncTopup(reference: string): Promise<SyncOutcome> {
  const [topup] = await db
    .select()
    .from(topups)
    .where(eq(topups.reference, reference))
    .limit(1);

  if (!topup) return { result: "unknown_reference" };
  if (topup.status === "completed") return { result: "already_credited", topupId: topup.id };

  // Source de vérité : l'API, jamais le payload du webhook.
  const state = await verifyPayment(reference);

  if (state.status !== "completed") {
    await db.update(topups).set({ status: state.status }).where(eq(topups.id, topup.id));
    return { result: "not_completed", topupId: topup.id, status: state.status };
  }

  if (state.amountXof !== topup.amountXof) {
    return {
      result: "amount_mismatch",
      topupId: topup.id,
      expected: topup.amountXof,
      paid: state.amountXof,
    };
  }

  const { balance } = await creditTopup({
    userId: topup.userId,
    topupId: topup.id,
    providerTxnId: state.reference,
    expectedXof: topup.amountXof,
    paidXof: state.amountXof,
  });

  await db
    .update(topups)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(topups.id, topup.id));

  /**
   * Les frais d'encaissement sont un coût, pas un revenu. Les ignorer rendait
   * la marge fausse de 4,5 % : on les journalise au même endroit que le reste,
   * marqués « estimated » tant que le taux réel n'est pas confirmé.
   */
  const feeXof = state.fees ?? Math.round(state.amountXof * 0.025 + 100);
  void logPipelineCost({
    step: "payment_fee",
    provider: "geniuspay",
    ...(state.paymentMethod ? { model: state.paymentMethod } : {}),
    costUsd: feeXof / XOF_PER_USD,
    externalId: state.reference,
    estimated: true,
  });

  return { result: "credited", topupId: topup.id, balance };
}

/**
 * Recharges laissées en attente : les webhooks se perdent, y compris chez
 * les meilleurs. Sans ce filet, un client paie et n'est jamais crédité.
 */
export async function pendingTopupsOlderThan(seconds: number, limit = 50) {
  const cutoff = new Date(Date.now() - seconds * 1000);
  const notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);

  return db
    .select({ reference: topups.reference })
    .from(topups)
    .where(
      and(
        sql`${topups.status} IN ('pending','processing')`,
        lt(topups.createdAt, cutoff),
        gt(topups.createdAt, notBefore),
        sql`${topups.reference} IS NOT NULL`,
      ),
    )
    .limit(limit);
}
