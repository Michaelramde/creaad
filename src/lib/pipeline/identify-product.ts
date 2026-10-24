/**
 * Identification du produit par l'image — la première étape de la chaîne.
 *
 * photo ─► produit exact (recherche inversée)
 *       ─► fiche complète (galerie, variantes, specs)
 *       ─► corroboration fournisseurs (dimensions, matière)
 *
 * Le résultat est mis en cache par `productId` : la deuxième analyse du même
 * produit ne repaie rien.
 */
import type { Facts } from "../products/types.ts";
import { corroborate, type RawFacts, type SourceFacts } from "../products/corroborate.ts";
import { factsFromProduct, parseDimensions } from "../products/parse-facts.ts";
import { buildImagePool } from "../products/normalize.ts";
import { needsVariantChoice, type ProductRecord } from "../products/types.ts";
import { upsertRecord } from "../products/records.ts";
import type { ApifyImageSearch, ImageSearchHit } from "../providers/image-search.ts";
import type { ApifyProductDetail } from "../providers/product-detail.ts";
import type { ApifySuppliers } from "../providers/suppliers.ts";
import type { OcrProvider } from "../providers/types.ts";

/**
 * Lit le texte des images de galerie (tableaux de mesures, mentions légales)
 * et en tire des faits mesurables. Silencieux en cas d'échec : un produit sans
 * dimension reste un produit utilisable.
 */
async function readGalleryText(
  pipeline: ProductPipeline,
  record: ProductRecord,
  warnings: string[],
): Promise<RawFacts> {
  if (!pipeline.ocr || record.gallery.length === 0) return {};

  const urls = record.gallery.slice(0, 4).map((image) => image.url);

  try {
    const texts = pipeline.ocr.extractMany
      ? (await pipeline.ocr.extractMany(urls)).map((result) => result.text)
      : await Promise.all(
          urls.map(async (url) => {
            try {
              return (await pipeline.ocr!.extract(url)).text;
            } catch {
              return "";
            }
          }),
        );

    const readable = texts.filter((text) => text.trim().length > 0);
    if (readable.length === 0) return {};

    const dimensions = parseDimensions(readable);
    const facts: RawFacts = {};
    if (dimensions.volumeMl !== undefined) facts.volumeMl = dimensions.volumeMl;
    if (dimensions.weightG !== undefined) facts.weightG = dimensions.weightG;
    if (dimensions.lengthWidthHeightMm !== undefined) {
      facts.lengthWidthHeightMm = dimensions.lengthWidthHeightMm;
    }
    return facts;
  } catch (error) {
    warnings.push("Lecture des tableaux de mesures indisponible.");
    console.warn("[identify-product] OCR galerie échoué", error);
    return {};
  }
}

export interface ProductPipeline {
  imageSearch: ApifyImageSearch;
  detail: ApifyProductDetail;
  suppliers: ApifySuppliers;
  /** Lecture des tableaux de mesures présents dans la galerie. */
  ocr?: OcrProvider;
}

export interface ProductIdentification {
  hit: ImageSearchHit;
  record: ProductRecord;
  facts: Facts;
  /** Vrai s'il faut demander le coloris avant de continuer. */
  needsVariantChoice: boolean;
  warnings: string[];
  costUsd: number;
  cached: boolean;
}

export async function identifyProduct(
  pipeline: ProductPipeline,
  input: { imageUrl: string; analysisId?: string },
): Promise<ProductIdentification | null> {
  const warnings: string[] = [];
  let costUsd = 0;

  /* 1 — La photo trouve le produit. */
  const search = await pipeline.imageSearch.search(input.imageUrl, {
    ...(input.analysisId ? { analysisId: input.analysisId } : {}),
  });
  costUsd += search.costUsd;
  if (search.warning) warnings.push(search.warning);

  if (search.hits.length === 0) return null;

  const hit = search.hits.find((candidate) => candidate.isBestMatch) ?? (search.hits[0] as ImageSearchHit);

  /* 2 — La fiche complète (ou le cache). */
  const detail = await pipeline.detail.fetch(
    { productId: hit.productId, url: hit.url },
    { ...(input.analysisId ? { analysisId: input.analysisId } : {}) },
  );
  costUsd += detail.costUsd;

  const record = detail.record;

  /* 3 — Faits : spécifications, puis lecture des tableaux de mesures. */
  const fromSpecs = factsFromProduct({ title: record.title, specs: record.specs });

  /**
   * Les dimensions manquent souvent des spécifications — mais le tableau de
   * mesures est presque toujours une image de la galerie. On lit ces images
   * une fois par produit, et on complète les faits.
   */
  const fromGallery = detail.cached ? {} : await readGalleryText(pipeline, record, warnings);

  const ownFacts: RawFacts = { ...fromSpecs, ...fromGallery };
  const sources: SourceFacts[] = [{ source: "aliexpress", facts: ownFacts }];

  /**
   * Fournisseurs Alibaba : **uniquement si une dimension manque encore**.
   *
   * Mesuré : cet appel coûte 0,101 $, soit 20 fois le prix annoncé, et plus
   * que la fiche entière. On ne le déclenche donc que lorsqu'il apporte
   * quelque chose — des dimensions absentes par ailleurs.
   */
  const missingDimensions =
    ownFacts.volumeMl === undefined &&
    ownFacts.weightG === undefined &&
    ownFacts.lengthWidthHeightMm === undefined;

  if (!detail.cached && missingDimensions) {
    try {
      const suppliers = await pipeline.suppliers.find(record.title, {
        ...(input.analysisId ? { analysisId: input.analysisId } : {}),
      });
      costUsd += suppliers.costUsd;
      if (suppliers.warning) warnings.push(suppliers.warning);
      if (Object.keys(suppliers.facts).length > 0) {
        sources.push({ source: "alibaba", facts: suppliers.facts });
      }
    } catch (error) {
      warnings.push("Corroboration fournisseur indisponible.");
      console.warn("[identify-product] fournisseurs échoués", error);
    }
  }

  const facts = detail.cached ? record.facts : corroborate(sources);

  /* 4 — Pool d'images : coloris épinglés, puis galerie. */
  const variantImages = record.variantAxes.flatMap((axis) =>
    axis.values.map((value) => value.image).filter((url): url is string => Boolean(url)),
  );

  const enriched: ProductRecord = {
    ...record,
    facts,
    images: buildImagePool({ gallery: record.gallery, variantImages }),
  };

  if (!detail.cached) await upsertRecord(enriched);

  return {
    hit,
    record: enriched,
    facts,
    needsVariantChoice: needsVariantChoice(enriched.variantAxes),
    warnings,
    costUsd,
    cached: detail.cached,
  };
}
