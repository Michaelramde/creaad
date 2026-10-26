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

  /**
   * Classement **incrémental** : on ne retraite que ce qui n'a pas encore de
   * nature. L'ancien code sortait dès qu'UNE image était classée, et
   * réécrivait toutes les autres — y compris celles déjà classées, dont il
   * perdait les champs.
   */
  const pending = images
    .map((image, index) => ({ image, index }))
    .filter((entry) => !entry.image.kind);

  if (pending.length === 0) {
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
    urls: pending.map((entry) => entry.image.url),
    colours,
    ...(model ? { model } : {}),
  });

  const updated = [...images];

  for (const [local, entry] of pending.entries()) {
    const verdict = verdicts.get(local);
    /**
     * ⚠️ Absence de verdict ≠ « sans produit ».
     *
     * L'ancien code écrivait « sans_produit » quand le modèle ne répondait pas
     * (429, timeout) : les images disparaissaient de la galerie et de l'export,
     * définitivement, parce que le job ne repassait jamais. On laisse désormais
     * l'image non classée — elle reste visible, et le prochain passage la
     * reprend.
     */
    if (!verdict) continue;

    updated[entry.index] = {
      ...entry.image,
      kind: verdict.type,
      ...(verdict.variantValueId ? { variantValueId: verdict.variantValueId } : {}),
      ...(verdict.hasTechnicalText ? { technicalText: true } : {}),
    };
  }

  await db
    .update(productRecords)
    .set({ images: updated as unknown as ProductRecord["images"] })
    .where(eq(productRecords.productId, productId));

  return { classified: verdicts.size, total: images.length, alreadyDone: false };
}
