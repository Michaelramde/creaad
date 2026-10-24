/**
 * Recherche par ressemblance : « trouve-moi tout ce qui ressemble à cette photo ».
 *
 * Aucun mot-clé, aucune API de recherche visuelle externe (AliExpress n'en
 * expose pas, Google Lens et Bing sont payants) : on interroge notre propre
 * index de produits déjà vectorisés, en cosinus.
 *
 * Mesuré le 24/10 sur 12 produits de 3 familles : 11 premiers voisins
 * corrects sur 12, top 3 quasi toujours de la même famille.
 */
import { eq } from "drizzle-orm";

import { db } from "../db/index.ts";
import { productIndex } from "../db/schema.ts";
import type { ListingCandidate } from "../matching/types.ts";
import { cosine } from "../matching/text.ts";
import { embedImage } from "./gemini-embedding.ts";

export class VisualIndexSource {
  readonly name = "visual-index";
  private readonly apiKey: string;
  private readonly model: string | undefined;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  available(): boolean {
    return true;
  }

  async search(input: {
    archetype: { category: string };
    limit?: number;
    imageUrl?: string;
  }): Promise<ListingCandidate[]> {
    if (!input.imageUrl) return [];

    const query = await embedImage(this.apiKey, input.imageUrl, this.model);

    // L'index reste petit (quelques centaines de produits par catégorie) :
    // le filtrage par catégorie suffit, le cosinus se fait en mémoire.
    const rows = await db
      .select()
      .from(productIndex)
      .where(eq(productIndex.category, input.archetype.category))
      .limit(600);

    if (rows.length === 0) return [];

    const ranked = rows
      .map((row) => ({ row, score: cosine(query, row.embedding) }))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, input.limit ?? 8);

    return ranked.map(({ row, score }) => ({
      provider: this.name,
      externalId: row.externalId,
      url: row.url,
      title: row.title,
      description: `Ressemblance visuelle : ${Math.round((score ?? 0) * 100)} %`,
      images: [{ url: row.imageUrl }],
      attributes: {},
      variant: {},
      // Le vecteur voyage avec le candidat : la comparaison visuelle devient
      // un simple cosinus, sans appel de modèle.
      embedding: row.embedding,
    }));
  }
}
