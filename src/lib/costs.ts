/**
 * Traçabilité des coûts.
 *
 * Chaque appel payant écrit une ligne dans `pipeline_costs`. Sans ça, le
 * budget est une opinion ; avec ça, c'est une mesure — et le plafond
 * quotidien peut être appliqué sans deviner.
 */
import { sql } from "drizzle-orm";

import { db } from "./db/index.ts";
import { pipelineCosts } from "./db/schema.ts";
import { env } from "./env.ts";

export interface CostEntry {
  analysisId?: string;
  step: string;
  provider: string;
  model?: string;
  costUsd: number;
  durationMs?: number;
}

export async function logPipelineCost(entry: CostEntry): Promise<void> {
  try {
    await db.insert(pipelineCosts).values({
      analysisId: entry.analysisId ?? null,
      step: entry.step,
      provider: entry.provider,
      model: entry.model ?? null,
      costUsd: entry.costUsd.toFixed(6),
      durationMs: entry.durationMs ?? null,
    });
  } catch (error) {
    // La comptabilité ne doit jamais faire échouer une analyse.
    console.error("[costs] écriture impossible", error);
  }
}

/** Dépense cumulée des dernières 24 heures, en dollars. */
export async function spentLast24hUsd(): Promise<number> {
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${pipelineCosts.costUsd}), 0)`,
    })
    .from(pipelineCosts)
    .where(sql`${pipelineCosts.createdAt} > now() - interval '24 hours'`);

  return Number(row?.total ?? 0);
}

export interface BudgetCheck {
  allowed: boolean;
  spentUsd: number;
  capUsd: number;
}

/**
 * Le plafond protège contre trois choses : un bug de boucle, un acteur qui
 * augmente ses prix, et une journée de tests oubliée.
 */
export async function checkBudget(): Promise<BudgetCheck> {
  const capUsd = env.APIFY_DAILY_CAP_USD;
  if (capUsd <= 0) return { allowed: true, spentUsd: 0, capUsd };
  const spentUsd = await spentLast24hUsd();
  return { allowed: spentUsd < capUsd, spentUsd, capUsd };
}
