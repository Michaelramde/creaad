/**
 * Fiche produit complète : galerie, variantes, spécifications, vendeur.
 *
 * C'est l'appel le plus cher du pipeline (0,05 $). Il n'est fait qu'une fois
 * par produit : `product_records` le rend gratuit pendant 30 jours.
 */
import type { ApifyClient } from "./apify.ts";
import {
  buildImagePool,
  extractDescriptionImages,
  normalizeGallery,
  normalizeReviews,
  normalizeSpecs,
  normalizeVariants,
  reviewImages,
} from "../products/normalize.ts";
import { getFreshRecord, upsertRecord } from "../products/records.ts";
import type { PoolImage, ProductRecord } from "../products/types.ts";

/**
 * Télécharge la description A+ et en extrait les images.
 *
 * Gratuit, mais faillible : une description indisponible ne doit jamais faire
 * échouer la fiche — on repart simplement avec les 6 images de galerie.
 */
async function fetchDescriptionImages(url: string): Promise<PoolImage[]> {
  // Deux tentatives : une description perdue, ce sont 20 images en moins.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "Accept-Language": "fr-FR,fr;q=0.9",
        },
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });

      if (!res.ok) {
        console.warn(`[product-detail] description HTTP ${res.status} (essai ${attempt + 1})`);
        continue;
      }

      const html = await res.text();
      const images = extractDescriptionImages(html);
      if (images.length === 0) {
        console.warn(`[product-detail] description sans image (${html.length} octets)`);
        continue;
      }
      return images;
    } catch (error) {
      console.warn(`[product-detail] description échouée : ${(error as Error).message}`);
    }
  }

  return [];
}

interface RawReview {
  reviewId?: string;
  rating?: number;
  text?: string;
  textOriginal?: string;
  date?: string;
  buyerCountry?: string;
  images?: string[];
  wouldBuyAgain?: boolean;
  daysAfterPurchase?: number;
  skuInfo?: string;
}

interface RawDetail {
  productId?: string;
  detailTitle?: string;
  title?: string;
  url?: string;
  price?: number;
  currency?: string;
  detailCurrency?: string;
  detailRating?: number;
  rating?: number;
  reviewCount?: number;
  gallery?: unknown;
  variantOptions?: unknown;
  variants?: unknown;
  specifications?: unknown;
  seller?: Record<string, unknown>;
  descriptionUrl?: string;
  reviews?: RawReview[];
}

export interface DetailOutcome {
  record: ProductRecord;
  cached: boolean;
  costUsd: number;
}

export class ApifyProductDetail {
  readonly name = "apify-product-detail";
  private readonly client: ApifyClient;
  private readonly actorId: string;

  constructor(client: ApifyClient, actorId: string) {
    this.client = client;
    this.actorId = actorId;
  }

  async fetch(
    input: { productId: string; url: string },
    options: { analysisId?: string } = {},
  ): Promise<DetailOutcome> {
    const cached = await getFreshRecord("aliexpress", input.productId);
    if (cached) return { record: cached, cached: true, costUsd: 0 };

    const run = await this.client.run<RawDetail>(
      this.actorId,
      // Les avis viennent du même appel : désirs et objections sans surcoût
      // de collecte. `maxReviews` borne la dépense (≈0,0015 $/avis).
      { startUrls: [{ url: input.url }], includeReviews: true, maxReviews: 30 },
      { step: "product-detail", ...(options.analysisId ? { analysisId: options.analysisId } : {}) },
    );

    const raw = run.items[0];
    if (!raw) throw new Error("Fiche produit vide — produit indisponible chez le fournisseur");

    const gallery = normalizeGallery(raw.gallery);
    const { axes, variants } = normalizeVariants(raw.variantOptions, raw.variants);

    const reviews = normalizeReviews(raw.reviews);

    /**
     * La description A+ contient bien plus d'images que la galerie : c'est là
     * que se trouvent les détails, les tableaux de mesures et l'usage réel.
     * Récupération gratuite, en HTTP simple.
     */
    const descriptionImages = raw.descriptionUrl
      ? await fetchDescriptionImages(raw.descriptionUrl)
      : [];

    console.log(
      `[product-detail] descriptionUrl=${raw.descriptionUrl ? "oui" : "non"} · images description=${descriptionImages.length}`,
    );

    const variantImages = axes.flatMap((axis) =>
      axis.values.map((value) => value.image).filter((url): url is string => Boolean(url)),
    );

    const record: ProductRecord = {
      provider: "aliexpress",
      productId: input.productId,
      title: (raw.detailTitle ?? raw.title ?? "").trim() || `Produit ${input.productId}`,
      url: raw.url ?? input.url,
      ...(typeof raw.price === "number" ? { price: raw.price } : {}),
      ...(raw.detailCurrency ?? raw.currency
        ? { currency: (raw.detailCurrency ?? raw.currency) as string }
        : {}),
      ...(typeof (raw.detailRating ?? raw.rating) === "number"
        ? { rating: (raw.detailRating ?? raw.rating) as number }
        : {}),
      gallery,
      variantAxes: axes,
      variants,
      specs: normalizeSpecs(raw.specifications),
      facts: {},
      images: buildImagePool({
        gallery: [...gallery, ...descriptionImages],
        variantImages,
        reviewImages: reviewImages(reviews),
      }),
      ...(raw.descriptionUrl ? { descriptionUrl: raw.descriptionUrl } : {}),
      reviews,
      ...(raw.seller ? { seller: raw.seller } : {}),
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };

    await upsertRecord(record);

    return { record, cached: false, costUsd: run.costUsd };
  }
}
