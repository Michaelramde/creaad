/**
 * Stockage des observations publicitaires et alimentation du moteur.
 */
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { adObservations } from "@/lib/db/schema";

import { ingestAds, type IngestReport, type RawAdRow } from "./ingest.ts";
import { buildMatrix } from "./saturation.ts";
import type { SaturationMatrix } from "./types.ts";

export interface SaveResult {
  inserted: number;
  updated: number;
}

/** Upsert idempotent : la même annonce vue deux fois n'est comptée qu'une fois. */
export async function saveAds(rows: readonly RawAdRow[]): Promise<SaveResult> {
  if (rows.length === 0) return { inserted: 0, updated: 0 };

  const inserted = await db
    .insert(adObservations)
    .values(
      rows.map((row) => ({
        archetypeSlug: row.archetypeSlug,
        country: row.country.toUpperCase(),
        platform: row.platform,
        advertiserId: row.advertiserId,
        advertiserName: row.advertiserName ?? null,
        hook: row.hook ?? null,
        startDate: row.startDate ? new Date(row.startDate) : null,
        endDate: row.endDate ? new Date(row.endDate) : null,
        isActive: row.isActive,
        url: row.url,
        source: "collector",
      })),
    )
    .onConflictDoUpdate({
      target: [adObservations.platform, adObservations.url],
      set: {
        isActive: sql`excluded.is_active`,
        endDate: sql`excluded.end_date`,
        hook: sql`sql.COALESCE(excluded.hook, ${adObservations.hook})`,
        collectedAt: new Date(),
      },
    })
    .returning({ id: adObservations.id });

  return { inserted: inserted.length, updated: 0 };
}

export async function loadAds(archetypeSlug: string, country: string): Promise<RawAdRow[]> {
  const rows = await db
    .select()
    .from(adObservations)
    .where(
      and(
        eq(adObservations.archetypeSlug, archetypeSlug),
        eq(adObservations.country, country.toUpperCase()),
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    archetypeSlug: row.archetypeSlug,
    country: row.country,
    platform: row.platform,
    advertiserId: row.advertiserId,
    advertiserName: row.advertiserName,
    hook: row.hook,
    startDate: row.startDate,
    endDate: row.endDate,
    isActive: row.isActive,
    url: row.url,
    collectedAt: row.collectedAt,
  }));
}

export interface MatrixBuild {
  matrix: SaturationMatrix;
  report: IngestReport;
}

/**
 * Construit la matrice de saturation pour un archétype et un pays,
 * à partir des seules observations stockées.
 */
export async function buildMatrixFor(
  archetypeSlug: string,
  country: string,
  options: { referenceCountry?: string; now?: number } = {},
): Promise<MatrixBuild> {
  const ads = await loadAds(archetypeSlug, country);
  const reference = options.referenceCountry
    ? await loadAds(archetypeSlug, options.referenceCountry)
    : [];

  const { observations, report } = ingestAds(ads, { now: options.now });
  const referenceIngested = ingestAds(reference, { now: options.now });

  const matrix = buildMatrix({
    country,
    ads: observations,
    referenceAds: referenceIngested.observations,
    referenceMarkets: options.referenceCountry ? [options.referenceCountry] : [],
    now: options.now,
  });

  return { matrix, report };
}
