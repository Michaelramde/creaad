/**
 * Interfaces fournisseurs — le pipeline ne dépend jamais d'un SDK concret.
 * Chaque source est remplaçable, et son indisponibilité est **déclarée**,
 * jamais compensée par des données inventées (SPEC §10.4).
 */
import type {
  Attributes,
  Embedding,
  ListingCandidate,
  OcrResult,
} from "../matching/types.ts";
import type { Archetype } from "../archetype/extract.ts";

export interface OcrProvider {
  readonly name: string;
  extract(imageUrl: string): Promise<OcrResult>;
  /**
   * Version groupée : un seul appel pour toutes les photos.
   * Un appel par image multiplie la latence et la consommation de quota.
   */
  extractMany?(imageUrls: readonly string[]): Promise<OcrResult[]>;
}

export interface AttributeProvider {
  readonly name: string;
  describe(imageUrls: readonly string[]): Promise<Attributes>;
}

export interface EmbeddingProvider {
  readonly name: string;
  embed(imageUrls: readonly string[]): Promise<Embedding[]>;
}

export interface SourceAdapter {
  readonly name: string;
  available(): boolean;
  search(input: {
    archetype: Archetype;
    country: string;
    limit?: number;
    /**
     * Texte saisi par le commerçant. Indispensable : « sac » ramène les sacs
     * les plus populaires, « sac jeep 3 en 1 » ramène le bon.
     */
    query?: string;
  }): Promise<ListingCandidate[]>;
}

export interface ProviderStatus {
  ocr: string;
  attributes: string;
  embeddings: string;
  sources: string[];
}

/** Ensemble des fournisseurs injectés dans le pipeline. */
export interface Providers {
  ocr: OcrProvider;
  attributes: AttributeProvider;
  embeddings: EmbeddingProvider;
  sources: SourceAdapter[];
  /** Comparateur produit (vision + texte). Optionnel : sans lui, l'appariement reste textuel. */
  visual?: {
    readonly name: string;
    compare(
      userImages: readonly string[],
      userText: string,
      candidates: readonly { id: string; imageUrl?: string; title: string }[],
    ): Promise<Map<string, { visual: number; text: number }>>;
  };
  /** Classificateur d'emplacements (quelle vue est cette photo). */
  slots?: {
    readonly name: string;
    classify(
      imageUrls: readonly string[],
      slots: readonly { id: string; label: string }[],
    ): Promise<Map<number, string | null>>;
  };
  /** Rédacteur du kit production. */
  writer?: {
    readonly name: string;
    write(prompt: string): Promise<string>;
  };
}
