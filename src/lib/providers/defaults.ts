/**
 * Fournisseurs par défaut, sans clé API.
 *
 * Comportement assumé : ils ne devinent rien.
 *  - OCR : ne lit que le texte explicitement fourni dans l'URL (`?text=`),
 *    convention de développement. Aucune invention.
 *  - Attributs / embeddings : vides.
 *  - Sources : aucune.
 *
 * Conséquence : sans fournisseur configuré, `match_score` ne peut pas
 * atteindre 70 et l'analyse se **bloque**. C'est le comportement correct :
 * on préfère bloquer que produire une planche fidèle au mauvais produit.
 */
import type { Attributes, Embedding, ListingCandidate, OcrResult } from "../matching/types.ts";
import type {
  AttributeProvider,
  EmbeddingProvider,
  OcrProvider,
  SourceAdapter,
} from "./types.ts";
import type { Archetype } from "../archetype/extract.ts";

/** Lit `?text=` (ou `#text=`) dans l'URL. Développement et tests uniquement. */
export class LocalOcrProvider implements OcrProvider {
  readonly name = "local-dev";

  async extract(imageUrl: string): Promise<OcrResult> {
    try {
      const url = new URL(imageUrl, "http://local");
      const text = url.searchParams.get("text") ?? "";
      return { text, confidence: text ? 1 : 0, provider: this.name };
    } catch {
      return { text: "", confidence: 0, provider: this.name };
    }
  }
}

export class NoopAttributeProvider implements AttributeProvider {
  readonly name = "noop";
  async describe(): Promise<Attributes> {
    return {};
  }
}

export class NoopEmbeddingProvider implements EmbeddingProvider {
  readonly name = "noop";
  async embed(): Promise<Embedding[]> {
    return [];
  }
}

export class EmptySourceAdapter implements SourceAdapter {
  readonly name = "none";
  available(): boolean {
    return false;
  }
  async search(): Promise<ListingCandidate[]> {
    return [];
  }
}

/**
 * Adaptateur de démonstration : jeu de candidats fixe, utile pour tester le
 * pipeline et la démonstration publique sans dépendre d'une source externe.
 */
export class FixtureSourceAdapter implements SourceAdapter {
  readonly name = "fixtures";
  private readonly candidates: ListingCandidate[];

  constructor(candidates: ListingCandidate[] = []) {
    this.candidates = candidates;
  }

  available(): boolean {
    return this.candidates.length > 0;
  }

  async search(input: { archetype: Archetype; limit?: number }): Promise<ListingCandidate[]> {
    const limit = input.limit ?? 5;
    return this.candidates
      .filter((c) => c.title.toLowerCase().includes(input.archetype.noun))
      .slice(0, limit);
  }
}
