/**
 * Fiche produit complète : galerie, variantes, spécifications, vendeur.
 *
 * C'est l'appel le plus cher du pipeline (0,05 $). Il n'est fait qu'une fois
 * par produit : `product_records` le rend gratuit pendant 30 jours.
 */
import type { ApifyClient } from "./apify.ts";
import {
  buildImagePool,
  normalizeGallery,
  normalizeSpecs,
  normalizeVariants,
} from "../products/normalize.ts";
import { getFreshRecord, upsertRecord } from "../products/records.ts";
import type { ProductRecord } from "../products/types.ts";

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
      { startUrls: [{ url: input.url }] },
      { step: "product-detail", ...(options.analysisId ? { analysisId: options.analysisId } : {}) },
    );

    const raw = run.items[0];
    if (!raw) throw new Error("Fiche produit vide — produit indisponible chez le fournisseur");

    const gallery = normalizeGallery(raw.gallery);
    const { axes, variants } = normalizeVariants(raw.variantOptions, raw.variants);

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
      images: buildImagePool({ gallery, variantImages }),
      ...(raw.seller ? { seller: raw.seller } : {}),
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };

    await upsertRecord(record);

    return { record, cached: false, costUsd: run.costUsd };
  }
}
