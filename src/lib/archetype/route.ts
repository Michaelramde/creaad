/**
 * Routage du produit vers un marché **réellement collecté**.
 *
 * Un archétype n'a de valeur que s'il correspond à un marché qu'on a observé.
 * « mode-produit » ne renvoie rien parce que personne ne collecte ce mot — le
 * produit doit donc être rattaché à l'un des archétypes du catalogue.
 *
 * Deux couches :
 *   1. lexique déterministe (gratuit, instantané) ;
 *   2. un appel de modèle, **une seule fois par produit**, parmi une liste
 *      fermée de slugs connus. Le modèle n'a pas le droit d'en inventer un.
 */
import { buildArchetype, detectGender, type Archetype } from "./extract.ts";
import type { Category } from "../matching/types.ts";

export interface CatalogueEntry {
  slug: string;
  label: string;
  /** Nombre d'annonces déjà collectées : sert à départager. */
  ads: number;
}

export type RouteSource = "lexique" | "routeur" | "aucun";

export interface RouteResult {
  slug: string | null;
  source: RouteSource;
  reason?: string;
}

/** Le slug déterministe, ajusté au genre quand le catalogue le distingue. */
export function deterministicSlug(
  text: string,
  category: Category,
  catalogue: readonly CatalogueEntry[],
): { archetype: Archetype; slug: string } {
  const archetype = buildArchetype({ text, fallbackCategory: category });
  const slugs = new Set(catalogue.map((entry) => entry.slug));

  /**
   * Le genre est consulté **avant** le slug de base : « Women's bag » ne doit
   * pas tomber sur le marché « sac » masculin simplement parce que le slug nu
   * existe au catalogue.
   */
  const gender = detectGender(text);
  if (archetype.noun !== "produit") {
    if (gender === "feminin") {
      const feminine = `${category}-${archetype.noun}-femme`;
      if (slugs.has(feminine)) return { archetype, slug: feminine };
    }
    if (gender === "masculin") {
      const masculine = `${category}-${archetype.noun}-homme`;
      if (slugs.has(masculine)) return { archetype, slug: masculine };
    }
  }

  if (slugs.has(archetype.slug)) return { archetype, slug: archetype.slug };

  return { archetype, slug: archetype.slug };
}

export type AskModel = (prompt: string) => Promise<string>;

export function buildRouterPrompt(text: string, category: Category, catalogue: readonly CatalogueEntry[]): string {
  const list = catalogue.map((entry) => `- ${entry.slug} — ${entry.label} (${entry.ads} annonces)`).join("\n");

  return `Tu rattaches un produit à un marché publicitaire déjà observé.

Produit : « ${text.slice(0, 400)} »
Catégorie : ${category}

Marchés disponibles (slug — description) :
${list}

Règles :
- Choisis le marché qui décrit le mieux ce type de produit.
- Si aucun ne convient vraiment, réponds null : un mauvais rattachement vaut moins qu'aucun.
- N'invente jamais un slug hors de la liste.

Réponds uniquement en JSON : {"slug": "<slug>"} ou {"slug": null}`;
}

/**
 * Route le produit. `ask` est optionnel : sans lui, seul le lexique tranche.
 */
export async function routeArchetype(input: {
  text: string;
  category: Category;
  catalogue: readonly CatalogueEntry[];
  ask?: AskModel;
}): Promise<RouteResult> {
  const { text, category, catalogue, ask } = input;
  if (catalogue.length === 0) {
    return { slug: null, source: "aucun", reason: "Aucun marché collecté." };
  }

  const { archetype, slug } = deterministicSlug(text, category, catalogue);

  // Le lexique a reconnu un type de produit que l'on couvre.
  if (archetype.noun !== "produit" && catalogue.some((entry) => entry.slug === slug)) {
    return { slug, source: "lexique" };
  }

  if (!ask) {
    return {
      slug: null,
      source: "aucun",
      reason: "Type de produit non reconnu, et aucun routage disponible.",
    };
  }

  try {
    const raw = await ask(buildRouterPrompt(text, category, catalogue));
    const parsed = JSON.parse(extractJson(raw)) as { slug?: unknown };
    const chosen = typeof parsed.slug === "string" ? parsed.slug : null;

    // Liste fermée : tout slug inventé est rejeté.
    if (chosen && catalogue.some((entry) => entry.slug === chosen)) {
      return { slug: chosen, source: "routeur" };
    }

    return {
      slug: null,
      source: "aucun",
      reason: chosen
        ? `Le marché proposé (${chosen}) n'existe pas dans le catalogue.`
        : "Aucun marché connu ne correspond à ce produit.",
    };
  } catch (error) {
    return {
      slug: null,
      source: "aucun",
      reason: `Routage indisponible : ${(error as Error).message.slice(0, 120)}`,
    };
  }
}

/** Retire un éventuel bloc markdown autour du JSON. */
function extractJson(raw: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

/** Labels des archétypes, pour l'affichage. */
export function slugToLabel(slug: string): string {
  return slug.replace(/-/g, " ");
}
