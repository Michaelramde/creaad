/**
 * Classification des hooks en familles d'angles.
 *
 * Déterministe et auditable : chaque classement peut être justifié par les
 * motifs qui ont matché. Un futur classifieur LLM pourra s'y ajouter, mais
 * cette couche reste la référence pour les comptages.
 */
import { normalize } from "../matching/text.ts";
import type { AngleFamily } from "./types.ts";

interface Rule {
  family: AngleFamily;
  /** Motifs cherchés dans le texte normalisé. */
  patterns: string[];
  /** Poids : certains indices sont plus discriminants que d'autres. */
  weight?: number;
}

const RULES: Rule[] = [
  {
    family: "preuve-sociale",
    patterns: [
      "deja", "clients", "clientes", "avis", "temoignage", "teste par",
      "recommande", "satisfait", "milliers", "personnes", "vendu",
      "customers", "reviews", "sold",
    ],
  },
  {
    family: "avant-apres",
    patterns: ["avant", "apres", "avant/apres", "resultat", "transformation", "before", "after", "progress"],
    weight: 2,
  },
  {
    family: "probleme-solution",
    patterns: [
      "probleme", "solution", "fini", "marre", "souffre", "cause", "grace a",
      "resout", "empeche", "stop", "sans",
    ],
  },
  {
    family: "prix-offre",
    patterns: [
      "prix", "fcfa", "promo", "reduction", "remise", "gratuit", "offre",
      "solde", "pack", "lot", "livraison offerte", "discount", "free",
    ],
    weight: 2,
  },
  {
    family: "autorite",
    patterns: [
      "dermatologue", "medecin", "pharmacien", "certifie", "labo", "clinique",
      "expert", "professionnel", "approuve", "norme", "fda", "dermatologist",
    ],
    weight: 2,
  },
  {
    family: "urgence",
    patterns: [
      "aujourd hui", "maintenant", "dernier", "stock", "limite", "avant rupture",
      "24h", "48h", "derniere chance", "last chance", "today",
    ],
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
      "statut", "classe", "luxe", "respectable", "femme moderne",
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
      "payez a la reception", "confiance", "retour", "guarantee",
    ],
  },
  {
    family: "nouveaute",
    patterns: ["nouveau", "nouvelle", "innovation", "inedit", "premiere", "new", "revolutionnaire"],
  },
];

export interface Classification {
  family: AngleFamily;
  score: number;
  matched: string[];
}

/** Classe un hook ; `non-classe` si aucun motif ne ressort. */
export function classifyHook(hook: string | undefined): Classification {
  if (!hook || hook.trim().length === 0) {
    return { family: "non-classe", score: 0, matched: [] };
  }

  const text = ` ${normalize(hook)} `;
  let best: Classification = { family: "non-classe", score: 0, matched: [] };

  for (const rule of RULES) {
    const matched = rule.patterns.filter((p) => text.includes(p));
    if (matched.length === 0) continue;

    // Un motif long est plus discriminant qu'un mot isolé.
    const score =
      (rule.weight ?? 1) *
      matched.reduce((acc, m) => acc + (m.includes(" ") ? 2 : 1), 0);

    if (score > best.score) best = { family: rule.family, score, matched };
  }

  return best;
}

/** Classe un lot et renvoie les hooks non classés, pour revue manuelle. */
export function classifyMany(
  hooks: readonly { id: string; hook?: string }[],
): { id: string; family: AngleFamily }[] {
  return hooks.map((h) => ({ id: h.id, family: classifyHook(h.hook).family }));
}
