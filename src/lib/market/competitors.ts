/**
 * Concurrents : regroupement **déterministe** des annonces par annonceur.
 *
 * Aucun modèle ici — c'est du comptage. Un annonceur qui publie huit annonces
 * reste un concurrent, pas huit.
 */
export interface AdForCompetitors {
  advertiserId: string;
  advertiserName: string | null;
  hook: string | null;
  startDate: Date | null;
  url: string;
  isActive: boolean;
}

export interface Competitor {
  name: string;
  platform: "meta";
  url: string;
  adsCount: number;
  longestRunDays: number;
  hooks: { hook: string; startDate: string | null; daysRunning: number; url: string }[];
}

const DAY = 86_400_000;

export function buildCompetitors(
  ads: readonly AdForCompetitors[],
  options: { now?: number; maxHooks?: number } = {},
): Competitor[] {
  const now = options.now ?? Date.now();
  const maxHooks = options.maxHooks ?? 3;

  const byAdvertiser = new Map<string, AdForCompetitors[]>();
  for (const ad of ads) {
    const key = ad.advertiserId || ad.advertiserName || ad.url;
    const list = byAdvertiser.get(key) ?? [];
    list.push(ad);
    byAdvertiser.set(key, list);
  }

  const competitors: Competitor[] = [];

  for (const [key, list] of byAdvertiser) {
    const dated = list
      .map((ad) => ({
        ad,
        days: ad.startDate ? Math.max(0, Math.round((now - ad.startDate.getTime()) / DAY)) : 0,
      }))
      .sort((a, b) => b.days - a.days);

    const longest = dated[0]?.days ?? 0;

    competitors.push({
      name: list[0]?.advertiserName?.trim() || key,
      platform: "meta",
      url: dated[0]?.ad.url ?? list[0]?.url ?? "",
      adsCount: list.length,
      longestRunDays: longest,
      hooks: dated
        .filter((entry) => entry.ad.hook)
        .slice(0, maxHooks)
        .map((entry) => ({
          hook: String(entry.ad.hook).slice(0, 300),
          startDate: entry.ad.startDate ? entry.ad.startDate.toISOString().slice(0, 10) : null,
          daysRunning: entry.days,
          url: entry.ad.url,
        })),
    });
  }

  // Le plus persévérant d'abord : c'est lui qui a le plus à apprendre.
  return competitors.sort((a, b) => b.longestRunDays - a.longestRunDays || b.adsCount - a.adsCount);
}
