/**
 * Trouver le produit à partir d'une photo.
 *
 * Contrairement aux sources textuelles, celle-ci part de l'image : c'est le
 * seul moyen d'identifier un article que le commerçant ne sait pas nommer.
 * Mesuré : 60 résultats en 6 s, le bon produit au rang 1 avec `isBestMatch`.
 */
import { createHash } from "node:crypto";

import { checkBudget } from "../costs.ts";
import { getCachedImageQuery, putCachedImageQuery } from "../products/records.ts";
import type { ApifyClient } from "./apify.ts";

export interface ImageSearchHit {
  productId: string;
  title: string;
  url: string;
  image?: string;
  price?: number;
  currency?: string;
  rating?: number;
  sold?: number;
  rank: number;
  isBestMatch: boolean;
}

interface RawHit {
  productId?: string;
  title?: string;
  url?: string;
  image?: string;
  price?: number;
  currency?: string;
  rating?: number;
  sold?: number;
  rank?: number;
  isBestMatch?: boolean;
}

export interface ImageSearchOutcome {
  hits: ImageSearchHit[];
  /** Vrai quand le résultat vient du cache : aucun coût. */
  cached: boolean;
  costUsd: number;
  warning?: string;
}

/** Empreinte stable d'une photo, pour ne pas repayer la même recherche. */
export function imageHash(imageUrl: string): string {
  return createHash("sha256").update(imageUrl).digest("hex").slice(0, 40);
}

export class ApifyImageSearch {
  readonly name = "apify-image-search";
  private readonly client: ApifyClient;
  private readonly actorId: string;

  constructor(client: ApifyClient, actorId: string) {
    this.client = client;
    this.actorId = actorId;
  }

  async search(
    imageUrl: string,
    options: { analysisId?: string; maxItems?: number } = {},
  ): Promise<ImageSearchOutcome> {
    const hash = imageHash(imageUrl);

    const cached = await getCachedImageQuery<ImageSearchHit[]>(hash);
    if (cached) return { hits: cached, cached: true, costUsd: 0 };

    const budget = await checkBudget();
    if (!budget.allowed) {
      return {
        hits: [],
        cached: false,
        costUsd: 0,
        warning: `Plafond Apify atteint (${budget.spentUsd.toFixed(2)} $ / ${budget.capUsd} $ sur 24 h). Recherche payante ignorée.`,
      };
    }

    const run = await this.client.run<RawHit>(
      this.actorId,
      { imageUrls: [imageUrl], maxItems: options.maxItems ?? 60 },
      { step: "image-search", ...(options.analysisId ? { analysisId: options.analysisId } : {}) },
    );

    const hits: ImageSearchHit[] = [];
    for (const item of run.items) {
      if (!item.productId || !item.title || !item.url) continue;
      hits.push({
        productId: String(item.productId),
        title: item.title,
        url: item.url,
        ...(item.image ? { image: item.image } : {}),
        ...(typeof item.price === "number" ? { price: item.price } : {}),
        ...(item.currency ? { currency: item.currency } : {}),
        ...(typeof item.rating === "number" ? { rating: item.rating } : {}),
        ...(typeof item.sold === "number" ? { sold: item.sold } : {}),
        rank: item.rank ?? hits.length + 1,
        isBestMatch: item.isBestMatch === true,
      });
    }

    hits.sort((a, b) => a.rank - b.rank);

    if (hits.length > 0) await putCachedImageQuery(hash, hits);

    return { hits, cached: false, costUsd: run.costUsd };
  }
}
