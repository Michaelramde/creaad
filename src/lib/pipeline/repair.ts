/**
 * Réparation du kit production.
 *
 * Le rédacteur peut échouer (saturation du modèle) alors que la planche et le
 * marché sont prêts : l'analyse est livrée et débitée avec deux kits au lieu
 * de trois. Ce rattrapage rejoue la seule partie manquante, à partir des
 * données déjà en base — sans rien refacturer ni relancer la moindre collecte.
 */
import { and, eq } from "drizzle-orm";

import { db } from "../db/index.ts";
import { analyses, archetypes, creativeKits, marketKits } from "../db/schema.ts";
import type { PortfolioEntry } from "../market/portfolio.ts";
import { getFreshRecord } from "../products/records.ts";
import type { Providers } from "../providers/types.ts";
import { buildCreativeStep } from "./creative.ts";

export async function repairCreativeKit(
  providers: Providers,
  analysisId: string,
): Promise<{ repaired: boolean; reason?: string }> {
  if (!providers.writer) return { repaired: false, reason: "Aucun rédacteur configuré." };

  const [existing] = await db
    .select({ id: creativeKits.id })
    .from(creativeKits)
    .where(eq(creativeKits.analysisId, analysisId))
    .limit(1);
  if (existing) return { repaired: false, reason: "Kit déjà présent." };

  const [analysis] = await db
    .select({ id: analyses.id, country: analyses.country, archetypeSlug: analyses.archetypeSlug, productRef: analyses.productRef })
    .from(analyses)
    .where(eq(analyses.id, analysisId))
    .limit(1);
  if (!analysis?.archetypeSlug) return { repaired: false, reason: "Archétype inconnu." };

  const [archetype] = await db
    .select({ id: archetypes.id, label: archetypes.label, category: archetypes.category })
    .from(archetypes)
    .where(eq(archetypes.slug, analysis.archetypeSlug))
    .limit(1);
  if (!archetype) return { repaired: false, reason: "Archétype absent du catalogue." };

  const [cache] = await db
    .select()
    .from(marketKits)
    .where(and(eq(marketKits.archetypeId, archetype.id), eq(marketKits.country, analysis.country)))
    .limit(1);

  const portfolio = ((cache?.content as { portfolio?: { entries?: PortfolioEntry[] } } | undefined)?.portfolio
    ?.entries ?? []) as PortfolioEntry[];
  if (portfolio.length === 0) return { repaired: false, reason: "Marché absent." };

  const record = analysis.productRef ? await getFreshRecord("aliexpress", analysis.productRef) : null;

  const creative = await buildCreativeStep(providers.writer, {
    product: {
      title: record?.title ?? archetype.label,
      archetype: archetype.label,
      category: archetype.category,
      claims: [],
      specs: Object.values(record?.specs ?? {}).slice(0, 6),
    },
    portfolio: portfolio.slice(0, 6).map((entry) => ({
      family: entry.family,
      action: entry.action,
      advertisers: entry.figures.advertisers,
      medianDays: entry.figures.medianDaysRunning,
      rationale: entry.rationale,
    })),
    country: analysis.country,
    language: "fr",
  });

  if (!creative.kit) {
    return { repaired: false, reason: creative.warnings[0] ?? "Rédaction impossible." };
  }

  await db
    .insert(creativeKits)
    .values({ analysisId, content: creative.kit as unknown as object })
    .onConflictDoNothing();

  return { repaired: true };
}
