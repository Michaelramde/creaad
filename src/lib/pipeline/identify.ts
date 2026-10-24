/**
 * Étape d'identification (J1) : OCR → archétype → candidats → appariement.
 *
 * Le pipeline est une fonction purement asynchrone, sans Inngest ni HTTP :
 * l'orchestrateur n'est qu'un appelant. C'est ce qui le rend testable
 * hors ligne, sans clé API.
 */
import { buildArchetype, type Archetype } from "../archetype/extract.ts";
import { pickBest } from "../matching/score.ts";
import { centroid } from "../matching/text.ts";
import type { Attributes, Category, Embedding, ListingCandidate, MatchResult, Regime } from "../matching/types.ts";
import { compactVariant, parseVariantLabel } from "../matching/variant.ts";
import type { Providers } from "../providers/index.ts";

/** Lecture OCR des photos — une panne ne fait pas échouer l'étape. */
async function runOcr(
  providers: Providers,
  imageUrls: readonly string[],
  warnings: string[],
): Promise<{ text: string; confidence: number }[]> {
  if (providers.ocr.extractMany) {
    try {
      return await providers.ocr.extractMany(imageUrls);
    } catch (error) {
      warnings.push(`OCR indisponible (${providers.ocr.name})`);
      console.warn("[identify] OCR échoué", error);
      return imageUrls.map(() => ({ text: "", confidence: 0 }));
    }
  }

  return Promise.all(
    imageUrls.map(async (url) => {
      try {
        return await providers.ocr.extract(url);
      } catch (error) {
        warnings.push(`OCR indisponible sur une image (${providers.ocr.name})`);
        console.warn("[identify] OCR échoué", error);
        return { text: "", confidence: 0 };
      }
    }),
  );
}

/** Interroge toutes les sources disponibles ; une source en panne est ignorée. */
async function searchSources(
  providers: Providers,
  archetype: Archetype,
  input: IdentifyInput,
  warnings: string[],
): Promise<ListingCandidate[]> {
  const candidates: ListingCandidate[] = [];

  for (const source of providers.sources) {
    if (!source.available()) continue;
    try {
      // 8 candidats : le produit du commerçant n'est pas toujours dans le top 5
      // (le classement AliExpress varie selon l'IP et le moment).
      const found = await source.search({
        archetype,
        country: input.country,
        limit: 8,
        query: input.userText,
      });
      candidates.push(...found);
    } catch (error) {
      warnings.push(`Source indisponible : ${source.name}`);
      console.warn("[identify] source échouée", source.name, error);
    }
  }

  return candidates;
}

export interface IdentifyInput {
  category: Category;
  regime: Regime;
  country: string;
  imageUrls: readonly string[];
  variantLabel?: string;
  /** Texte saisi par le commerçant (nom du produit, référence). */
  userText?: string;
}

export interface IdentifyOutput {
  archetype: Archetype;
  ocrText: string;
  ocrConfidence: number;
  candidatesFound: number;
  match: MatchResult;
  blocked: boolean;
  warnings: string[];
}

export async function identifyArticle(  providers: Providers,
  input: IdentifyInput,
): Promise<IdentifyOutput> {
  const warnings: string[] = [];

  /**
   * Tout ce qui ne dépend pas du reste part **en même temps**.
   *
   * Avant, les étapes s'enchaînaient : OCR → attributs → recherche → vision,
   * soit ~25 s à l'écran. Or la recherche n'a besoin que de la requête, et la
   * requête vient du texte saisi : dès qu'il existe, on peut interroger les
   * fournisseurs pendant que les modèles lisent les photos.
   */
  const named = (input.userText ?? "").trim().length >= 3;
  const earlyArchetype = named
    ? buildArchetype({ text: input.userText as string, fallbackCategory: input.category })
    : null;

  const ocrPromise = runOcr(providers, input.imageUrls, warnings);
  const attributesPromise = providers.attributes.describe(input.imageUrls);
  const embeddingsPromise = providers.embeddings
    .embed(input.imageUrls)
    .catch((error: unknown) => {
      warnings.push(`Embeddings indisponibles (${providers.embeddings.name})`);
      console.warn("[identify] embeddings échoués", error);
      return [] as Embedding[];
    });
  const searchPromise = earlyArchetype
    ? searchSources(providers, earlyArchetype, input, warnings)
    : null;

  /* 2 — OCR et attributs (une panne d'attributs remonte : elle fausserait le score). */
  const [ocrResults, attributes, embeddings] = await Promise.all([
    ocrPromise,
    attributesPromise,
    embeddingsPromise,
  ]);
  const userEmbedding = centroid(embeddings);

  const ocrText = ocrResults
    .map((r) => r.text)
    .filter((t) => t.trim().length > 0)
    .join("\n");
  const ocrConfidence =
    ocrResults.length > 0
      ? ocrResults.reduce((acc, r) => acc + r.confidence, 0) / ocrResults.length
      : 0;

  /* 3 — Archétype définitif : toujours enrichi par l'OCR.
   *
   * L'archétype précoce ne sert qu'à lancer la recherche plus tôt. Le retenir
   * ferait perdre la contenance lue sur l'étiquette (« serum » au lieu de
   * « serum 30 ml »), donc le mauvais jeu d'annonces au moment du marché.
   */
  const corpus = [input.userText ?? "", ocrText, ...ocrResults.map((r) => r.text)]
    .filter(Boolean)
    .join(" ");
  const archetype = buildArchetype({
    text: corpus,
    fallbackCategory: attributes.category ?? input.category,
  });

  /* 4 — Candidats fournisseurs : déjà lancés quand le produit était nommé. */
  const candidates =
    (await searchPromise) ?? (await searchSources(providers, archetype, input, warnings));

  /* 5 — Appariement. */
  let assessments: Map<string, { visual: number; text: number }> | undefined;
  if (providers.visual && candidates.length > 0) {
    // Même raisonnement : un comparateur en panne ne doit pas se traduire
    // par « produit non reconnu ».
    assessments = await providers.visual.compare(
      input.imageUrls,
      corpus,
      candidates.map((c) => ({
        id: c.externalId,
        imageUrl: c.images[0]?.url,
        title: c.title,
      })),
    );
  }

  const match = pickBest(
    {
      userText: corpus,
      userEmbedding,
      userAttributes: attributes,
      userVariant: compactVariant(parseVariantLabel(input.variantLabel)),
    },
    candidates,
    assessments,
  );

  if (candidates.length === 0) {
    warnings.push("Aucune annonce fournisseur trouvée : identification impossible.");
  }

  return {
    archetype,
    ocrText,
    ocrConfidence,
    candidatesFound: candidates.length,
    match,
    blocked: !match.accepted,
    warnings,
  };
}
