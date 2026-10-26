/**
 * Qualité mesurée d'une image — enfin autre chose qu'une taille de fichier.
 *
 * Le score de fidélité notait 50 points pour « combien de slots le modèle a
 * classés ». Autrement dit : il mesurait le classificateur, pas la photo.
 * Quatre photos mal classées mais bien remplies passaient à 87 ; trois photos
 * parfaites avec une vue manquante tombaient à 62.
 *
 * Ici, on mesure l'image elle-même, sur les pixels :
 *   · netteté        — variance du Laplacien (une photo floue a une variance faible)
 *   · fond           — écart-type des bords (fond neutre = détourage possible)
 *
 * `sharp` est fourni par Next (dépendance optionnelle, présente dans le
 * lockfile) ; s'il manque, on renvoie `null` et le score reste inchangé.
 */
export interface ImageQuality {
  /** Netteté normalisée 0 → 1. */
  sharpness: number;
  /** Uniformité du fond 0 → 1. */
  background: number;
  /** Synthèse 0 → 1, utilisée par le score de fidélité. */
  quality: number;
  width: number;
  height: number;
}

type Sharp = (input: Buffer) => {
  resize: (opts: { width?: number; height?: number; fit?: string }) => {
    greyscale: () => { raw: () => { toBuffer: (opts: { resolveWithObject: true }) => Promise<{ data: Buffer; info: { width: number; height: number } }> } };
  };
};

async function loadSharp(): Promise<Sharp | null> {
  try {
    const mod = (await import("sharp")) as unknown as { default?: Sharp } & Sharp;
    return (mod.default ?? mod) as Sharp;
  } catch {
    return null;
  }
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Variance du Laplacien sur l'image en niveaux de gris. */
export function laplacianVariance(gray: Uint8Array | Buffer, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;

  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const value =
        -4 * (gray[i] as number) +
        (gray[i - 1] as number) +
        (gray[i + 1] as number) +
        (gray[i - width] as number) +
        (gray[i + width] as number);
      sum += value;
      sumSq += value * value;
      count += 1;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  return Math.max(0, sumSq / count - mean * mean);
}

/** Écart-type des pixels de bord : un fond neutre donne une valeur faible. */
export function borderStdDev(gray: Uint8Array | Buffer, width: number, height: number): number {
  const band = Math.max(1, Math.round(Math.min(width, height) * 0.08));
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  const add = (x: number, y: number) => {
    const value = gray[y * width + x] as number;
    sum += value;
    sumSq += value * value;
    count += 1;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < band || x >= width - band || y < band || y >= height - band) add(x, y);
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  return Math.sqrt(Math.max(0, sumSq / count - mean * mean));
}

export function qualityFromPixels(
  gray: Uint8Array | Buffer,
  width: number,
  height: number,
): ImageQuality {
  const variance = laplacianVariance(gray, width, height);
  const edges = borderStdDev(gray, width, height);

  const sharpness = clamp01(1 - Math.exp(-variance / 300));
  const background = clamp01(1 - edges / 60);

  return {
    sharpness,
    background,
    quality: 0.65 * sharpness + 0.35 * background,
    width,
    height,
  };
}

/** Mesure une image distante (ou une data URL). Silencieux en cas d'échec. */
export async function measureImage(url: string): Promise<ImageQuality | null> {
  const sharp = await loadSharp();
  if (!sharp) return null;

  try {
    let buffer: Buffer;
    if (url.startsWith("data:")) {
      const base64 = url.split(",")[1] ?? "";
      buffer = Buffer.from(base64, "base64");
    } else {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
      if (!res.ok) return null;
      buffer = Buffer.from(await res.arrayBuffer());
    }

    // 512 px suffisent : au-delà, on mesure du bruit de compression.
    const { data, info } = await sharp(buffer)
      .resize({ width: 512, height: 512, fit: "inside" })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return qualityFromPixels(data, info.width, info.height);
  } catch {
    return null;
  }
}

/** Mesure un lot, en série : `sharp` sature vite en mémoire. */
export async function measureImages(
  urls: readonly string[],
): Promise<(ImageQuality | null)[]> {
  const out: (ImageQuality | null)[] = [];
  for (const url of urls) out.push(await measureImage(url));
  return out;
}
