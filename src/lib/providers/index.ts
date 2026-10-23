/**
 * Fabrique de fournisseurs : choisit l'implémentation disponible et expose
 * son état. Un fournisseur absent est **signalé**, pas remplacé par du faux.
 */
import { env } from "../env.ts";
import {
  EmptySourceAdapter,
  LocalOcrProvider,
  NoopAttributeProvider,
  NoopEmbeddingProvider,
} from "./defaults.ts";
import { MistralOcrProvider } from "./mistral-ocr.ts";
import type {
  AttributeProvider,
  EmbeddingProvider,
  OcrProvider,
  ProviderStatus,
  Providers,
  SourceAdapter,
} from "./types.ts";

export type { Providers };

export function createProviders(overrides: Partial<Providers> = {}): Providers {
  const ocr: OcrProvider =
    overrides.ocr ??
    (env.MISTRAL_API_KEY ? new MistralOcrProvider(env.MISTRAL_API_KEY) : new LocalOcrProvider());

  return {
    ocr,
    attributes: overrides.attributes ?? new NoopAttributeProvider(),
    embeddings: overrides.embeddings ?? new NoopEmbeddingProvider(),
    sources: overrides.sources ?? [new EmptySourceAdapter()],
  };
}

export function providerStatus(providers: Providers): ProviderStatus {
  return {
    ocr: providers.ocr.name,
    attributes: providers.attributes.name,
    embeddings: providers.embeddings.name,
    sources: providers.sources.map((s) => s.name),
  };
}

/** Vrai si aucune source ne peut réellement renvoyer de candidat. */
export function hasUsableSources(providers: Providers): boolean {
  return providers.sources.some((s) => s.available());
}
