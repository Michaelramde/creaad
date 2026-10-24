/**
 * Moteur de saturation (SPEC §10.2).
 *
 * Principe : **la longévité juge, pas la fréquence.** En publicité à la
 * performance, une annonce vivante depuis 60 jours a survécu à un test payé.
 * Une annonce vue trois fois cette semaine ne prouve rien.
 *
 * Corollaire : « absent » n'est jamais « opportunité ». Un angle que personne
 * n'utilise est peut-être un angle qui ne marche pas.
 */
import type {
  AdObservation,
  AngleFamily,
  AngleStats,
  AngleStatus,
  DataQuality,
  SaturationMatrix,
} from "./types.ts";
import { ANGLE_FAMILIES } from "./types.ts";

export const MIN_ADS_FOR_MATRIX = 15;
/** En dessous, une famille ne peut pas dépasser « observé non prouvé ». */
export const MIN_ADS_PER_FAMILY = 3;
export const PROVEN_MIN_ADVERTISERS = 3;
export const PROVEN_MIN_MEDIAN_DAYS = 45;
export const RISING_MIN_RATIO = 1.5;
export const DOMINANCE_THRESHOLD = 0.6;
export const VELOCITY_WINDOW_DAYS = 30;

const DAY = 86_400_000;

export function daysBetween(from: string, to: number): number {
  const start = new Date(from).getTime();
  if (Number.isNaN(start)) return 0;
  return Math.max(0, (to - start) / DAY);
}

/** Durée de diffusion : jusqu'à `endDate` si l'annonce est arrêtée. */
export function daysRunning(ad: AdObservation, now: number): number {
  const end = ad.endDate ? new Date(ad.endDate).getTime() : now;
  const start = new Date(ad.startDate).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, (end - start) / DAY);
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}

/**
 * Accélération : annonces apparues sur les 30 derniers jours, rapportées aux
 * 30 jours précédents. `Infinity` si la période précédente est vide.
 */
export function velocity(ads: readonly AdObservation[], now: number): number | null {
  const from = now - VELOCITY_WINDOW_DAYS * DAY;
  const before = now - 2 * VELOCITY_WINDOW_DAYS * DAY;

  let recent = 0;
  let previous = 0;
  for (const ad of ads) {
    const start = new Date(ad.startDate).getTime();
    if (Number.isNaN(start)) continue;
    if (start >= from && start <= now) recent += 1;
    else if (start >= before && start < from) previous += 1;
  }

  if (recent === 0 && previous === 0) return null;
  if (previous === 0) return Number.POSITIVE_INFINITY;
  return recent / previous;
}

function advertisersOf(ads: readonly AdObservation[]): string[] {
  return [...new Set(ads.map((a) => a.advertiserId))];
}

/** Statistiques brutes d'une famille, sans statut ni priorité. */
export function computeFamilyStats(
  family: AngleFamily,
  ads: readonly AdObservation[],
  now: number,
): Omit<AngleStats, "status" | "priority"> {
  const advertisers = advertisersOf(ads);
  const durations = ads.map((a) => daysRunning(a, now));

  const notes: string[] = [];
  if (ads.length > 0 && ads.length < MIN_ADS_PER_FAMILY) {
    notes.push(
      `Échantillon trop mince (${ads.length} annonce${ads.length > 1 ? "s" : ""}) : statut plafonné à « observé ».`,
    );
  }
  if (ads.length > 0 && advertisers.length === 1) {
    notes.push("Un seul annonceur observé : ce n'est pas un marché, c'est un acteur.");
  } else if (ads.length >= 5) {
    const counts = new Map<string, number>();
    for (const ad of ads) counts.set(ad.advertiserId, (counts.get(ad.advertiserId) ?? 0) + 1);
    const [topId, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] as [string, number];
    const share = topCount / ads.length;
    if (share >= DOMINANCE_THRESHOLD) {
      const name = ads.find((a) => a.advertiserId === topId)?.advertiserName ?? topId;
      notes.push(
        `Domination : ${name} concentre ${Math.round(share * 100)} % des annonces — ce n'est pas un marché saturé, c'est un acteur qui martèle.`,
      );
    }
  }

  return {
    family,
    ads: ads.length,
    advertisers,
    medianDaysRunning: Math.round(median(durations) * 10) / 10,
    velocity: velocity(ads, now),
    evidenceUrls: ads.slice(0, 5).map((a) => a.url),
    notes,
  };
}

export function isProven(stats: {
  advertisers: readonly string[];
  medianDaysRunning: number;
}): boolean {
  return (
    stats.advertisers.length >= PROVEN_MIN_ADVERTISERS &&
    stats.medianDaysRunning > PROVEN_MIN_MEDIAN_DAYS
  );
}

/**
 * Détermine le statut d'un angle.
 *
 * Ordre volontaire : un angle prouvé **ici** primes sur un angle prouvé
 * ailleurs — inutile d'« importer » ce qui est déjà installé.
 */
export function computeStatus(input: {
  local: { ads: number; advertisers: readonly string[]; medianDaysRunning: number; velocity: number | null };
  reference?: { advertisers: readonly string[]; medianDaysRunning: number };
}): AngleStatus {
  const { local, reference } = input;

  // Une famille à deux annonces peut sembler « en montée » par hasard :
  // le médian et la vélocité n'y veulent rien dire. On plafonne le statut.
  const enoughLocalEvidence = local.ads >= MIN_ADS_PER_FAMILY;

  if (enoughLocalEvidence && isProven(local)) return "proven_here";

  // L'import d'angle repose sur la preuve du marché de référence, pas sur
  // le nombre d'annonces locales — qui est justement censé être nul.
  const refProven = reference ? isProven(reference) : false;
  if (local.advertisers.length <= 1 && refProven) return "proven_elsewhere";

  const rising =
    enoughLocalEvidence &&
    local.velocity !== null &&
    local.velocity >= RISING_MIN_RATIO &&
    local.advertisers.length >= 2;
  if (rising) return "rising";

  if (local.ads === 0) return "unobserved";

  return "observed_unproven";
}

const PRIORITY: Record<AngleStatus, number> = {
  proven_elsewhere: 100,
  rising: 80,
  proven_here: 60,
  observed_unproven: 40,
  unobserved: 10,
};

export function assessQuality(ads: readonly AdObservation[], now: number): DataQuality {
  const gaps: string[] = [];
  const platforms = [...new Set(ads.map((a) => a.platform))];
  const distinctAdvertisers = advertisersOf(ads).length;

  const confidence: DataQuality["confidence"] =
    ads.length < MIN_ADS_FOR_MATRIX
      ? "insufficient"
      : ads.length < 30
        ? "low"
        : ads.length < 60
          ? "medium"
          : "high";

  if (!platforms.includes("meta")) gaps.push("Aucune annonce Meta collectée.");
  if (!platforms.includes("tiktok")) gaps.push("Aucune annonce TikTok collectée.");
  if (distinctAdvertisers < PROVEN_MIN_ADVERTISERS) {
    gaps.push(
      `Moins de ${PROVEN_MIN_ADVERTISERS} annonceurs distincts : aucun angle ne peut être déclaré prouvé.`,
    );
  }

  const oldest = ads.reduce((min, a) => {
    const t = new Date(a.startDate).getTime();
    return Number.isNaN(t) ? min : Math.min(min, t);
  }, now);
  if ((now - oldest) / DAY < VELOCITY_WINDOW_DAYS) {
    gaps.push("Fenêtre d'observation inférieure à 30 jours : les tendances ne sont pas lisibles.");
  }

  return { adsFound: ads.length, distinctAdvertisers, platforms, confidence, gaps };
}

export interface BuildMatrixInput {
  country: string;
  ads: readonly AdObservation[];
  referenceAds?: readonly AdObservation[];
  referenceMarkets?: string[];
  now?: number;
}

export function buildMatrix(input: BuildMatrixInput): SaturationMatrix {
  const now = input.now ?? Date.now();
  const quality = assessQuality(input.ads, now);
  const publishable = quality.confidence !== "insufficient";

  const angles: AngleStats[] = ANGLE_FAMILIES.filter((f) => f !== "non-classe").map((family) => {
    const localAds = input.ads.filter((a) => a.family === family && a.country === input.country);
    const refAds = (input.referenceAds ?? []).filter((a) => a.family === family);

    const local = computeFamilyStats(family, localAds, now);
    const reference =
      refAds.length > 0 ? computeFamilyStats(family, refAds, now) : undefined;

    const status = computeStatus({ local, reference });
    const evidenceUrls = [...local.evidenceUrls, ...(reference?.evidenceUrls ?? [])];

    return {
      ...local,
      status,
      evidenceUrls,
      ...(reference
        ? {
            reference: {
              advertisers: reference.advertisers,
              medianDaysRunning: reference.medianDaysRunning,
            },
          }
        : {}),
      priority: PRIORITY[status] + Math.min(10, evidenceUrls.length),
    };
  });

  return {
    country: input.country,
    referenceMarkets: input.referenceMarkets ?? [],
    dataQuality: quality,
    angles: angles.sort((a, b) => b.priority - a.priority),
    publishable,
  };
}
