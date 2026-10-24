/**
 * Orchestration d'une analyse : identifier → planche → marché.
 *
 * Volontairement synchrone et sans file d'attente : l'ensemble tient en
 * quelques appels réseau (OCR, vision) et deux calculs purs. Une app
 * minimaliste n'a pas besoin d'un orchestrateur distribué.
 */
import type { CreativeStepResult } from "./creative.ts";
import { identifyProduct, type ProductIdentification } from "./identify-product.ts";
import { imagesForSelection } from "../products/images.ts";
import { getFreshRecord, upsertRecord } from "../products/records.ts";
import { needsVariantChoice } from "../products/types.ts";
import { routeArchetype } from "../archetype/route.ts";
import { loadCatalogue } from "../archetype/catalogue.ts";
import type { Archetype } from "../archetype/extract.ts";
import type { Providers } from "../providers/types.ts";
import { buildMatrixFor } from "../market/store.ts";

/**
 * Rattache le produit à un archétype du catalogue.
 *
 * Le calcul est fait **une seule fois par produit** : le résultat est écrit
 * dans la fiche, donc la reprise et les analyses suivantes n'y touchent plus.
 */
async function resolveProductArchetype(
  providers: Providers,
  product: ProductIdentification,
  category: Archetype["category"],
  warnings: string[],
): Promise<Archetype | null> {
  const record = product.record;

  // Déjà routé lors d'une analyse précédente.
  if (record.archetypeSlug) {
    return {
      slug: record.archetypeSlug,
      label: record.archetypeSlug.replace(/-/g, " "),
      category,
      noun: record.archetypeSlug.split("-").slice(1, -1).join(" ") || "produit",
    };
  }

  const catalogue = await loadCatalogue();
  const text = [record.title, ...Object.values(record.specs)].filter(Boolean).join(" ");

  const routed = await routeArchetype({
    text,
    category,
    catalogue,
    ...(providers.writer
      ? { ask: (prompt: string) => providers.writer!.write(prompt) }
      : {}),
  });

  if (!routed.slug) {
    warnings.push(routed.reason ?? "Aucun marché connu ne correspond à ce produit.");
    await upsertRecord({ ...record, archetypeSource: "aucun" });
    return null;
  }

  const entry = catalogue.find((candidate) => candidate.slug === routed.slug);
  await upsertRecord({ ...record, archetypeSlug: routed.slug, archetypeSource: routed.source });
  record.archetypeSlug = routed.slug;
  record.archetypeSource = routed.source;

  return {
    slug: routed.slug,
    label: entry?.label ?? routed.slug.replace(/-/g, " "),
    category,
    noun: routed.slug.split("-").slice(1, -1).join(" ") || "produit",
  };
}
import { buildPortfolio, type Portfolio } from "../market/portfolio.ts";
import type { SaturationMatrix } from "../market/types.ts";
import type { Category, Regime } from "../matching/types.ts";
import {
  identifyArticle,
  type IdentifyOutput,
} from "./identify.ts";
import { buildPlanStep, type PlanStepResult, type UserPhoto } from "./plan.ts";

export interface RunAnalysisInput {
  /** Catégorie de secours : le pipeline la déduit des photos et du texte. */
  category?: Category;
  regime?: Regime;
  country: string;
  photos: UserPhoto[];
  variantLabel?: string;
  userText?: string;
  /** Photo publique, pour la recherche inversée par Apify. */
  publicImageUrl?: string;
  /** Coloris retenu — présent uniquement à la reprise. */
  variantSelection?: Record<string, string[]>;
  /** Produit déjà identifié : la reprise ne relance aucune recherche payante. */
  productRef?: string;
  analysisId?: string;
}

export interface RunAnalysisResult {
  identify: IdentifyOutput;
  product?: ProductIdentification;
  plan?: PlanStepResult;
  market?: { matrix: SaturationMatrix; portfolio: Portfolio };
  creative?: CreativeStepResult;
  warnings: string[];
  /** Faux si l'analyse attend un choix de coloris ou s'arrête sur un refus. */
  blocked: boolean;
  /** Renseigné quand le commerçant doit choisir sa variante avant de continuer. */
  pendingVariant?: ProductIdentification;
}

export async function runAnalysis(
  providers: Providers,
  input: RunAnalysisInput,
): Promise<RunAnalysisResult> {
  const warnings: string[] = [];
  const regime: Regime = input.regime ?? "non_detenu";

  const identify = await identifyArticle(providers, {
    category: input.category ?? "beaute",
    regime,
    country: input.country,
    imageUrls: input.photos.map((p) => p.url),
    variantLabel: input.variantLabel,
    userText: input.userText,
  });
  warnings.push(...identify.warnings);

  /* ── produit exact : la voie payante, quand elle est disponible ──────── */
  let product: ProductIdentification | undefined;

  if (input.productRef) {
    // Reprise : on relit la fiche en cache, sans repayer la moindre recherche.
    const record = await getFreshRecord("aliexpress", input.productRef);
    if (record) {
      product = {
        hit: { productId: record.productId, title: record.title, url: record.url, rank: 1, isBestMatch: true },
        record,
        facts: record.facts,
        needsVariantChoice: needsVariantChoice(record.variantAxes),
        warnings: [],
        costUsd: 0,
        cached: true,
      };
    }
  } else if (providers.productPipeline && input.publicImageUrl) {
    try {
      const found = await identifyProduct(providers.productPipeline, {
        imageUrl: input.publicImageUrl,
        ...(input.analysisId ? { analysisId: input.analysisId } : {}),
      });
      if (found) {
        product = found;
        warnings.push(...found.warnings);

        // Le coloris est nécessaire pour savoir quoi montrer : on s'arrête ici.
        if (found.needsVariantChoice && !input.variantSelection) {
          return { identify, product: found, warnings, blocked: false, pendingVariant: found };
        }
      }
    } catch (error) {
      warnings.push("Identification produit indisponible — repli sur l'archétype.");
      console.warn("[run-analysis] produit non identifié", error);
    }
  }

  if (identify.blocked && !product) {
    return { identify, warnings, blocked: true };
  }

  /* ── marché : on rattache le produit à un archétype RÉELLEMENT collecté ── */
  // Sans ça, un titre anglais produisait « mode-produit » — un mot que
  // personne ne collecte, donc zéro annonce et aucune section « Convaincre ».
  const category = identify.archetype.category;

  if (product) {
    const routed = await resolveProductArchetype(providers, product, category, warnings);
    if (routed) identify.archetype = routed;
  }

  /**
   * Photos de la planche : celles du produit et de la variante choisie.
   *
   * On ne mélange pas les photos du commerçant avec la galerie : s'il a choisi
   * « marron » et photographié « noir », les deux ne peuvent pas coexister dans
   * une planche censée montrer un seul article.
   */
  const selectionImages = product
    ? imagesForSelection(product.record, input.variantSelection)
    : null;

  const planPhotos =
    selectionImages && selectionImages.images.length > 0
      ? selectionImages.images.map((image) => ({ url: image.url, width: image.width, height: image.height }))
      : input.photos;

  /* ── planche ─────────────────────────────────────────────────────────── */
  const plan = await buildPlanStep(providers, {
    category,
    regime,
    photos: planPhotos,
    labelOcrConfidence: identify.ocrConfidence,
    listingImages: identify.match.candidate?.images.map((i) => i.url) ?? [],
    ...(selectionImages?.variantImages[0]?.url
      ? { pinnedImageUrl: selectionImages.variantImages[0].url }
      : {}),
  });
  warnings.push(...plan.warnings);

  /* ── marché : ne dépend que de l'archétype, donc calculé avant tout refus ── */
  const { matrix } = await buildMatrixFor(identify.archetype.slug, input.country);
  const portfolio = buildPortfolio(matrix);

  if (!matrix.publishable) {
    warnings.push(
      `Données marché insuffisantes (${matrix.dataQuality.adsFound} annonces) — aucun angle n'est publié.`,
    );
  }

  // Planche refusée : on s'arrête avant la production, mais on rend quand même
  // les angles du marché — ils portent sur l'archétype, pas sur ces photos.
  // Priver le commerçant de tout après 30 s d'attente n'a aucune raison.
  if (!plan.plan.fidelity.gatePassed) {
    return { identify, ...(product ? { product } : {}), plan, market: { matrix, portfolio }, warnings, blocked: true };
  }

  /**
   * La rédaction du kit production **n'est plus dans le pipeline**.
   *
   * Elle est la seule étape lente qui ne bloque rien : la planche et le marché
   * sont déjà exploitables. On rend la main ici (≈35 s au lieu de ≈55 s) et
   * `repairCreativeKit` produit R3 après la réponse ; la page l'annonce puis
   * l'affiche dès qu'il arrive.
   */
  return {
    identify,
    ...(product ? { product } : {}),
    plan,
    market: { matrix, portfolio },
    warnings,
    blocked: false,
  };
}
