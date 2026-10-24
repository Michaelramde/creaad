/**
 * Cache d'identité produit.
 *
 * Une fiche coûte 0,05 $ : la payer une fois par produit et non une fois par
 * analyse est ce qui rend le modèle économique tenable. Deux niveaux :
 *   · `product_records` — la fiche, 30 jours ;
 *   · `image_queries`   — l'empreinte de la photo, 7 jours.
 */
import { and, eq, gt, lt } from "drizzle-orm";

import { db } from "../db/index.ts";
import { imageQueries, productRecords } from "../db/schema.ts";
import type { ProductRecord } from "./types.ts";

export const RECORD_TTL_DAYS = 30;
/** Une recherche par image coûte 0,02 $ : 7 jours de cache sur la même photo. */
export const IMAGE_QUERY_TTL_DAYS = 7;

const days = (n: number) => n * 24 * 60 * 60 * 1000;

export async function getFreshRecord(
  provider: string,
  productId: string,
): Promise<ProductRecord | null> {
  const [row] = await db
    .select()
    .from(productRecords)
    .where(
      and(
        eq(productRecords.provider, provider),
        eq(productRecords.productId, productId),
        gt(productRecords.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!row) return null;

  return {
    provider: row.provider,
    productId: row.productId,
    title: row.title,
    url: row.url,
    ...(row.price !== null ? { price: Number(row.price) } : {}),
    ...(row.currency !== null ? { currency: row.currency } : {}),
    ...(row.rating !== null ? { rating: Number(row.rating) } : {}),
    ...(row.sold !== null ? { sold: row.sold } : {}),
    gallery: row.gallery,
    variantAxes: row.variantAxes,
    variants: row.variants,
    specs: row.specs,
    facts: row.facts,
    images: row.images,
    ...(row.descriptionUrl ? { descriptionUrl: row.descriptionUrl } : {}),
    reviews: row.reviews,
    ...(row.seller ? { seller: row.seller as Record<string, unknown> } : {}),
    ...(row.archetypeSlug ? { archetypeSlug: row.archetypeSlug } : {}),
    ...(row.archetypeSource
      ? { archetypeSource: row.archetypeSource as "lexique" | "routeur" | "aucun" }
      : {}),
    fetchedAt: row.fetchedAt,
    expiresAt: row.expiresAt,
  };
}

export async function upsertRecord(record: ProductRecord): Promise<void> {
  const expiresAt = new Date(Date.now() + days(RECORD_TTL_DAYS));

  await db
    .insert(productRecords)
    .values({
      provider: record.provider,
      productId: record.productId,
      title: record.title,
      url: record.url,
      price: record.price !== undefined ? String(record.price) : null,
      currency: record.currency ?? null,
      rating: record.rating !== undefined ? String(record.rating) : null,
      sold: record.sold ?? null,
      gallery: record.gallery,
      variantAxes: record.variantAxes,
      variants: record.variants,
      specs: record.specs,
      facts: record.facts,
      images: record.images,
      seller: record.seller ?? null,
      descriptionUrl: record.descriptionUrl ?? null,
      reviews: record.reviews,
      archetypeSlug: record.archetypeSlug ?? null,
      archetypeSource: record.archetypeSource ?? null,
      expiresAt,
      fetchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [productRecords.provider, productRecords.productId],
      set: {
        title: record.title,
        url: record.url,
        gallery: record.gallery,
        variantAxes: record.variantAxes,
        variants: record.variants,
        specs: record.specs,
        facts: record.facts,
        images: record.images,
        seller: record.seller ?? null,
        descriptionUrl: record.descriptionUrl ?? null,
        reviews: record.reviews,
        archetypeSlug: record.archetypeSlug ?? null,
        archetypeSource: record.archetypeSource ?? null,
        expiresAt,
        fetchedAt: new Date(),
      },
    });
}

/** Résultat de recherche par image mis en cache sur l'empreinte de la photo. */
export async function getCachedImageQuery<T>(hash: string): Promise<T | null> {
  const [row] = await db
    .select()
    .from(imageQueries)
    .where(and(eq(imageQueries.hash, hash), gt(imageQueries.expiresAt, new Date())))
    .limit(1);

  return row ? (row.payload as T) : null;
}

export async function putCachedImageQuery(hash: string, payload: unknown): Promise<void> {
  const expiresAt = new Date(Date.now() + days(IMAGE_QUERY_TTL_DAYS));

  await db
    .insert(imageQueries)
    .values({ hash, payload: payload as object, expiresAt })
    .onConflictDoUpdate({
      target: imageQueries.hash,
      set: { payload: payload as object, expiresAt, createdAt: new Date() },
    });
}

/** Purge — appelée par le cron pour éviter que les tables ne gonflent. */
export async function purgeExpired(): Promise<{ records: number; queries: number }> {
  const now = new Date();
  const records = await db.delete(productRecords).where(lt(productRecords.expiresAt, now)).returning({
    id: productRecords.id,
  });
  const queries = await db.delete(imageQueries).where(lt(imageQueries.expiresAt, now)).returning({
    hash: imageQueries.hash,
  });

  return { records: records.length, queries: queries.length };
}
