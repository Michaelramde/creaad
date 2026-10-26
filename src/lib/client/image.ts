/**
 * Compression côté client — une fonctionnalité, pas une optimisation.
 *
 * Six photos de téléphone pèsent 20-30 Mo. Sur un forfait mobile ouest-africain,
 * envoyer ça tel quel coûte cher au commerçant et fait échouer l'upload.
 */
export interface CompressedImage {
  /** URL `data:` utilisable en démonstration, ou blob à remplacer par R2. */
  dataUrl: string;
  bytes: number;
  width: number;
  height: number;
}

const MAX_INPUT_BYTES = 25 * 1024 * 1024;

export async function compressImage(
  file: File,
  options: { maxSide?: number; quality?: number } = {},
): Promise<CompressedImage> {
  const maxSide = options.maxSide ?? 1280;
  const quality = options.quality ?? 0.72;

  if (file.size > MAX_INPUT_BYTES) {
    throw new Error("Image trop lourde (25 Mo maximum).");
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponible sur cet appareil.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const bytes = Math.round((dataUrl.length - "data:image/jpeg;base64,".length) * 0.75);

  return { dataUrl, bytes, width, height };
}

/** Convertit une data URL en Blob, pour l'envoi direct vers R2. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, base64] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(meta ?? "")?.[1] ?? "image/jpeg";
  const binary = atob(base64 ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}
