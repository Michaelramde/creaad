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
  search(input: { archetype: Archetype; country: string; limit?: number }): Promise<ListingCandidate[]>;
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
}
