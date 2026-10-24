/**
 * Le catalogue des marchés **réellement couverts**.
 *
 * Un archétype sans annonce n'est pas un marché : il ne sert à rien de router
 * un produit vers lui. On ne propose donc que les slugs qui ont des
 * observations, avec leur volume — ce qui permet de départager.
 */
import { sql } from "drizzle-orm";

import { db } from "../db/index.ts";
import { adObservations, archetypes } from "../db/schema.ts";
import type { CatalogueEntry } from "./route.ts";

export async function loadCatalogue(): Promise<CatalogueEntry[]> {
  const rows = await db
    .select({ slug: adObservations.archetypeSlug, ads: sql<number>`count(*)::int` })
    .from(adObservations)
    .groupBy(adObservations.archetypeSlug);

  if (rows.length === 0) return [];

  const labels = await db.select({ slug: archetypes.slug, label: archetypes.label }).from(archetypes);
  const bySlug = new Map(labels.map((row) => [row.slug, row.label]));

  return rows
    .map((row) => ({
      slug: row.slug,
      label: bySlug.get(row.slug) ?? row.slug.replace(/-/g, " "),
      ads: Number(row.ads),
    }))
    .sort((a, b) => b.ads - a.ads);
}
