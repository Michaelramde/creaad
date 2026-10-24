/**
 * Trouver les annonces **du produit**, en élargissant jusqu'à en trouver.
 *
 * Trois paliers, puis le marché de l'archétype en repli :
 *   1. pays choisi    2. groupe régional (un seul appel, plusieurs pays)   3. monde
 *
 * On s'arrête au premier palier qui donne au moins `MIN_ADS` annonces. Le
 * résultat est mémorisé — y compris quand il est vide, sinon un produit sans
 * annonce serait re-recherché à chaque analyse.
 */
import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";

import { db } from "../db/index.ts";
import { adObservations, metaQueries } from "../db/schema.ts";
import type { MetaAdHit, MetaAdsSearch } from "../providers/meta-ads.ts";

/** En dessous, on considère le palier vide : trois annonces font un marché. */
export const MIN_ADS = 3;

/** Durées de cache : une absence d'annonce peut se démentir plus vite. */
const TTL_POSITIVE_DAYS = 30;
const TTL_NEGATIVE_DAYS = 7;

/** Zones : le pays choisi en tête, puis les marchés les plus proches. */
export const ZONES: Record<string, string[]> = {
  CI: ["CI", "SN", "BF", "ML", "TG", "BJ", "CM"],
  SN: ["SN", "CI", "ML", "GN", "BJ", "TG", "BF"],
  CM: ["CM", "CI", "GA", "CG", "TD", "SN", "BJ"],
  BJ: ["BJ", "TG", "CI", "SN", "BF", "ML", "NE"],
  TG: ["TG", "BJ", "CI", "SN", "BF", "ML", "GH"],
  ML: ["ML", "CI", "SN", "BF", "GN", "NE", "BJ"],
  BF: ["BF", "CI", "ML", "SN", "TG", "BJ", "NE"],
};

/** Devise → marché lisible. Seule attribution géographique disponible. */
const CURRENCY_MARKET: Record<string, string> = {
  XOF: "zone CFA",
  XAF: "zone CFA (CEMAC)",
  GHS: "Ghana",
  NGN: "Nigeria",
  EGP: "Égypte",
  MAD: "Maroc",
  DZD: "Algérie",
  TND: "Tunisie",
  KES: "Kenya",
  ZAR: "Afrique du Sud",
  AED: "Émirats",
  SAR: "Arabie saoudite",
  USD: "international",
  EUR: "Europe",
};

export type MarketScope = "pays" | "zone" | "monde" | "archetype";

export interface ProductMarketResult {
  scope: MarketScope;
  ads: number;
  /** Marchés devinés depuis la devise des annonces. */
  markets: string[];
  countries: string[];
  costUsd: number;
  cached: boolean;
  message: string;
}

export interface ProductQuery {
  productRef: string;
  archetypeSlug: string;
  country: string;
  brand?: string;
  model?: string;
  category: string;
}

function zoneOf(country: string): string[] {
  const zone = ZONES[country.toUpperCase()];
  // Pays inconnu de la table : on élargit d'emblée au monde.
  return zone ?? [country.toUpperCase()];
}

/** Requête : marque + modèle si on les a, sinon la marque seule. */
export function buildQuery(input: ProductQuery): string {
  const brand = input.brand?.trim();
  const model = input.model?.trim();
  if (brand && model) {
    // « jeep buluo » + « jeep 597 » ne doit pas donner « jeep buluo jeep 597 » :
    // les annonceurs écrivent rarement la marque deux fois.
    const firstBrandWord = brand.toLowerCase().split(/\s+/)[0] ?? "";
    return firstBrandWord && model.toLowerCase().includes(firstBrandWord) ? model : `${brand} ${model}`;
  }
  if (brand) return brand;
  if (model) return model;
  return input.category;
}

function hashQuery(query: string, scope: MarketScope): string {
  return createHash("sha1").update(`${query}|${scope}`).digest("hex").slice(0, 32);
}

async function cachedQuery(
  hash: string,
): Promise<{ adsFound: number; costUsd: number } | null> {
  const [row] = await db
    .select()
    .from(metaQueries)
    .where(and(eq(metaQueries.hash, hash), gt(metaQueries.expiresAt, new Date())))
    .limit(1);

  return row ? { adsFound: row.adsFound, costUsd: Number(row.costUsd) } : null;
}

async function rememberQuery(
  hash: string,
  query: string,
  scope: MarketScope,
  countries: readonly string[],
  adsFound: number,
  costUsd: number,
): Promise<void> {
  const days = adsFound >= MIN_ADS ? TTL_POSITIVE_DAYS : TTL_NEGATIVE_DAYS;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  await db
    .insert(metaQueries)
    .values({ hash, query, scope, countries: [...countries], adsFound, costUsd: costUsd.toFixed(6), expiresAt })
    .onConflictDoUpdate({
      target: metaQueries.hash,
      set: { adsFound, costUsd: costUsd.toFixed(6), expiresAt, createdAt: new Date() },
    });
}

/** Écrit les annonces trouvées : elles valent pour le produit **et** l'archétype. */
async function saveAds(
  ads: readonly MetaAdHit[],
  input: ProductQuery,
  country: string,
): Promise<number> {
  if (ads.length === 0) return 0;

  await db
    .insert(adObservations)
    .values(
      ads.map((ad) => ({
        archetypeSlug: input.archetypeSlug,
        country: country.toUpperCase(),
        platform: "meta" as const,
        advertiserId: ad.pageId || ad.adId,
        advertiserName: ad.advertiserName,
        hook: ad.hook,
        startDate: ad.startDate,
        endDate: ad.endDate,
        isActive: ad.isActive,
        productRef: input.productRef,
        adCurrency: ad.currency,
        url: ad.url,
        source: "product-search",
      })),
    )
    .onConflictDoNothing();

  return ads.length;
}

function describe(ads: readonly MetaAdHit[]): string[] {
  const markets = new Set<string>();
  for (const ad of ads) {
    const label = ad.currency ? CURRENCY_MARKET[ad.currency] : undefined;
    if (label) markets.add(label);
  }
  return [...markets];
}

/**
 * Déroule l'échelle. `meta` peut être absent (aucun jeton) : on retourne
 * alors directement le repli archétype, sans rien dépenser.
 *
 * L'ordre est mesuré, pas intuitif : « jeep 597 » ne donne rien — c'est une
 * référence interne que les annonceurs n'écrivent jamais. La **marque** est
 * le signal qui fonctionne, et elle est essayée dès le deuxième palier.
 */
export async function findProductAds(
  input: ProductQuery,
  meta: MetaAdsSearch | undefined,
  options: { analysisId?: string; maxAds?: number } = {},
): Promise<ProductMarketResult> {
  const country = input.country.toUpperCase();
  const exact = buildQuery(input);
  const brand = input.brand?.trim() || exact;
  const zone = zoneOf(country);

  const fallback: ProductMarketResult = {
    scope: "archetype",
    ads: 0,
    markets: [],
    countries: [country],
    costUsd: 0,
    cached: false,
    message: "Aucune annonce connue de ce produit — angles du marché de son type.",
  };

  if (!meta) return fallback;

  const steps: { query: string; scope: MarketScope; countries: string[]; store: string }[] = [
    { query: exact, scope: "pays", countries: [country], store: country },
    // Même pays, requête élargie : c'est ici que ça passe le plus souvent.
    ...(brand !== exact
      ? [{ query: brand, scope: "pays" as MarketScope, countries: [country], store: country }]
      : []),
    { query: brand, scope: "zone", countries: zone, store: country },
    { query: brand, scope: "monde", countries: ["ALL"], store: "ALL" },
  ];

  let costUsd = 0;

  for (const step of steps) {
    const hash = hashQuery(step.query, step.scope);
    const hit = await cachedQuery(hash);

    let adsFound: number;
    let sample: MetaAdHit[] = [];

    if (hit) {
      adsFound = hit.adsFound;
    } else {
      try {
        const outcome = await meta.search({
          query: step.query,
          countries: step.countries,
          maxAds: options.maxAds ?? 20,
          step: `ads-${step.scope}`,
          ...(options.analysisId ? { analysisId: options.analysisId } : {}),
        });
        costUsd += outcome.costUsd;
        sample = outcome.ads;

        if (sample.length > 0) await saveAds(sample, input, step.store);
        adsFound = sample.length;
        await rememberQuery(hash, step.query, step.scope, step.countries, adsFound, outcome.costUsd);
      } catch (error) {
        console.warn(`[product-market] palier ${step.scope} échoué`, error);
        continue;
      }
    }

    if (adsFound >= MIN_ADS) {
      const exactMatch = step.query === exact;
      return {
        scope: step.scope,
        ads: adsFound,
        markets: describe(sample),
        countries: step.countries,
        costUsd,
        cached: Boolean(hit),
        message:
          step.scope === "pays"
            ? exactMatch
              ? `${adsFound} annonces de ce produit en ${country}.`
              : `${adsFound} annonces de cette marque en ${country}.`
            : step.scope === "zone"
              ? `Aucune annonce en ${country} — marché élargi à la zone (${step.countries.join(", ")}).`
              : `Aucune annonce localement — marché mondial.`,
      };
    }
  }

  return { ...fallback, costUsd };
}
