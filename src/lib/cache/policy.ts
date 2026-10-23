/**
 * Politique de cache du kit argumentaire (SPEC §6.3).
 *
 * C'est le levier économique n°1 : R2 dépend de l'**archétype × pays**, pas
 * du produit précis. Cinquante commerçants qui analysent « sérum vitamine C
 * 30 ml » en Côte d'Ivoire ont besoin de la même recherche. On la fait une
 * fois, on la sert cinquante fois.
 */
import type { Confidence } from "../market/types.ts";

const DAY_MS = 86_400_000;

/**
 * Durée de vie selon la solidité de l'échantillon.
 * Un rapport `insufficient` n'est **jamais** mis en cache : le figer
 * reviendrait à graver une absence de données pour deux semaines.
 */
export const CACHE_TTL_DAYS: Record<Confidence, number> = {
  insufficient: 0,
  low: 14,
  medium: 21,
  high: 30,
};

export function ttlDays(confidence: Confidence): number {
  return CACHE_TTL_DAYS[confidence] ?? 0;
}

export function shouldCache(confidence: Confidence): boolean {
  return ttlDays(confidence) > 0;
}

export function expiryFor(confidence: Confidence, now = Date.now()): Date | null {
  const days = ttlDays(confidence);
  if (days <= 0) return null;
  return new Date(now + days * DAY_MS);
}

export function isFresh(expiresAt: Date | string, now = Date.now()): boolean {
  const t = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  if (Number.isNaN(t)) return false;
  return t > now;
}

/** Clé logique — miroir de l'index unique `(archetype_id, country, language)`. */
export function cacheKey(archetypeId: string, country: string, language = "fr"): string {
  return `${archetypeId}:${country.toUpperCase()}:${language}`;
}

export interface CacheLookup {
  hit: boolean;
  stale: boolean;
  ageDays?: number;
  remainingDays?: number;
}

export function describeLookup(expiresAt: Date | string, createdAt: Date | string, now = Date.now()): CacheLookup {
  const exp = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  const cre = createdAt instanceof Date ? createdAt.getTime() : Date.parse(createdAt);
  if (Number.isNaN(exp)) return { hit: false, stale: true };

  const fresh = exp > now;
  return {
    hit: fresh,
    stale: !fresh,
    ageDays: Number.isNaN(cre) ? undefined : Math.floor((now - cre) / DAY_MS),
    remainingDays: fresh ? Math.ceil((exp - now) / DAY_MS) : 0,
  };
}
