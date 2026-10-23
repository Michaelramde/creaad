/**
 * Empreinte perceptuelle (dHash 64 bits) et détection de doublons.
 *
 * Deux usages critiques (SPEC §9.4 et §9.6) :
 *  1. dédupliquer les visuels d'une même annonce ;
 *  2. **détecter le faux consensus** — trois annonces qui reprennent la même
 *     photo ne sont pas trois sources, c'est une source recopiée.
 *
 * Le décodage d'image n'est pas fait ici : la fonction travaille sur des
 * niveaux de gris déjà extraits, ce qui la rend pure et testable.
 */

/**
 * dHash : redimensionne à 9×8, compare les pixels voisins horizontalement.
 * 64 bits → 16 caractères hexadécimaux.
 */
export function dhashFromGray(
  gray: readonly number[] | Uint8Array,
  width: number,
  height: number,
): string {
  if (width < 2 || height < 1 || gray.length < width * height) {
    throw new Error(`Image trop petite ou tampon incohérent (${width}×${height})`);
  }

  const W = 9;
  const H = 8;
  const sample = (x: number, y: number): number => {
    const sx = Math.min(width - 1, Math.floor((x * width) / W));
    const sy = Math.min(height - 1, Math.floor((y * height) / H));
    return gray[sy * width + sx] as number;
  };

  let bits = "";
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W - 1; x += 1) {
      bits += sample(x, y) < sample(x + 1, y) ? "1" : "0";
    }
  }

  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

/** Distance de Hamming entre deux empreintes hexadécimales. */
export function hammingHex(a: string, b: string): number {
  if (a.length !== b.length) throw new Error("Empreintes de tailles différentes");
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) {
    let x = parseInt(a[i] as string, 16) ^ parseInt(b[i] as string, 16);
    while (x) {
      distance += x & 1;
      x >>= 1;
    }
  }
  return distance;
}

export interface HashedImage {
  id: string;
  phash: string;
  /**
   * Identifiant de la provenance (annonce, fournisseur, utilisateur…).
   * À défaut, l'image est considérée comme sa propre source.
   */
  sourceId?: string;
}

export interface DedupResult<T extends HashedImage> extends HashedImage {
  image: T;
  /** Vrai si c'est la première occurrence de cette empreinte. */
  isDistinctSource: boolean;
  /** Identifiant de l'image dont celle-ci est une copie. */
  duplicateOf?: string;
}

/**
 * Marque les doublons. Une image n'est « source distincte » que si aucune
 * image d'une **autre provenance** ne lui ressemble à moins de `threshold` bits.
 * Les doublons internes à une même annonce sont ignorés pour le consensus,
 * mais restent disponibles pour la planche.
 */
export function dedupe<T extends HashedImage>(
  images: readonly T[],
  threshold = 6,
): DedupResult<T>[] {
  const results: DedupResult<T>[] = [];
  const accepted: DedupResult<T>[] = [];

  for (const image of images) {
    const source = image.sourceId ?? image.id;
    const twin = accepted.find(
      (a) => (a.sourceId ?? a.id) !== source && hammingHex(a.phash, image.phash) <= threshold,
    );

    if (twin) {
      // Copie d'une autre provenance : ce n'est pas une source supplémentaire.
      results.push({ ...image, image, isDistinctSource: false, duplicateOf: twin.id });
      continue;
    }

    const entry: DedupResult<T> = { ...image, image, isDistinctSource: true };
    accepted.push(entry);
    results.push(entry);
  }

  return results;
}

/** Nombre de sources réellement distinctes (borné par le nombre d'images). */
export function countDistinctSources(images: readonly HashedImage[], threshold = 6): number {
  return dedupe(images, threshold).filter((r) => r.isDistinctSource).length;
}
