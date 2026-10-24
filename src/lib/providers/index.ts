/**
 * Fabrique de fournisseurs : choisit l'implémentation disponible et expose
 * son état. Un fournisseur absent est **signalé**, pas remplacé par du faux.
 */
import { env } from "../env.ts";
import { AliExpressAdapter } from "./aliexpress.ts";
import { AliExpressHttpSource } from "./aliexpress-http.ts";
import {
  LocalOcrProvider,
  NoopAttributeProvider,
  NoopEmbeddingProvider,
} from "./defaults.ts";
import { GeminiAttributeProvider, GeminiOcrProvider } from "./gemini.ts";
import { GeminiSlotClassifier, GeminiVisualComparator } from "./gemini-vision.ts";
import { GeminiEmbeddingProvider } from "./gemini-embedding.ts";
import { ApifyClient } from "./apify.ts";
import { ApifyImageSearch } from "./image-search.ts";
import { ApifyProductDetail } from "./product-detail.ts";
import { ApifySuppliers } from "./suppliers.ts";
import type { ProductPipeline } from "../pipeline/identify-product.ts";
import { GeminiCreativeWriter } from "./gemini-writer.ts";
import { VisualIndexSource } from "./visual-index.ts";
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

  // Ordre volontaire : la ressemblance d'abord — c'est ce qui marche quand le
  // commerçant ne sait pas nommer son produit. La recherche textuelle complète
  // l'index quand la photo ne donne rien.
  const defaultSources: SourceAdapter[] = [
    ...(env.GEMINI_API_KEY ? [new VisualIndexSource(env.GEMINI_API_KEY)] : []),
    ...(env.ALIEXPRESS_APP_KEY && env.ALIEXPRESS_APP_SECRET
      ? [
          new AliExpressAdapter(
            env.ALIEXPRESS_APP_KEY,
            env.ALIEXPRESS_APP_SECRET,
            env.ALIEXPRESS_TRACKING_ID,
          ),
        ]
      : []),
    new AliExpressHttpSource(),
  ];

  const apify = env.APIFY_TOKEN ? new ApifyClient(env.APIFY_TOKEN) : null;

  return {
    ocr,
    attributes,
    embeddings:
      overrides.embeddings ??
      (env.GEMINI_API_KEY ? new GeminiEmbeddingProvider(env.GEMINI_API_KEY) : new NoopEmbeddingProvider()),
    sources: overrides.sources ?? defaultSources,
    ...(apify
      ? {
          productPipeline: {
            imageSearch: new ApifyImageSearch(apify, env.ACTOR_IMAGE_SEARCH),
            detail: new ApifyProductDetail(apify, env.ACTOR_PRODUCT_DETAIL),
            suppliers: new ApifySuppliers(apify, env.ACTOR_SUPPLIERS),
            ocr,
          },
        }
      : {}),
    ...(env.GEMINI_API_KEY
      ? {
          visual:
            overrides.visual ??
            new GeminiVisualComparator(env.GEMINI_API_KEY, env.GEMINI_MODEL),
          slots:
            overrides.slots ??
            new GeminiSlotClassifier(env.GEMINI_API_KEY, env.GEMINI_MODEL),
          writer:
            overrides.writer ??
            new GeminiCreativeWriter(env.GEMINI_API_KEY, env.GEMINI_MODEL),
        }
      : {}),
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
