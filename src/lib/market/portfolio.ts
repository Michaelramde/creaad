/**
 * Portefeuille d'angles priorisé (SPEC §10).
 *
 * Ce que le commerçant doit lire n'est pas « voici le marché », mais :
 * **ce qui marche déjà, ce qui monte, ce qui est prouvé ailleurs et absent ici,
 * et ce que personne ne fait — dont on ne sait rien.**
 *
 * L'angle « prouvé et omniprésent » n'est jamais écarté : on différencie
 * l'exécution, on n'abandonne pas ce qui convertit.
 */
import { MARKET } from "./saturation.ts";
import type { AngleFamily, AngleStats, SaturationMatrix } from "./types.ts";

export type RecommendedAction =
  | "importer"
  | "tester-vite"
  | "garder-differencier"
  | "surveiller"
  | "ignorer";

export interface PortfolioEntry {
  family: AngleFamily;
  action: RecommendedAction;
  /** Faux pour `unobserved` : jamais présenté comme une opportunité. */
  recommended: boolean;
  priority: number;
  rationale: string;
  evidenceUrls: string[];
  figures: {
    ads: number;
    advertisers: number;
    medianDaysRunning: number;
    velocity: number | null;
    /** Preuve sur les marchés de référence, pour les angles importés. */
    referenceAdvertisers?: number;
    referenceMedianDaysRunning?: number;
  };
  notes: string[];
}

export interface Portfolio {
  publishable: boolean;
  /** Message de refus quand les données sont insuffisantes. */
  message?: string;
  entries: PortfolioEntry[];
  /** Angles prouvés ailleurs et non exploités localement. */
  whiteSpace: PortfolioEntry[];
  watchlist: PortfolioEntry[];
}

const ACTION_BY_STATUS: Record<AngleStats["status"], RecommendedAction> = {
  proven_elsewhere: "importer",
  rising: "tester-vite",
  proven_here: "garder-differencier",
  observed_unproven: "surveiller",
  unobserved: "ignorer",
};

/** Formule la raison **et** la nuance, sans jamais surinterpréter. */
function rationale(angle: AngleStats, referenceMarkets: readonly string[]): string {
  const adv = angle.advertisers.length;
  const days = Math.round(angle.medianDaysRunning);
  const elsewhere = referenceMarkets.length > 0 ? referenceMarkets.join(", ") : "un marché de référence";

  switch (angle.status) {
    case "proven_here":
      return `Prouvé ici : ${adv} annonceurs, ${days} jours de diffusion médiane. Ce n'est pas une raison de l'abandonner — c'est une raison de changer l'exécution : nouvelle preuve, nouvelle démonstration, nouveau format.`;
    case "proven_elsewhere":
      return `Prouvé sur ${elsewhere}, quasi absent ici (${adv} annonceur${adv > 1 ? "s" : ""} local). C'est une preuve décalée dans le temps, pas une invention : à importer et à adapter culturellement.`;
    case "rising":
      return `En montée : fréquence en accélération sur 30 jours avec ${adv} annonceurs. À tester vite, petit budget, avant que ce soit saturé.`;
    case "observed_unproven":
      return `Observé mais non prouvé : ${adv} annonceur${adv > 1 ? "s" : ""}, ${days} jours de diffusion médiane. Pas assez de recul pour conclure — ni à copier, ni à écarter.`;
    case "unobserved":
      return `Non observé dans nos sources. Ce n'est pas une opportunité : c'est une inconnue. Personne ne l'utilise peut-être parce que ça ne fonctionne pas.`;
  }
}

export function buildPortfolio(matrix: SaturationMatrix): Portfolio {
  if (!matrix.publishable) {
    return {
      publishable: false,
      message:
        `Données insuffisantes : ${matrix.dataQuality.adsFound} annonces exploitables ` +
        `(minimum ${MARKET.minAdsArchetype}). Aucune carte n'est publiée plutôt que d'en inventer une.`,
      entries: [],
      whiteSpace: [],
      watchlist: [],
    };
  }

  const entries: PortfolioEntry[] = matrix.angles
    // Jamais d'angle sans source : une affirmation sans preuve ne sort pas.
    .filter((a) => a.status !== "unobserved" || a.evidenceUrls.length > 0)
    .map((angle) => {
      const action = ACTION_BY_STATUS[angle.status];
      return {
        family: angle.family,
        action,
        recommended: angle.status !== "unobserved",
        priority: angle.priority,
        rationale: rationale(angle, matrix.referenceMarkets),
        evidenceUrls: angle.evidenceUrls,
        figures: {
          ads: angle.ads,
          advertisers: angle.advertisers.length,
          medianDaysRunning: angle.medianDaysRunning,
          velocity: Number.isFinite(angle.velocity ?? 0) ? angle.velocity : null,
          ...(angle.reference
            ? {
                referenceAdvertisers: angle.reference.advertisers.length,
                referenceMedianDaysRunning: angle.reference.medianDaysRunning,
              }
            : {}),
        },
        notes: angle.notes,
      };
    })
    .sort((a, b) => b.priority - a.priority);

  return {
    publishable: true,
    entries,
    whiteSpace: entries.filter((e) => e.action === "importer"),
    watchlist: entries.filter((e) => e.action === "tester-vite" || e.action === "surveiller"),
  };
}

/**
 * Vérifie qu'un portefeuille ne contient aucune affirmation non sourcée.
 * Utilisé comme garde-fou avant publication (et dans les tests).
 */
export function auditPortfolio(portfolio: Portfolio): string[] {
  const problems: string[] = [];
  if (!portfolio.publishable) return problems;

  for (const entry of portfolio.entries) {
    if (entry.evidenceUrls.length === 0) {
      problems.push(`Angle « ${entry.family} » sans URL source.`);
    }
    if (entry.action === "importer" && entry.figures.advertisers > 1) {
      problems.push(
        `Angle « ${entry.family} » marqué « à importer » alors que ${entry.figures.advertisers} annonceurs locaux existent.`,
      );
    }
    if (entry.action === "importer") {
      // La preuve d'un angle importé est la longévité **sur le marché de référence**.
      const days =
        entry.figures.referenceMedianDaysRunning ?? entry.figures.medianDaysRunning;
      if (days < 45) {
        problems.push(`Angle « ${entry.family} » importé sans preuve de longévité (${days} j).`);
      }
    }
    if (entry.action === "ignorer" && entry.recommended) {
      problems.push(`Angle « ${entry.family} » présenté comme recommandé alors qu'il est inconnu.`);
    }
  }

  return problems;
}
