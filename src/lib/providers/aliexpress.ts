/**
 * Adaptateur AliExpress — API affiliée officielle, **gratuite**.
 *
 * Constaté : `https://api-sg.aliexpress.com/sync` répond
 * `MissingParameter app_key` — l'endpoint est vivant, il ne manque qu'une
 * inscription (gratuite) sur l'Open Platform pour obtenir clé et secret.
 *
 * Le prix de vente et les images multi-angles proviennent de l'annonce
 * fournisseur, ce qui nourrit directement la planche (SPEC §9).
 */
import { createHash } from "node:crypto";

import type { Archetype } from "../archetype/extract.ts";
import type { ListingCandidate } from "../matching/types.ts";
import type { SourceAdapter } from "./types.ts";

const ENDPOINT = "https://api-sg.aliexpress.com/sync";
const METHOD = "aliexpress.affiliate.product.query";

/**
 * Signature officielle : MD5(secret + concat(k+v triés par k) + secret),
 * en majuscules. C'est le schéma documenté par l'Open Platform.
 */
export function aliexpressSign(params: Record<string, string>, secret: string): string {
  const base = Object.keys(params)
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join("");
  return createHash("md5").update(`${secret}${base}${secret}`).digest("hex").toUpperCase();
}

interface AliexpressProduct {
  product_id?: number | string;
  product_title?: string;
  product_detail_url?: string;
  product_main_image_url?: string;
  product_small_image_urls?: { string?: string[] } | string[];
  first_level_category_name?: string;
  target_sale_price?: string;
  target_original_price?: string;
  evaluate_rate?: string;
}

export class AliExpressAdapter implements SourceAdapter {
  readonly name = "aliexpress";
  private readonly appKey: string;
  private readonly appSecret: string;
  private readonly trackingId: string;

  constructor(appKey: string, appSecret: string, trackingId: string) {
    this.appKey = appKey;
    this.appSecret = appSecret;
    this.trackingId = trackingId;
  }

  available(): boolean {
    return Boolean(this.appKey && this.appSecret);
  }

  async search(input: { archetype: Archetype; country: string; limit?: number }): Promise<ListingCandidate[]> {
    const limit = String(input.limit ?? 5);

    const params: Record<string, string> = {
      app_key: this.appKey,
      method: METHOD,
      format: "json",
      v: "2.0",
      sign_method: "md5",
      timestamp: String(Date.now()),
      keywords: input.archetype.label,
      page_no: "1",
      page_size: limit,
      target_currency: "XOF",
      target_language: "FR",
      ship_to_country: input.country.toUpperCase(),
      tracking_id: this.trackingId,
    };
    params.sign = aliexpressSign(params, this.appSecret);

    const res = await fetch(`${ENDPOINT}?${new URLSearchParams(params).toString()}`, {
      signal: AbortSignal.timeout(25_000),
      cache: "no-store",
    });

    if (!res.ok) throw new Error(`AliExpress → HTTP ${res.status}`);

    const body = (await res.json()) as {
      error_response?: { msg?: string; code?: string };
      aliexpress_affiliate_product_query_response?: {
        resp_result?: { result?: { products?: { product?: AliexpressProduct[] } } };
      };
    };

    if (body.error_response) {
      throw new Error(
        `AliExpress → ${body.error_response.code ?? "erreur"} : ${body.error_response.msg ?? ""}`,
      );
    }

    const products =
      body.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product ?? [];

    return products.map((product) => this.toCandidate(product, input));
  }

  private toCandidate(product: AliexpressProduct, input: { country: string }): ListingCandidate {
    const extra = product.product_small_image_urls;
    const gallery = Array.isArray(extra)
      ? extra
      : Array.isArray(extra?.string)
        ? extra.string
        : [];

    const images = [product.product_main_image_url, ...gallery]
      .filter((url): url is string => typeof url === "string" && url.startsWith("http"))
      .slice(0, 8)
      .map((url) => ({ url }));

    return {
      provider: this.name,
      externalId: String(product.product_id ?? images[0]?.url ?? "inconnu"),
      url: product.product_detail_url ?? "",
      title: product.product_title ?? "",
      // Les attributs ne sont pas fournis par la recherche : le moteur les
      // traitera comme inconnus, jamais comme concordants.
      images,
    };
  }
}
