/** Normalisation de texte — partagée par l'OCR, l'archétype et le scoring. */

const STOPWORDS = new Set([
  "le", "la", "les", "un", "une", "des", "de", "du", "et", "ou", "pour", "avec",
  "sans", "sur", "dans", "en", "au", "aux", "par", "the", "a", "an", "and", "or",
  "for", "with", "of", "to", "in", "on", "new", "hot", "top", "best", "qualité",
  "qualite", "nouveau", "nouvelle", "promo", "gratuit", "livraison", "gift",
]);

/** Minuscules, sans accents, sans ponctuation, espaces normalisés. */
export function normalize(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s.,+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(input: string): string[] {
  return normalize(input)
    .split(/[\s.,+-]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function tokenSet(input: string): Set<string> {
  return new Set(tokenize(input));
}

/** Jaccard sur les ensembles de tokens — 0 si l'un des deux est vide. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/**
 * Coefficient d'inclusion (Szymkiewicz–Simpson) : part du plus petit
 * ensemble retrouvée dans l'autre.
 *
 * Indispensable ici : le commerçant écrit « sérum vitamine c » quand
 * l'annonce titre 20 mots. Jaccard donnerait 0,1 alors que tout le texte
 * du commerçant est bien présent — on conclurait à tort à une absence de
 * correspondance.
 */
export function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / Math.min(a.size, b.size);
}

/**
 * Similarité cosinus. Renvoie `null` si l'un des vecteurs est vide ou
 * de norme nulle : absence de mesure, pas mesure de zéro.
 */
export function cosine(a: readonly number[] | undefined, b: readonly number[] | undefined): number | null {
  if (!a || !b || a.length === 0 || a.length !== b.length) return null;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return null;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Centroïde de plusieurs embeddings — repli sur le premier vecteur valide. */
export function centroid(vectors: readonly Embedding[]): Embedding | undefined {
  const valid = vectors.filter((v) => v.length > 0);
  if (valid.length === 0) return undefined;
  const dim = valid[0]!.length;
  const aligned = valid.filter((v) => v.length === dim);
  if (aligned.length === 0) return undefined;

  const out = new Array<number>(dim).fill(0);
  for (const v of aligned) for (let i = 0; i < dim; i += 1) out[i]! += v[i]!;
  for (let i = 0; i < dim; i += 1) out[i]! /= aligned.length;
  return out;
}

type Embedding = number[];

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
