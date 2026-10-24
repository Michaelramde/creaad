/**
 * Normalisation d'une fiche AliExpress brute vers un `ProductRecord`.
 *
 * L'acteur renvoie 43 champs aux formes hétérogènes : les specs sont un
 * tableau, les variantes croisent deux listes, la galerie est une liste de
 * chaînes. On en sort une structure unique et typée, réutilisable partout.
 */
import type {
  PoolImage,
  ProductReview,
  ProductVariant,
  VariantAxis,
  VariantValue,
} from "./types.ts";
import { isProductAxis } from "./types.ts";

export interface RawVariantOption {
  name?: string;
  propertyId?: number;
  values?: { name?: string; rawName?: string; valueId?: string; image?: string }[];
}

export interface RawVariant {
  skuId?: string;
  options?: { name?: string; value?: string }[];
  salable?: boolean;
  stock?: number;
}

export interface RawSpec {
  name?: string;
  value?: string;
}

/**
 * Images de la description A+ — le gisement caché.
 *
 * La fiche AliExpress expose 6 images de galerie, mais la description en
 * contient souvent 20 à 30 : détails, tableaux de mesures, usage. Mesuré sur
 * le sac de test : **24 images** contre 6.
 */
export function extractDescriptionImages(html: string): PoolImage[] {
  const found = [...html.matchAll(/https?:\/\/[^"')\s]+?\.(?:jpg|jpeg|png|webp)/gi)]
    .map((match) => match[0].replace(/^http:\/\//, "https://"))
    // Les vignettes 50×50 et les GIF de suivi ne servent à rien.
    .filter((url) => !/_(\d{1,2}x\d{1,2})\./.test(url) && !/\.gif$/i.test(url));

  const images: PoolImage[] = [...new Set(found)].map((url) => ({ url, origin: "gallery" as const }));
  return images;
}

/** Photos jointes aux avis : de vraies prises de vue, sous d'autres angles. */
export function reviewImages(reviews: readonly ProductReview[]): string[] {
  return reviews.flatMap((review) => review.images ?? []).filter(Boolean);
}

/** Avis clients : on ne garde que ce qui sert à comprendre l'acheteur. */
export function normalizeReviews(raw: unknown): ProductReview[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry) => {
      const review = entry as {
        reviewId?: string;
        rating?: number;
        text?: string;
        textOriginal?: string;
        date?: string;
        buyerCountry?: string;
        images?: unknown;
        wouldBuyAgain?: boolean;
        daysAfterPurchase?: number;
        skuInfo?: string;
      };

      const images = Array.isArray(review.images)
        ? review.images
            .map((img) => (typeof img === "string" ? img : (img as { url?: string })?.url))
            .filter((url): url is string => typeof url === "string")
        : [];

      return {
        reviewId: String(review.reviewId ?? ""),
        rating: Math.min(5, Math.max(1, Math.round(Number(review.rating ?? 0)) || 0)),
        text: String(review.text ?? review.textOriginal ?? "").trim().slice(0, 1200),
        ...(review.date ? { date: review.date } : {}),
        ...(review.buyerCountry ? { buyerCountry: review.buyerCountry } : {}),
        images,
        ...(review.wouldBuyAgain !== undefined ? { wouldBuyAgain: review.wouldBuyAgain } : {}),
        ...(typeof review.daysAfterPurchase === "number"
          ? { daysAfterPurchase: review.daysAfterPurchase }
          : {}),
        ...(review.skuInfo ? { skuInfo: String(review.skuInfo).slice(0, 120) } : {}),
      } satisfies ProductReview;
    })
    .filter((review) => review.text.length > 0 || review.images.length > 0);
}

export function normalizeGallery(raw: unknown): PoolImage[] {
  if (!Array.isArray(raw)) return [];

  const images: PoolImage[] = [];
  for (const entry of raw) {
    const url = typeof entry === "string" ? entry : (entry as { url?: string })?.url;
    if (!url) continue;
    const size = /_(\d+)x(\d+)\./.exec(url);
    images.push({
      url,
      origin: "gallery",
      ...(size ? { width: Number(size[1]), height: Number(size[2]) } : {}),
    });
  }

  // Dédoublonnage par URL exacte.
  return [...new Map(images.map((image) => [image.url, image])).values()];
}

export function normalizeSpecs(raw: unknown): Record<string, string> {
  const specs: Record<string, string> = {};

  if (Array.isArray(raw)) {
    for (const entry of raw as RawSpec[]) {
      const name = entry?.name?.trim();
      const value = entry?.value?.trim();
      if (name && value) specs[name] = value;
    }
  } else if (raw && typeof raw === "object") {
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) specs[name] = value.trim();
      else if (typeof value === "number") specs[name] = String(value);
    }
  }

  return specs;
}

export function normalizeVariants(
  rawOptions: unknown,
  rawVariants: unknown,
): { axes: VariantAxis[]; variants: ProductVariant[] } {
  const variants: ProductVariant[] = Array.isArray(rawVariants)
    ? (rawVariants as RawVariant[])
        .filter((v) => v?.skuId)
        .map((v) => ({
          skuId: String(v.skuId),
          options: Object.fromEntries(
            (v.options ?? [])
              .filter((o) => o?.name && o?.value)
              .map((o) => [String(o.name), String(o.value)]),
          ),
          salable: v.salable !== false,
          stock: Number(v.stock ?? 0),
        }))
    : [];

  const axes: VariantAxis[] = [];

  for (const option of Array.isArray(rawOptions) ? (rawOptions as RawVariantOption[]) : []) {
    const axis = option?.name?.trim();
    if (!axis || !isProductAxis(axis)) continue; // logistique exclue
    const values = option.values ?? [];
    if (values.length === 0) continue;

    const normalized: VariantValue[] = values.map((value) => {
      const name = (value?.name ?? value?.rawName ?? "").trim();
      const matching = variants.filter((variant) => variant.options[axis] === name);
      const stock = matching.reduce((acc, variant) => acc + (variant.salable ? variant.stock : 0), 0);

      return {
        valueId: String(value?.valueId ?? name),
        name,
        ...(value?.image ? { image: String(value.image) } : {}),
        available: stock > 0,
        stock,
      };
    });

    axes.push({ axis, values: normalized });
  }

  return { axes, variants };
}

/**
 * Pool d'images ordonné : le coloris épinglé d'abord, puis la galerie.
 * Les visuels d'avis et de fournisseurs s'y ajoutent quand ils existent.
 */
export function buildImagePool(input: {
  gallery: PoolImage[];
  variantImages?: string[];
  reviewImages?: string[];
  supplierImages?: string[];
}): PoolImage[] {
  const seen = new Set<string>();
  const pool: PoolImage[] = [];

  const push = (url: string, origin: PoolImage["origin"], size?: { width?: number; height?: number }) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    pool.push({ url, origin, ...(size?.width ? { width: size.width } : {}), ...(size?.height ? { height: size.height } : {}) });
  };

  for (const url of input.variantImages ?? []) push(url, "variant");
  for (const image of input.gallery) push(image.url, "gallery", { width: image.width, height: image.height });
  for (const url of input.reviewImages ?? []) push(url, "review");
  for (const url of input.supplierImages ?? []) push(url, "supplier");

  return pool;
}

/** Les six meilleures vues : l'origine prime, puis la résolution. */
export function topImages(pool: readonly PoolImage[], count = 6): PoolImage[] {
  const rank: Record<PoolImage["origin"], number> = { variant: 0, gallery: 1, review: 2, supplier: 3 };

  return [...pool]
    .sort((a, b) => {
      const byOrigin = rank[a.origin] - rank[b.origin];
      if (byOrigin !== 0) return byOrigin;
      return (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0);
    })
    .slice(0, count);
}
