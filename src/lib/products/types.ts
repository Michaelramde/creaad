/**
 * Types de l'identité produit.
 *
 * Un produit n'est pas « un titre et une image » : c'est un ensemble de faits
 * dont chacun sait de combien de sources il provient. C'est ce qui autorise
 * l'app à affirmer une dimension au lieu de la répéter.
 */

/** Provenance d'un visuel — l'ordre de confiance est donné par `IMAGE_RANK`. */
export type ImageOrigin = "variant" | "gallery" | "review" | "supplier";

export const IMAGE_RANK: Record<ImageOrigin, number> = {
  variant: 0,
  gallery: 1,
  review: 2,
  supplier: 3,
};

export interface PoolImage {
  url: string;
  origin: ImageOrigin;
  width?: number;
  height?: number;
}

export interface VariantValue {
  valueId: string;
  name: string;
  image?: string;
  /** Faux si aucun SKU portant ce coloris n'est en stock. */
  available: boolean;
  stock: number;
}

export interface VariantAxis {
  axis: string;
  values: VariantValue[];
}

export interface ProductVariant {
  skuId: string;
  options: Record<string, string>;
  salable: boolean;
  stock: number;
}

/** Niveau de preuve d'un fait. */
export type Confidence = "corroboré" | "unique" | "contradictoire";

export interface Fact<T = string | number | number[]> {
  value: T;
  sources: string[];
  confidence: Confidence;
  /** Valeurs concurrentes quand les sources se contredisent. */
  conflicts?: (string | number | number[])[];
}

export type Facts = Record<string, Fact>;

export interface Dimensions {
  volumeMl?: number;
  weightG?: number;
  /** [longueur, largeur, hauteur] en millimètres. */
  lengthWidthHeightMm?: [number, number, number];
}

/** Ce que l'on conserve d'un produit, prêt à être réutilisé. */
export interface ProductRecord {
  provider: string;
  productId: string;
  title: string;
  url: string;
  price?: number;
  currency?: string;
  rating?: number;
  sold?: number;
  gallery: PoolImage[];
  variantAxes: VariantAxis[];
  variants: ProductVariant[];
  specs: Record<string, string>;
  facts: Facts;
  images: PoolImage[];
  seller?: Record<string, unknown>;
  fetchedAt: Date;
  expiresAt: Date;
}

/** Le commerçant choisit une valeur par axe produit. */
export type VariantSelection = Record<string, string>;

/** Axes qui décrivent le produit — la logistique est exclue. */
export function isProductAxis(axis: string): boolean {
  return !/ship|expéd|exped|envoi|delivery|livraison/i.test(axis);
}

/** Coloris retenus, dans l'ordre des axes. */
export function selectedValues(
  axes: readonly VariantAxis[],
  selection: VariantSelection,
): VariantValue[] {
  return axes
    .filter((axis) => isProductAxis(axis.axis))
    .map((axis) => axis.values.find((value) => value.valueId === selection[axis.axis]))
    .filter((value): value is VariantValue => value !== undefined);
}

/** Le produit n'a qu'une seule combinaison utile : aucun écran à afficher. */
export function needsVariantChoice(axes: readonly VariantAxis[]): boolean {
  const product = axes.filter((axis) => isProductAxis(axis.axis));
  if (product.length === 0) return false;
  return product.some((axis) => axis.values.filter((v) => v.available).length > 1);
}
