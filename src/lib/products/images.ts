/**
 * Choisir les images d'une variante.
 *
 * Règle : la planche ne doit jamais montrer une couleur que le commerçant ne
 * vend pas. L'image du coloris retenu est donc épinglée en tête, et les vues
 * partagées de la galerie viennent ensuite — signalées comme telles dans l'UI
 * parce qu'elles ne sont pas étiquetées par coloris.
 */
import type { PoolImage, ProductRecord, VariantSelection } from "./types.ts";
import { selectedValues } from "./types.ts";

export interface SelectionImages {
  images: PoolImage[];
  /** Images du coloris, garanties conformes. */
  variantImages: PoolImage[];
  /** Vues supplémentaires non étiquetées par coloris. */
  sharedImages: PoolImage[];
}

export function imagesForSelection(
  record: ProductRecord,
  selection: VariantSelection | undefined,
  limit = 6,
): SelectionImages {
  const variantImages: PoolImage[] = [];
  const seen = new Set<string>();

  if (selection) {
    for (const value of selectedValues(record.variantAxes, selection)) {
      if (!value.image || seen.has(value.image)) continue;
      seen.add(value.image);
      variantImages.push({ url: value.image, origin: "variant" });
    }
  }

  const sharedImages: PoolImage[] = [];
  const pool = record.images.length > 0 ? record.images : record.gallery;

  for (const image of pool) {
    if (seen.has(image.url)) continue;
    seen.add(image.url);
    sharedImages.push(image);
  }

  return {
    images: [...variantImages, ...sharedImages].slice(0, limit),
    variantImages,
    sharedImages,
  };
}

/** Le coloris demandé existe-t-il vraiment ? Sinon, on le dit. */
export function validateSelection(
  record: ProductRecord,
  selection: VariantSelection,
): { valid: boolean; unknown: string[] } {
  const unknown: string[] = [];

  for (const axis of record.variantAxes) {
    const valueId = selection[axis.axis];
    if (!valueId) continue;
    if (!axis.values.some((value) => value.valueId === valueId)) {
      unknown.push(`${axis.axis} = ${valueId}`);
    }
  }

  return { valid: unknown.length === 0, unknown };
}
