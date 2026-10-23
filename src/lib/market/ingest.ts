/**
 * Ingestion des observations publicitaires brutes → moteur de saturation.
 *
 * Le collecteur écrit des faits ; ce module les traduit en `AdObservation`
 * (classification du hook incluse), puis alimente `buildMatrix`.
 * Il est déterministe et testable sans réseau ni base.
 */
import { classifyHook } from "./classify.ts";
import type { AdObservation, Platform } from "./types.ts";

export interface RawAdRow {
  id: string;
  archetypeSlug: string;
  country: string;
  platform: Platform;
  advertiserId: string;
  advertiserName?: string | null;
  hook?: string | null;
  startDate: Date | string | null;
  endDate?: Date | string | null;
  isActive: boolean;
  url: string;
  collectedAt?: Date | string;
}

const DAY = 86_400_000;

function iso(value: Date | string | null | undefined, fallback: number): string {
  if (!value) return new Date(fallback).toISOString();
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return new Date(Number.isNaN(t) ? fallback : t).toISOString();
}

/**
 * Une annonce dont la date de début est inconnue ne peut pas prouver de
 * longévité. On la date à « maintenant » : elle comptera comme récente,
 * donc jamais comme « prouvée ». Jamais l'inverse.
 */
export function toAdObservation(row: RawAdRow, now = Date.now()): AdObservation {
  return {
    id: row.id,
    advertiserId: row.advertiserId,
    advertiserName: row.advertiserName ?? undefined,
    family: classifyHook(row.hook ?? undefined).family,
    platform: row.platform,
    country: row.country.toUpperCase(),
    startDate: iso(row.startDate, now),
    endDate: row.endDate ? iso(row.endDate, now) : undefined,
    isActive: row.isActive,
    url: row.url,
    hook: row.hook ?? undefined,
  };
}

export interface IngestReport {
  total: number;
  kept: number;
  dropped: number;
  reasons: Record<string, number>;
  unclassified: number;
}

/**
 * Prépare les lignes pour le moteur.
 *
 * Règles d'écartement — chacune protège une conclusion :
 *  - pas d'URL → intraçable, donc inutilisable comme preuve ;
 *  - pas d'annonceur → impossible de compter des annonceurs distincts ;
 *  - date de début dans le futur → incohérence de source.
 */
export function ingestAds(
  rows: readonly RawAdRow[],
  options: { now?: number } = {},
): { observations: AdObservation[]; report: IngestReport } {
  const now = options.now ?? Date.now();
  const reasons: Record<string, number> = {};
  const observations: AdObservation[] = [];

  const drop = (reason: string) => {
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  };

  for (const row of rows) {
    if (!row.url || !/^https?:\/\//.test(row.url)) {
      drop("sans_url");
      continue;
    }
    if (!row.advertiserId) {
      drop("sans_annonceur");
      continue;
    }
    if (row.startDate) {
      const t = row.startDate instanceof Date ? row.startDate.getTime() : Date.parse(row.startDate);
      if (!Number.isNaN(t) && t > now + DAY) {
        drop("date_future");
        continue;
      }
    }
    observations.push(toAdObservation(row, now));
  }

  const unclassified = observations.filter((o) => o.family === "non-classe").length;

  return {
    observations,
    report: {
      total: rows.length,
      kept: observations.length,
      dropped: rows.length - observations.length,
      reasons,
      unclassified,
    },
  };
}
