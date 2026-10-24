/**
 * Annonces Meta d'un produit, à la demande.
 *
 * Deux choix mesurés le 24/10 :
 *   · **phrase exacte** obligatoire — `keyword_unordered` sur « sac homme »
 *     ramène des pages religieuses et des séries audio ;
 *   · **plusieurs pays en une exécution** via `adLibraryUrls` — 3 pays en 15 s
 *     pour le prix d'un seul appel.
 */
import type { ApifyClient } from "./apify.ts";

interface RawMetaAd {
  ad_archive_id?: string;
  page_id?: string;
  page_name?: string;
  is_active?: boolean;
  start_date?: number;
  end_date?: number;
  currency?: string;
  snapshot?: {
    body?: { text?: string };
    title?: string;
    link_url?: string;
    images?: { original_image_url?: string; resized_image_url?: string }[];
    videos?: { video_preview_image_url?: string }[];
  };
}

export interface MetaAdHit {
  adId: string;
  pageId: string;
  advertiserName: string;
  hook: string | null;
  startDate: Date | null;
  endDate: Date | null;
  isActive: boolean;
  url: string;
  currency: string | null;
  /** Visuel de l'annonce — sert à vérifier qu'elle montre bien le produit. */
  imageUrl: string | null;
}

export interface MetaSearchOutcome {
  ads: MetaAdHit[];
  costUsd: number;
}

/** URL d'Ad Library pour un mot-clé et un pays — l'acteur en lit les filtres. */
export function adLibraryUrl(country: string, query: string, exact = true): string {
  const params = new URLSearchParams({
    active_status: "active",
    ad_type: "all",
    country,
    q: query,
    search_type: exact ? "keyword_exact_phrase" : "keyword_unordered",
  });
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

export class MetaAdsSearch {
  readonly name = "meta-ads";
  private readonly client: ApifyClient;
  private readonly actorId: string;

  constructor(client: ApifyClient, actorId: string) {
    this.client = client;
    this.actorId = actorId;
  }

  /**
   * Une exécution, plusieurs pays. `maxAds` s'applique au total : le premier
   * pays à répondre remplit le quota, d'où l'ordre du tableau.
   */
  async search(input: {
    query: string;
    countries: readonly string[];
    maxAds?: number;
    step: string;
    analysisId?: string;
  }): Promise<MetaSearchOutcome> {
    if (input.countries.length === 0) return { ads: [], costUsd: 0 };

    const run = await this.client.run<RawMetaAd>(
      this.actorId,
      {
        adLibraryUrls: input.countries.map((country) => adLibraryUrl(country, input.query)),
        maxAds: input.maxAds ?? 20,
      },
      { step: input.step, ...(input.analysisId ? { analysisId: input.analysisId } : {}) },
    );

    const ads: MetaAdHit[] = [];
    for (const item of run.items) {
      if (!item.ad_archive_id) continue;
      const hook = item.snapshot?.body?.text ?? item.snapshot?.title ?? null;

      // Le visuel : image de l'annonce, sinon vignette de la vidéo.
      const firstImage =
        item.snapshot?.images?.[0]?.original_image_url ??
        item.snapshot?.images?.[0]?.resized_image_url ??
        item.snapshot?.videos?.[0]?.video_preview_image_url ??
        null;

      ads.push({
        adId: String(item.ad_archive_id),
        pageId: String(item.page_id ?? ""),
        advertiserName: item.page_name ?? "",
        hook: hook ? hook.slice(0, 800) : null,
        startDate: typeof item.start_date === "number" ? new Date(item.start_date * 1000) : null,
        // Une annonce active porte une date de fin « sentinelle » : on ne la
        // stocke pas, sinon la durée de diffusion se figerait.
        endDate:
          item.is_active === true || typeof item.end_date !== "number"
            ? null
            : new Date(item.end_date * 1000),
        isActive: item.is_active === true,
        url: `https://www.facebook.com/ads/library/?id=${item.ad_archive_id}`,
        currency: item.currency ?? null,
        imageUrl: firstImage,
      });
    }

    return { ads, costUsd: run.costUsd };
  }
}
