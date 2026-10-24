/**
 * Vérifier que l'annonce montre bien **ce** produit.
 *
 * Le mot-clé « jeep buluo » ramène la marque — pas forcément ce modèle. On
 * compare donc chaque visuel d'annonce à la photo du produit (embeddings,
 * gratuit) et on note la ressemblance.
 *
 * Choix assumé : on **note**, on ne supprime pas. Un visuel où le sac est porté
 * par un mannequin ressemble moins à un packshot qu'un autre packshot ; le
 * retirer aveuglément ferait perdre de vraies annonces du produit. La note
 * sert à ordonner et à dire « M annonces confirment visuellement ».
 */
import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "../db/index.ts";
import { adObservations } from "../db/schema.ts";
import { cosine } from "../matching/text.ts";
import { embedImage } from "../providers/gemini-embedding.ts";

/** Au-delà, on considère que l'annonce montre le produit. */
export const SIMILARITY_CONFIRMED = 0.7;

export interface VerifyResult {
  checked: number;
  confirmed: number;
  failed: number;
}

export async function verifyProductAds(input: {
  productRef: string;
  productImageUrl: string;
  apiKey: string;
  limit?: number;
}): Promise<VerifyResult> {
  const rows = await db
    .select({ id: adObservations.id, imageUrl: adObservations.adImageUrl })
    .from(adObservations)
    .where(
      and(
        eq(adObservations.productRef, input.productRef),
        isNull(adObservations.productSimilarity),
        sql`${adObservations.adImageUrl} IS NOT NULL`,
      ),
    )
    .limit(input.limit ?? 20);

  if (rows.length === 0) return { checked: 0, confirmed: 0, failed: 0 };

  let reference: number[];
  try {
    reference = await embedImage(input.apiKey, input.productImageUrl);
  } catch {
    return { checked: 0, confirmed: 0, failed: rows.length };
  }

  let checked = 0;
  let confirmed = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.imageUrl) continue;
    try {
      const vector = await embedImage(input.apiKey, row.imageUrl);
      const similarity = cosine(reference, vector);
      if (similarity === null) {
        failed += 1;
        continue;
      }

      await db
        .update(adObservations)
        .set({ productSimilarity: similarity.toFixed(3) })
        .where(eq(adObservations.id, row.id));

      checked += 1;
      if (similarity >= SIMILARITY_CONFIRMED) confirmed += 1;
    } catch {
      failed += 1;
    }
  }

  return { checked, confirmed, failed };
}
