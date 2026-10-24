/**
 * Stockage des observations publicitaires et alimentation du moteur.
 */
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { adObservations, archetypes } from "@/lib/db/schema";

import { ingestAds, type IngestReport, type RawAdRow } from "./ingest.ts";
import { buildMatrix } from "./saturation.ts";
import type { SaturationMatrix } from "./types.ts";

export interface SaveResult {
  inserted: number;
  updated: number;
}

/** Crée l'archétype s'il n'existe pas, et renvoie son identifiant. */
export async function ensureArchetype(input: {
  slug: string;
  label: string;
  category: "beaute" | "cheveux" | "mode" | "gadgets";
}): Promise<string> {
  const [existing] = await db
    .select({ id: archetypes.id })
    .from(archetypes)
    .where(eq(archetypes.slug, input.slug))
    .limit(1);

  if (existing) return existing.id;

  const [created] = await db
    .insert(archetypes)
    .values({ slug: input.slug, label: input.label, category: input.category })
    .onConflictDoNothing()
    .returning({ id: archetypes.id });

  if (created) return created.id;

  const [again] = await db
    .select({ id: archetypes.id })
    .from(archetypes)
    .where(eq(archetypes.slug, input.slug))
    .limit(1);

  if (!again) throw new Error(`Archétype introuvable : ${input.slug}`);
  return again.id;
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
 * Annonces rattachées à un **produit précis**, tous pays confondus.
 *
 * C'est la matière du marché produit : les annonces des vendeurs de ce
 * modèle, qu'on ait dû élargir au pays, à la zone ou au monde pour les trouver.
 */
export async function loadAdsByProduct(productRef: string): Promise<RawAdRow[]> {
  const rows = await db
    .select()
    .from(adObservations)
    .where(eq(adObservations.productRef, productRef))
    .limit(500);

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

/**
 * Matrice de saturation d'un produit. Aucun cache à gérer : les annonces sont
 * déjà en base, le calcul est pur et instantané.
 */
export async function buildMatrixForProduct(
  productRef: string,
  country: string,
  options: { now?: number } = {},
): Promise<MatrixBuild | null> {
  const ads = await loadAdsByProduct(productRef);
  if (ads.length === 0) return null;

  const { observations, report } = ingestAds(ads, { now: options.now });
  const matrix = buildMatrix({
    country,
    ads: observations,
    referenceAds: [],
    referenceMarkets: [],
    now: options.now,
  });

  return { matrix, report };
}

/**
 * Construit la matrice de saturation pour un archétype et un pays,
 * à partir des seules observations stockées.
 */
export async function buildMatrixFor(  archetypeSlug: string,
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
