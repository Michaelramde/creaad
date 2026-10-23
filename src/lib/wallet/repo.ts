import { and, eq, inArray, sql } from "drizzle-orm";

import { db, type Tx } from "@/lib/db";
import { walletTransactions } from "@/lib/db/schema";
import { env } from "@/lib/env";

import {
  applyEntries,
  creditEntry,
  type EntryDraft,
  InsufficientFundsError,
  releaseEntries,
  remainingAnalyses,
  reservationEntries,
  settleEntries,
} from "./core";

export type { EntryDraft };

/** Solde courant, calculé sur le registre (jamais stocké comme champ mutable). */
async function currentBalance(tx: Tx, userId: string): Promise<number> {
  const rows = await tx
    .select({ balance: sql<string>`coalesce(sum(${walletTransactions.amountXof}), 0)` })
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, userId));
  return Number(rows[0]?.balance ?? 0);
}

/**
 * Écrit un lot d'écritures de façon atomique et idempotente.
 *
 * - Verrou consultatif par utilisateur : sérialise les écritures concurrentes
 *   sans bloquer les autres comptes.
 * - Les clés déjà présentes sont ignorées (rejeu de webhook, retry Inngest).
 * - Le lot est validé AVANT écriture : aucun passage en négatif possible.
 * - `balanceAfter` est figé au moment de l'écriture, pour l'audit.
 */
export async function postEntries(
  userId: string,
  drafts: readonly EntryDraft[],
): Promise<{ balance: number; posted: EntryDraft[] }> {
  if (drafts.length === 0) {
    return { balance: await getBalance(userId), posted: [] };
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

    const balance = await currentBalance(tx, userId);

    const keys = [...new Set(drafts.map((d) => d.idempotencyKey))];
    const already = await tx
      .select({ key: walletTransactions.idempotencyKey })
      .from(walletTransactions)
      .where(
        and(
          eq(walletTransactions.userId, userId),
          inArray(walletTransactions.idempotencyKey, keys),
        ),
      );
    const seen = new Set(already.map((r) => r.key));

    const fresh = drafts.filter((d) => !seen.has(d.idempotencyKey));
    if (fresh.length === 0) return { balance, posted: [] };

    // Validation du lot complet avant toute écriture.
    let running = applyEntries(balance, fresh);

    const posted: EntryDraft[] = [];
    let acc = balance;
    for (const d of fresh) {
      acc += d.amountXof;
      const rows = await tx
        .insert(walletTransactions)
        .values({
          userId,
          type: d.type,
          amountXof: d.amountXof,
          balanceAfter: acc,
          analysisId: d.analysisId ?? null,
          topupId: d.topupId ?? null,
          provider: d.provider ?? null,
          providerTxnId: d.providerTxnId ?? null,
          idempotencyKey: d.idempotencyKey,
          metadata: d.metadata ?? {},
        })
        // Filet de sécurité : l'index unique (provider, provider_txn_id)
        // attrape aussi les collisions, pas seulement la clé d'idempotence.
        .onConflictDoNothing()
        .returning({ id: walletTransactions.id });

      if (rows.length === 0) {
        acc -= d.amountXof;
        continue;
      }
      posted.push(d);
    }

    running = acc;
    return { balance: running, posted };
  });
}

export async function getBalance(userId: string): Promise<number> {
  return db.transaction((tx) => currentBalance(tx, userId));
}

export interface WalletSummary {
  balanceXof: number;
  creditXof: number;
  remaining: number;
  minTopupXof: number;
  canLaunch: boolean;
}

export async function getWalletSummary(userId: string): Promise<WalletSummary> {
  const balanceXof = await getBalance(userId);
  return {
    balanceXof,
    creditXof: env.CREDIT_XOF,
    remaining: remainingAnalyses(balanceXof, env.CREDIT_XOF),
    minTopupXof: env.MIN_TOPUP_XOF,
    canLaunch: balanceXof >= env.CREDIT_XOF,
  };
}

/**
 * Crédite une recharge confirmée par le fournisseur.
 * Le montant payé est revérifié : un webhook dont le montant diverge est refusé.
 */
export async function creditTopup(input: {
  userId: string;
  topupId: string;
  providerTxnId: string;
  expectedXof: number;
  paidXof: number;
  provider?: string;
}): Promise<{ balance: number; credited: boolean }> {
  if (input.paidXof !== input.expectedXof) {
    throw new Error(
      `Montant divergent : attendu ${input.expectedXof} FCFA, reçu ${input.paidXof} FCFA (txn ${input.providerTxnId}).`,
    );
  }

  const { balance, posted } = await postEntries(input.userId, [
    creditEntry({
      topupId: input.topupId,
      providerTxnId: input.providerTxnId,
      amountXof: input.paidXof,
      provider: input.provider,
    }),
  ]);

  return { balance, credited: posted.length > 0 };
}

/**
 * Réserve un crédit au lancement. Lève InsufficientFundsError si le solde ne couvre pas.
 *
 * `debited` vaut `false` quand l'écriture existait déjà (rejeu) : l'appelant
 * ne doit pas compter cela comme un nouveau lancement. Sans cette distinction,
 * un appel rejoué ressemble à un succès et le solde ne bouge pas — exactement
 * le genre d'incohérence qui casse un test de concurrence.
 */
export async function reserveForAnalysis(input: {
  userId: string;
  analysisId: string;
  amountXof?: number;
}): Promise<{ balance: number; debited: boolean }> {
  const amount = input.amountXof ?? env.CREDIT_XOF;
  const { balance, posted } = await postEntries(
    input.userId,
    reservationEntries(input.analysisId, amount),
  );
  return { balance, debited: posted.length > 0 };
}

/** Règle le coût réel à la livraison, restitue le trop-perçu. */
export async function settleAnalysis(input: {
  userId: string;
  analysisId: string;
  reservedXof: number;
  actualXof: number;
}): Promise<{ balance: number }> {
  const { balance } = await postEntries(
    input.userId,
    settleEntries(input.analysisId, input.reservedXof, input.actualXof),
  );
  return { balance };
}

/** Échec : restitution intégrale. Le commerçant n'a rien payé. */
export async function releaseAnalysis(input: {
  userId: string;
  analysisId: string;
  reservedXof: number;
}): Promise<{ balance: number }> {
  const { balance } = await postEntries(
    input.userId,
    releaseEntries(input.analysisId, input.reservedXof),
  );
  return { balance };
}

export { InsufficientFundsError };
