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

  /* 1 — OCR : un échec par image ne fait pas échouer l'étape. */
  const ocrResults = await Promise.all(
    input.imageUrls.map(async (url) => {
      try {
        return await providers.ocr.extract(url);
      } catch (error) {
        warnings.push(`OCR indisponible sur une image (${providers.ocr.name})`);
        console.warn("[identify] OCR échoué", error);
        return { text: "", confidence: 0, provider: providers.ocr.name };
      }
    }),
  );

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
  let attributes: Attributes = {};
  try {
    attributes = await providers.attributes.describe(input.imageUrls);
  } catch (error) {
    warnings.push(`Attributs indisponibles (${providers.attributes.name})`);
    console.warn("[identify] attributs échoués", error);
  }

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
  const match = pickBest(
    {
      userText: corpus,
      userEmbedding,
      userAttributes: attributes,
      userVariant: compactVariant(parseVariantLabel(input.variantLabel)),
    },
    candidates,
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
