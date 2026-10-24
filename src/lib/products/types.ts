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
  /** Coloris représenté, quand il a pu être identifié. */
  variantValueId?: string;
  /**
   * `technique` = tableau de mesures, schéma, dimensions : ces images ne
   * montrent pas le produit sous un angle, mais elles portent des faits.
   * Elles restent affichées quel que soit le coloris choisi.
   */
  kind?: "produit" | "technique";
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

/** Un avis client — la matière première des désirs et des objections. */
export interface ProductReview {
  reviewId: string;
  rating: number;
  text: string;
  date?: string;
  buyerCountry?: string;
  images: string[];
  wouldBuyAgain?: boolean;
  daysAfterPurchase?: number;
  skuInfo?: string;
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
  /** Description A+ : la source des 24 images détaillées et des tableaux de mesures. */
  descriptionUrl?: string;
  /** Avis clients, avec leurs photos et leur pays d'achat. */
  reviews: ProductReview[];
  seller?: Record<string, unknown>;
  /** Marché auquel ce produit a été rattaché — calculé une seule fois. */
  archetypeSlug?: string;
  archetypeSource?: "lexique" | "routeur" | "aucun";
  fetchedAt: Date;
  expiresAt: Date;
}

/**
 * Le commerçant choisit une **ou plusieurs** valeurs par axe produit : celui
 * qui vend du noir et du marron doit pouvoir le dire.
 */
export type VariantSelection = Record<string, string[]>;

/** Axes qui décrivent le produit — la logistique est exclue. */
export function isProductAxis(axis: string): boolean {
  return !/ship|expéd|exped|envoi|delivery|livraison/i.test(axis);
}

/** Valeurs retenues, dans l'ordre des axes puis de la sélection. */
export function selectedValues(
  axes: readonly VariantAxis[],
  selection: VariantSelection | undefined,
): VariantValue[] {
  if (!selection) return [];

  const values: VariantValue[] = [];
  for (const axis of axes) {
    if (!isProductAxis(axis.axis)) continue;
    const chosen = selection[axis.axis] ?? [];
    for (const valueId of chosen) {
      const value = axis.values.find((candidate) => candidate.valueId === valueId);
      if (value) values.push(value);
    }
  }
  return values;
}

/** Le produit n'a qu'une seule combinaison utile : aucun écran à afficher. */
export function needsVariantChoice(axes: readonly VariantAxis[]): boolean {
  const product = axes.filter((axis) => isProductAxis(axis.axis));
  if (product.length === 0) return false;
  return product.some((axis) => axis.values.filter((v) => v.available).length > 1);
}
