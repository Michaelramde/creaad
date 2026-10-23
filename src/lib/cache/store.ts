/**
 * Stockage du cache marché (Neon) — miroir de l'index unique
 * `(archetype_id, country, language)`.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { marketKits } from "@/lib/db/schema";
import type { Confidence } from "../market/types.ts";
import { describeLookup, expiryFor, isFresh, shouldCache } from "./policy.ts";

export interface CachedMarketKit {
  content: unknown;
  adsFound: number;
  confidence: Confidence;
  createdAt: Date;
  expiresAt: Date;
}

export type CacheResult =
  | { hit: true; kit: CachedMarketKit; remainingDays: number }
  | { hit: false; reason: "absent" | "expired" };

export async function getMarketKit(input: {
  archetypeId: string;
  country: string;
  language?: string;
  now?: number;
}): Promise<CacheResult> {
  const [row] = await db
    .select()
    .from(marketKits)
    .where(
      and(
        eq(marketKits.archetypeId, input.archetypeId),
        eq(marketKits.country, input.country),
        eq(marketKits.language, input.language ?? "fr"),
      ),
    )
    .limit(1);

  if (!row) return { hit: false, reason: "absent" };

  const lookup = describeLookup(row.expiresAt, row.createdAt, input.now ?? Date.now());
  if (!lookup.hit) return { hit: false, reason: "expired" };

  return {
    hit: true,
    kit: {
      content: row.content,
      adsFound: row.adsFound,
      confidence: row.confidence,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    },
    remainingDays: lookup.remainingDays ?? 0,
  };
}

/**
 * Écrit (ou rafraîchit) une entrée de cache.
 * Refus explicite si la confiance est `insufficient` : on ne grave pas
 * une absence de données.
 */
export async function putMarketKit(input: {
  archetypeId: string;
  country: string;
  language?: string;
  content: unknown;
  adsFound: number;
  confidence: Confidence;
  now?: number;
}): Promise<{ stored: boolean; reason?: string; expiresAt?: Date }> {
  if (!shouldCache(input.confidence)) {
    return { stored: false, reason: "confidence_insufficient" };
  }

  const now = input.now ?? Date.now();
  const expiry = expiryFor(input.confidence, now);
  if (!expiry || !isFresh(expiry, now)) {
    return { stored: false, reason: "invalid_ttl" };
  }

  const expiresAt = expiry;
  const language = input.language ?? "fr";

  await db
    .insert(marketKits)
    .values({
      archetypeId: input.archetypeId,
      country: input.country,
      language,
      content: input.content as object,
      adsFound: input.adsFound,
      confidence: input.confidence,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [marketKits.archetypeId, marketKits.country, marketKits.language],
      set: {
        content: input.content as object,
        adsFound: input.adsFound,
        confidence: input.confidence,
        createdAt: new Date(now),
        expiresAt,
      },
    });

  return { stored: true, expiresAt };
}

/** Invalidation manuelle (spec obsolète, changement de marché…). */
export async function invalidateMarketKit(input: {
  archetypeId: string;
  country: string;
  language?: string;
}): Promise<number> {
  const deleted = await db
    .delete(marketKits)
    .where(
      and(
        eq(marketKits.archetypeId, input.archetypeId),
        eq(marketKits.country, input.country),
        eq(marketKits.language, input.language ?? "fr"),
      ),
    )
    .returning({ id: marketKits.id });

  return deleted.length;
}
