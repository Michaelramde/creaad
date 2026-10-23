/**
 * Fabrique de fournisseurs : choisit l'implémentation disponible et expose
 * son état. Un fournisseur absent est **signalé**, pas remplacé par du faux.
 */
import { env } from "../env.ts";
import { AliExpressAdapter } from "./aliexpress.ts";
import {
  EmptySourceAdapter,
  LocalOcrProvider,
  NoopAttributeProvider,
  NoopEmbeddingProvider,
} from "./defaults.ts";
import { GeminiAttributeProvider, GeminiOcrProvider } from "./gemini.ts";
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

/**
 * Sélection des fournisseurs, du meilleur au plus modeste :
 *   OCR        Mistral (payant, dense) → Gemini (gratuit) → local (dev)
 *   Attributs  Gemini (gratuit) → noop
 *
 * Aucun retour silencieux : ce qui n'est pas configuré est visible dans
 * `providerStatus()` et se traduit par un blocage, pas par une invention.
 */
export function createProviders(overrides: Partial<Providers> = {}): Providers {
  const ocr: OcrProvider =
    overrides.ocr ??
    (env.MISTRAL_API_KEY
      ? new MistralOcrProvider(env.MISTRAL_API_KEY)
      : env.GEMINI_API_KEY
        ? new GeminiOcrProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL)
        : new LocalOcrProvider());

  const attributes: AttributeProvider =
    overrides.attributes ??
    (env.GEMINI_API_KEY
      ? new GeminiAttributeProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL)
      : new NoopAttributeProvider());

  // Sources d'annonces : la première qui répond alimente l'appariement.
  // Sans clé AliExpress, on garde une source vide — le pipeline bloquera
  // proprement plutôt que d'inventer un candidat.
  const defaultSources: SourceAdapter[] =
    env.ALIEXPRESS_APP_KEY && env.ALIEXPRESS_APP_SECRET
      ? [
          new AliExpressAdapter(
            env.ALIEXPRESS_APP_KEY,
            env.ALIEXPRESS_APP_SECRET,
            env.ALIEXPRESS_TRACKING_ID,
          ),
        ]
      : [new EmptySourceAdapter()];

  return {
    ocr,
    attributes,
    embeddings: overrides.embeddings ?? new NoopEmbeddingProvider(),
    sources: overrides.sources ?? defaultSources,
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
