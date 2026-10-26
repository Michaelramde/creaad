/**
 * Routage produit → marché, par recouvrement de vocabulaire explicite.
 *
 * Pourquoi pas des embeddings : le catalogue fait **16 entrées**. Un vecteur
 * apporte un appel réseau, une latence, une dépendance et un coût, pour un
 * problème que 16 listes de mots résolvent mieux — et de façon vérifiable
 * hors ligne. Les embeddings restent la bonne réponse pour `product_index`
 * (des milliers d'images), pas pour un catalogue fini.
 *
 * Contrat : **jamais confiant et faux.** En cas d'ambiguïté, on renvoie
 * `ambiguous` et l'appelant décide (arbitrage modèle, ou « marché non couvert »).
 */
import { normalize, tokenize } from "../matching/text.ts";
import type { Category } from "../matching/types.ts";
import type { MarketEntry } from "./market-catalogue.ts";

export type ResolveSource = "exact" | "score" | "ambiguous" | "none";

export interface ResolveResult {
  slug: string | null;
  source: ResolveSource;
  score: number;
  /** Écart avec le deuxième candidat : mesure la confiance. */
  margin: number;
  candidates: { slug: string; score: number }[];
  reason?: string;
}

/** En dessous, aucun marché ne correspond honnêtement. */
export const MIN_SCORE = 0.5;
/** En dessous, deux marchés se disputent la réponse : on n'arbitre pas seul. */
export const MIN_MARGIN = 0.04;

/**
 * Un terme est présent s'il apparaît en mots entiers (les accents sont déjà
 * retirés). On tolère le pluriel simple : « sneaker » doit reconnaître
 * « Sneakers men running », sinon le marché n'est jamais trouvé.
 */
function containsPhrase(text: string, phrase: string): boolean {
  const base = normalize(phrase);
  const variants = new Set([base]);
  if (base.endsWith("s")) variants.add(base.slice(0, -1));
  else variants.add(`${base}s`);
  return [...variants].some((variant) => text.includes(` ${variant} `));
}

function coverage(entry: MarketEntry, text: string): { score: number; matched: number } {
  const nouns = entry.nouns.filter((noun) => containsPhrase(text, noun));
  if (nouns.length === 0) return { score: 0, matched: 0 };

  let matchedModifiers = 0;
  if (entry.modifiers.length === 0) {
    // Un marché générique ne peut pas se prévaloir d'un modificateur : on le
    // pénalise légèrement pour qu'un marché spécifique gagne quand son
    // modificateur est présent.
    matchedModifiers = 0;
  } else {
    matchedModifiers = entry.modifiers.filter((modifier) => containsPhrase(text, modifier)).length;
  }

  /**
   * Les modificateurs sont des ALTERNATIVES, pas une conjonction : « femme »
   * suffit à désigner le marché féminin, inutile d'exiger « dame » et
   * « ladies » en même temps. Un marché dont aucun modificateur n'apparaît
   * est pénalisé, mais reste candidat (le libellé peut être muet).
   */
  const modCoverage = entry.modifiers.length === 0 ? 0.8 : matchedModifiers > 0 ? 1 : 0.2;

  return { score: 0.45 + 0.4 * modCoverage, matched: matchedModifiers };
}

export function resolveArchetype(input: {
  text: string;
  category?: Category;
  catalogue: readonly MarketEntry[];
  /** Slug produit par l'ancienne heuristique : accepté s'il est au catalogue. */
  exactSlug?: string;
}): ResolveResult {
  const known = new Set(input.catalogue.map((entry) => entry.slug));

  if (input.exactSlug && known.has(input.exactSlug)) {
    return {
      slug: input.exactSlug,
      source: "exact",
      score: 1,
      margin: 1,
      candidates: [{ slug: input.exactSlug, score: 1 }],
    };
  }

  const text = ` ${normalize(input.text)} `;
  const tokens = new Set(tokenize(input.text));
  if (tokens.size === 0) {
    return { slug: null, source: "none", score: 0, margin: 0, candidates: [], reason: "Texte vide." };
  }

  const scored = input.catalogue
    .map((entry) => {
      const { score, matched } = coverage(entry, text);
      const categoryBonus = input.category && entry.category === input.category ? 0.15 : 0;
      return { slug: entry.slug, score: Math.min(1, score + categoryBonus), matched };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.matched - a.matched || a.slug.localeCompare(b.slug));

  const best = scored[0];
  if (!best) {
    return {
      slug: null,
      source: "none",
      score: 0,
      margin: 0,
      candidates: [],
      reason: "Aucun marché ne correspond à ce produit.",
    };
  }

  const second = scored[1];
  const margin = second ? best.score - second.score : 1;

  if (best.score < MIN_SCORE) {
    return {
      slug: null,
      source: "none",
      score: best.score,
      margin,
      candidates: scored.slice(0, 3),
      reason: `Correspondance trop faible (${best.score.toFixed(2)}).`,
    };
  }

  if (second && margin < MIN_MARGIN) {
    return {
      slug: null,
      source: "ambiguous",
      score: best.score,
      margin,
      candidates: scored.slice(0, 3),
      reason: `Deux marchés se disputent la réponse : ${best.slug} et ${second.slug}.`,
    };
  }

  return {
    slug: best.slug,
    source: "score",
    score: best.score,
    margin,
    candidates: scored.slice(0, 3),
  };
}
