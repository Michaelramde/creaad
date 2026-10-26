/**
 * Zones marchés — le pays choisi, puis les marchés voisins, puis le monde.
 *
 * Extrait de `product-market.ts` parce que DEUX fonctions en ont besoin :
 * l'escalade des annonces produit et la matrice de référence (angles
 * « durables ailleurs »). Tant que cette table vivait dans un seul module,
 * `proven_elsewhere` n'a jamais pu être calculé.
 */

/** Le pays choisi en tête, puis les marchés les plus proches. */
export const ZONES: Record<string, string[]> = {
  CI: ["CI", "SN", "BF", "ML", "TG", "BJ", "CM"],
  SN: ["SN", "CI", "ML", "GN", "BJ", "TG", "BF"],
  CM: ["CM", "CI", "GA", "CG", "TD", "SN", "BJ"],
  BJ: ["BJ", "TG", "CI", "SN", "BF", "ML", "NE"],
  TG: ["TG", "BJ", "CI", "SN", "BF", "ML", "GH"],
  ML: ["ML", "CI", "SN", "BF", "GN", "NE", "BJ"],
  BF: ["BF", "CI", "ML", "SN", "TG", "BJ", "NE"],
};

export function zoneOf(country: string): string[] {
  return ZONES[country.toUpperCase()] ?? [country.toUpperCase()];
}

/**
 * Pays de référence pour une analyse : les voisins, **sans le pays cible**.
 *
 * Trois au maximum : au-delà, on additionne du bruit d'échantillon sans
 * gagner en significativité, et chaque pays coûte une requête.
 */
export function referenceCountriesFor(country: string, max = 3): string[] {
  const target = country.toUpperCase();
  return zoneOf(target).filter((code) => code !== target).slice(0, max);
}
