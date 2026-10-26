/**
 * Stockage des observations publicitaires et alimentation du moteur.
 */
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { adObservations, archetypes } from "@/lib/db/schema";

import type { CreativeWriter } from "../pipeline/creative.ts";
import { labelsForHooks } from "./classify-llm.ts";
import { ingestAds, type IngestReport, type RawAdRow } from "./ingest.ts";
import { MARKET } from "./saturation.ts";
import { referenceCountriesFor } from "./zones.ts";
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
  options: {
    now?: number;
    labels?: ReadonlyMap<string, import("./types.ts").AngleFamily>;
    writer?: CreativeWriter;
  } = {},
): Promise<MatrixBuild | null> {
  const ads = await loadAdsByProduct(productRef);
  if (ads.length === 0) return null;

  const hooks = ads.map((row) => row.hook ?? "").filter((hook) => hook.length > 0);
  const labels =
    options.labels ?? (options.writer ? await labelsForHooks(options.writer, hooks) : undefined);
  const { observations, report } = ingestAds(ads, { now: options.now, ...(labels ? { labels } : {}) });
  const matrix = buildMatrix({
    country,
    ads: observations,
    referenceAds: [],
    referenceMarkets: [],
    now: options.now,
    // Un produit précis a peu d'annonces par nature : 3 suffisent à dire
    // qui le vend (c'est aussi le seuil de l'escalade), là où un archétype
    // en exige 15.
    minAds: MARKET.minAdsProduct,
  });

  return { matrix, report };
}

/**
 * Construit la matrice de saturation pour un archétype et un pays,
 * à partir des seules observations stockées.
 */
export async function buildMatrixFor(
  archetypeSlug: string,
  country: string,
  options: {
    /**
     * Pays de référence. Par défaut : les voisins du pays cible.
     *
     * Sans eux, `proven_elsewhere` était **mathématiquement impossible** :
     * le portefeuille ne pouvait jamais dire « cet angle est durable
     * ailleurs, il est absent ici ». C'était la fonctionnalité différenciante
     * du kit, affichée dans la démonstration publique, et inatteignable.
     */
    referenceCountries?: readonly string[];
    now?: number;
    /** Étiquettes déjà résolues — sinon le modèle (ou son cache) les produit. */
    labels?: ReadonlyMap<string, import("./types.ts").AngleFamily>;
    /** Rédacteur utilisé pour étiqueter les hooks (coût : 1 appel / 20 inédits). */
    writer?: CreativeWriter;
  } = {},
): Promise<MatrixBuild> {
  const ads = await loadAds(archetypeSlug, country);
  const targets = (options.referenceCountries ?? referenceCountriesFor(country))
    .map((code) => code.toUpperCase())
    .filter((code) => code !== country.toUpperCase());

  const referenceRows: RawAdRow[] = [];
  for (const code of targets) {
    referenceRows.push(...(await loadAds(archetypeSlug, code)));
  }

  /**
   * Les étiquettes sont résolues AVANT l'ingestion : `ingestAds` reste pur et
   * synchrone, donc testable hors ligne. Le cache rend l'opération gratuite
   * dès la deuxième analyse d'un même marché.
   */
  const allHooks = [...ads, ...referenceRows]
    .map((row) => row.hook ?? "")
    .filter((hook) => hook.length > 0);
  const labels =
    options.labels ?? (options.writer ? await labelsForHooks(options.writer, allHooks) : undefined);

  const { observations, report } = ingestAds(ads, { now: options.now, ...(labels ? { labels } : {}) });
  const referenceIngested = ingestAds(referenceRows, { now: options.now, ...(labels ? { labels } : {}) });

  const matrix = buildMatrix({
    country,
    ads: observations,
    referenceAds: referenceIngested.observations,
    referenceMarkets: targets,
    now: options.now,
  });

  return { matrix, report };
}
