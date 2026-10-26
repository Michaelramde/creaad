/**
 * Classification des hooks en familles d'angles — **repli déterministe**.
 *
 * Trois corrections par rapport à la version précédente, chacune mesurée
 * sur de vraies annonces ivoiriennes :
 *
 *  1. **NFKC avant NFD.** Les annonces utilisent des caractères « gras »
 *     (𝐋𝐄 𝐆𝐄𝐒𝐓𝐄, 𝟒.𝟗𝟗𝟗) que la normalisation ASCII supprimait entièrement :
 *     le hook devenait vide et tombait en « non classé ». NFKC les ramène
 *     à l'alphabet latin avant la suppression des accents.
 *  2. **Frontières de mot.** `text.includes("mon")` classait « Montre
 *     connectée » en témoignage. On compile désormais chaque motif en
 *     expression régulière ancrée.
 *  3. **Seuil conservateur (`MIN_SCORE = 2`).** Un seul indice faible ne
 *     suffit plus. En cas de doute on renvoie `non-classe`, qui est
 *     **exclu de la matrice** : mieux vaut amputer l'échantillon que
 *     d'inventer une famille — c'est la doctrine du produit.
 *
 * ⚠️ Ce module n'est plus le classifieur principal : `classify-llm.ts`
 * interroge le modèle une fois par hook unique et met le résultat en cache
 * permanent. Le repli sert quand le modèle est indisponible.
 */
import { normalize } from "../matching/text.ts";
import type { AngleFamily } from "./types.ts";

interface Rule {
  family: AngleFamily;
  patterns: string[];
  weight?: number;
}

/**
 * Ordre de spécificité, du plus fort au plus faible.
 * Sert **uniquement** à départager une égalité de score — jamais à classer.
 * L'ordre du tableau de règles ne doit plus décider à la place des données.
 */
const SPECIFICITY: AngleFamily[] = [
  "autorite",
  "comparaison",
  "garantie",
  "avant-apres",
  "preuve-sociale",
  "nouveaute",
  "urgence",
  "prix-offre",
  "identite",
  "demonstration",
  "probleme-solution",
  "temoignage",
];

const RULES: Rule[] = [
  {
    family: "preuve-sociale",
    patterns: [
      "deja", "clients", "clientes", "avis", "temoignage", "teste par",
      "recommande", "satisfait", "milliers", "personnes", "vendu",
      "customers", "reviews", "sold", "deja vu",
    ],
  },
  {
    family: "avant-apres",
    patterns: ["avant apres", "avant", "apres", "resultat", "transformation", "before", "after", "progress"],
    weight: 2,
  },
  {
    family: "probleme-solution",
    patterns: [
      "probleme", "solution", "fini", "marre", "souffre", "cause", "grace a",
      "resout", "empeche", "stop", "sans", "adieu", "envie de",
    ],
  },
  {
    family: "prix-offre",
    patterns: [
      "prix", "fcfa", "promo", "reduction", "remise", "gratuit", "offre",
      "solde", "pack", "lot", "livraison offerte", "discount", "free", "mille",
      "cadeau", "offerte",
    ],
    weight: 2,
  },
  {
    family: "autorite",
    patterns: [
      "dermatologue", "medecin", "pharmacien", "certifie", "labo", "clinique",
      "expert", "professionnel", "approuve", "norme", "fda", "dermatologist",
      "pharmacie", "laboratoire",
    ],
    weight: 2,
  },
  {
    family: "urgence",
    patterns: [
      "aujourd hui", "maintenant", "dernier", "stock", "limite", "avant rupture",
      "24h", "48h", "derniere chance", "last chance", "today", "urgent",
      "urgence", "2 jours", "derniers", "arrivage", "plus que", "trop tard", "stocks fondent",
    ],
    weight: 2,
  },
  {
    family: "demonstration",
    patterns: ["regarde", "voyez", "comment", "en 30 secondes", "demo", "essai", "application", "mode d emploi"],
  },
  {
    family: "temoignage",
    patterns: ["j ai", "je suis", "mon", "ma", "moi", "temoignage", "histoire", "i tried", "my"],
  },
  {
    family: "identite",
    patterns: [
      "pour les femmes", "pour les hommes", "maman", "jeune", "cadre", "business",
      "statut", "classe", "luxe", "respectable", "femme moderne", "ton niveau",
    ],
  },
  {
    family: "comparaison",
    patterns: ["contrairement", "mieux que", "vs", "compare", "difference", "au lieu de", "plutot que"],
  },
  {
    family: "garantie",
    patterns: [
      "garantie", "rembourse", "satisfait ou rembourse", "paiement a la livraison",
      "payez a la reception", "confiance", "retour", "guarantee", "garantis", "sav",
    ],
    weight: 2,
  },
  {
    family: "nouveaute",
    patterns: ["nouveau", "nouvelle", "innovation", "inedit", "premiere", "new", "revolutionnaire", "nouveaute", "enfin la"],
    weight: 2,
  },
];

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface CompiledPattern {
  text: string;
  re: RegExp;
}

interface CompiledRule {
  family: AngleFamily;
  weight: number;
  patterns: CompiledPattern[];
}

/** Un motif n'est reconnu que s'il est délimité par des espaces (ou les bords). */
const COMPILED: CompiledRule[] = RULES.map((rule) => ({
  family: rule.family,
  weight: rule.weight ?? 1,
  patterns: rule.patterns.map((pattern) => ({
    text: pattern,
    re: new RegExp(`(?:^|[^a-z0-9])${escapeRegex(pattern)}(?=[^a-z0-9]|$)`),
  })),
}));

/** Score minimal pour trancher. En dessous : `non-classe`, jamais une devinette. */
export const MIN_SCORE = 2;

export interface Classification {
  family: AngleFamily;
  score: number;
  matched: string[];
}

const UNCLASSIFIED: Classification = { family: "non-classe", score: 0, matched: [] };

export function classifyHook(hook: string | undefined): Classification {
  if (!hook || hook.trim().length === 0) return UNCLASSIFIED;

  const text = ` ${normalize(hook)} `;
  let best: Classification = UNCLASSIFIED;
  let bestSpecificity = SPECIFICITY.length;

  for (const rule of COMPILED) {
    const matched = rule.patterns.filter((pattern) => pattern.re.test(text)).map((p) => p.text);
    if (matched.length === 0) continue;

    // Un motif de plusieurs mots est plus discriminant qu'un mot isolé.
    const score =
      rule.weight * matched.reduce((acc, m) => acc + (m.includes(" ") ? 2 : 1), 0);

    const specificity = SPECIFICITY.indexOf(rule.family);
    const better =
      score > best.score || (score === best.score && specificity < bestSpecificity);

    if (better) {
      best = { family: rule.family, score, matched };
      bestSpecificity = specificity;
    }
  }

  // Le seuil s'applique APRÈS le départage : un score de 1 ne classe pas,
  // même s'il est le meilleur.
  return best.score >= MIN_SCORE ? best : UNCLASSIFIED;
}

/** Classe un lot et renvoie les hooks non classés, pour revue manuelle. */
export function classifyMany(
  hooks: readonly { id: string; hook?: string }[],
): { id: string; family: AngleFamily }[] {
  return hooks.map((h) => ({ id: h.id, family: classifyHook(h.hook).family }));
}
