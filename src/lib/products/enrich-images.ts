/**
 * Classement des images d'une fiche produit — la brique qui rend la sélection
 * de coloris utile.
 *
 * Sans lui, aucune image n'est rattachée à une couleur : cocher ou décocher un
 * coloris ne change alors rien à la galerie ni à l'export.
 *
 * Appelé en tâche de fond après la livraison de l'étape 1 (~90 s pour 40
 * images), pour ne pas faire attendre le commerçant.
 */
import { eq } from "drizzle-orm";

import { db } from "../db/index.ts";
import { productRecords } from "../db/schema.ts";
import type { PoolImage, ProductRecord, VariantAxis } from "./types.ts";
import { classifyImages } from "./classify-images.ts";

export interface ClassifyOutcome {
  classified: number;
  total: number;
  alreadyDone: boolean;
}

function hasClassification(images: readonly PoolImage[]): boolean {
  return images.some((image) => Boolean(image.kind));
}

export async function classifyProductRecord(
  productId: string,
  apiKey: string,
  model?: string,
): Promise<ClassifyOutcome> {
  const [record] = await db
    .select()
    .from(productRecords)
    .where(eq(productRecords.productId, productId))
    .limit(1);

  if (!record) return { classified: 0, total: 0, alreadyDone: false };

  const images = record.images as PoolImage[];
  if (hasClassification(images)) {
    return { classified: 0, total: images.length, alreadyDone: true };
  }

  const axes = record.variantAxes as VariantAxis[];
  const colours = axes.flatMap((axis) =>
    axis.values
      .filter((value) => value.image)
      .map((value) => ({ valueId: value.valueId, name: value.name })),
  );

  const verdicts = await classifyImages({
    apiKey,
    urls: images.map((image) => image.url),
    colours,
    ...(model ? { model } : {}),
  });

  const updated = images.map((image, index) => {
    const base: Record<string, unknown> = { url: image.url, origin: image.origin };
    if (image.width !== undefined) base.width = image.width;
    if (image.height !== undefined) base.height = image.height;

    const verdict = verdicts.get(index);
    if (!verdict) return { ...base, kind: "sans_produit" };

    return {
      ...base,
      kind: verdict.type,
      ...(verdict.variantValueId ? { variantValueId: verdict.variantValueId } : {}),
      ...(verdict.hasTechnicalText ? { technicalText: true } : {}),
    };
  });

  await db
    .update(productRecords)
    .set({ images: updated as unknown as ProductRecord["images"] })
    .where(eq(productRecords.productId, productId));

  return { classified: verdicts.size, total: images.length, alreadyDone: false };
}
