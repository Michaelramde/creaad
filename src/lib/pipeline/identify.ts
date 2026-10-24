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
import type { Attributes, Category, Embedding, MatchResult, Regime } from "../matching/types.ts";
import { compactVariant, parseVariantLabel } from "../matching/variant.ts";
import type { Providers } from "../providers/index.ts";

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

export async function identifyArticle(
  providers: Providers,
  input: IdentifyInput,
): Promise<IdentifyOutput> {
  const warnings: string[] = [];

  /* 1 — OCR : un appel groupé quand le fournisseur le permet. */
  let ocrResults: { text: string; confidence: number }[];

  if (providers.ocr.extractMany) {
    try {
      ocrResults = await providers.ocr.extractMany(input.imageUrls);
    } catch (error) {
      warnings.push(`OCR indisponible (${providers.ocr.name})`);
      console.warn("[identify] OCR échoué", error);
      ocrResults = input.imageUrls.map(() => ({ text: "", confidence: 0 }));
    }
  } else {
    ocrResults = await Promise.all(
      input.imageUrls.map(async (url) => {
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

  const ocrText = ocrResults
    .map((r) => r.text)
    .filter((t) => t.trim().length > 0)
    .join("\n");
  const ocrConfidence =
    ocrResults.length > 0
      ? ocrResults.reduce((acc, r) => acc + r.confidence, 0) / ocrResults.length
      : 0;

  /* 2 — Archétype : texte OCR + saisie utilisateur. */
  const corpus = [input.userText ?? "", ocrText, ...ocrResults.map((r) => r.text)]
    .filter(Boolean)
    .join(" ");
  const archetype = buildArchetype({ text: corpus, fallbackCategory: input.category });

  /* 3 — Attributs et embeddings utilisateur (peuvent être vides). */
  // Une absence de données est acceptable ; une panne du fournisseur ne l'est
  // pas : elle produirait un score faussement bas. On la laisse remonter.
  const attributes: Attributes = await providers.attributes.describe(input.imageUrls);

  let embeddings: Embedding[] = [];
  try {
    embeddings = await providers.embeddings.embed(input.imageUrls);
  } catch (error) {
    warnings.push(`Embeddings indisponibles (${providers.embeddings.name})`);
    console.warn("[identify] embeddings échoués", error);
  }
  const userEmbedding = centroid(embeddings);

  /* 4 — Candidats fournisseurs. */
  const candidates = [];
  for (const source of providers.sources) {
    if (!source.available()) continue;
    try {
      const found = await source.search({ archetype, country: input.country, limit: 5 });
      candidates.push(...found);
    } catch (error) {
      warnings.push(`Source indisponible : ${source.name}`);
      console.warn("[identify] source échouée", source.name, error);
    }
  }

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
