/**
 * Normalisation d'une fiche AliExpress brute vers un `ProductRecord`.
 *
 * L'acteur renvoie 43 champs aux formes hétérogènes : les specs sont un
 * tableau, les variantes croisent deux listes, la galerie est une liste de
 * chaînes. On en sort une structure unique et typée, réutilisable partout.
 */
import type {
  PoolImage,
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
