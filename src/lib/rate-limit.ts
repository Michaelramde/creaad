/**
 * Limitation de débit, sans infrastructure.
 *
 * La SPEC §13 exige 10 analyses/heure et 3 recharges/heure par utilisateur.
 * Rien ne l'implémentait : un compte crédité pouvait créer des paiements en
 * série chez GeniusPay, et une boucle de bug pouvait vider le budget Apify.
 *
 * Choix : compter en SQL sur les lignes réellement créées. Pas de Redis, pas
 * de fenêtre glissante approximative — le volume est trop faible pour que
 * cela coûte quoi que ce soit.
 */
import { and, eq, sql } from "drizzle-orm";

import { db } from "./db/index.ts";
import { analyses, topups } from "./db/schema.ts";

export const LIMITS = {
  /** Analyses créées par heure et par compte. */
  analysesPerHour: 10,
  /** Recharges initiées par heure et par compte. */
  topupsPerHour: 3,
} as const;

export interface LimitCheck {
  allowed: boolean;
  used: number;
  max: number;
}

export async function checkAnalysisLimit(userId: string): Promise<LimitCheck> {
  const [row] = await db
    .select({ used: sql<number>`count(*)::int` })
    .from(analyses)
    .where(
      and(
        eq(analyses.userId, userId),
        sql`${analyses.createdAt} > now() - interval '1 hour'`,
      ),
    );

  const used = Number(row?.used ?? 0);
  return { allowed: used < LIMITS.analysesPerHour, used, max: LIMITS.analysesPerHour };
}

export async function checkTopupLimit(userId: string): Promise<LimitCheck> {
  const [row] = await db
    .select({ used: sql<number>`count(*)::int` })
    .from(topups)
    .where(
      and(
        eq(topups.userId, userId),
        sql`${topups.createdAt} > now() - interval '1 hour'`,
      ),
    );

  const used = Number(row?.used ?? 0);
  return { allowed: used < LIMITS.topupsPerHour, used, max: LIMITS.topupsPerHour };
}
