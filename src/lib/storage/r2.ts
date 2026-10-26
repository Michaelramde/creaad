/**
 * Stockage objet Cloudflare R2 — enfin utilisé.
 *
 * Les dépendances `@aws-sdk/client-s3` et `s3-request-presigner` étaient
 * installées (5,2 Mo) et **jamais importées** : les photos partaient en
 * base64 dans le corps de la requête, étaient stockées dans une colonne jsonb,
 * et le SPEC §5 (« aucun fichier image ne traverse une fonction Vercel »)
 * n'était pas respecté.
 *
 * Ici : l'URL présignée est calculée côté serveur, l'octet ne traverse jamais
 * la fonction. Aucune clé ne descend dans le navigateur.
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "@/lib/env";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_UPLOADS = 6;

/** Types acceptés : l'app ne produit que du JPEG côté client, on tolère plus. */
export const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

let client: S3Client | null = null;

/**
 * L'envoi n'exige **pas** de domaine public : le bucket peut rester privé.
 * `R2_PUBLIC_URL` n'est qu'une optimisation (le navigateur va chercher l'image
 * directement). Sans elle, les images sont servies par `/api/storage/…`.
 */
export function r2UploadConfigured(): boolean {
  return Boolean(
    env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET,
  );
}

/** Vrai si le navigateur peut lire l'objet sans passer par nous. */
export function r2HasPublicDomain(): boolean {
  return Boolean(env.R2_PUBLIC_URL);
}

export function r2Configured(): boolean {
  return r2UploadConfigured();
}

function getClient(): S3Client {
  if (!r2UploadConfigured()) throw new Error("R2 non configuré");
  if (client) return client;

  client = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID as string,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY as string,
    },
  });
  return client;
}

export interface PresignedUpload {
  key: string;
  /** URL d'envoi (PUT signé, valable 5 minutes). */
  uploadUrl: string;
  /**
   * URL de lecture de l'image : domaine public s'il est configuré, sinon
   * notre route de lecture (bucket privé, clé non devinable).
   */
  publicUrl: string;
  headers: Record<string, string>;
}

export async function presignUpload(input: {
  userId: string;
  contentType: string;
}): Promise<PresignedUpload> {
  const extension =
    input.contentType === "image/png" ? "png" : input.contentType === "image/webp" ? "webp" : "jpg";
  const key = `analyses/${input.userId}/${crypto.randomUUID()}.${extension}`;

  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: key,
    ContentType: input.contentType,
    CacheControl: "public, max-age=31536000, immutable",
  });

  const uploadUrl = await getSignedUrl(getClient(), command, { expiresIn: 300 });

  const publicUrl = r2HasPublicDomain()
    ? `${(env.R2_PUBLIC_URL as string).replace(/\/$/, "")}/${key}`
    : `${env.APP_URL.replace(/\/$/, "")}/api/storage/${key}`;

  return {
    key,
    uploadUrl,
    publicUrl,
    headers: { "Content-Type": input.contentType },
  };
}

/** Clé valide : uniquement les images déposées par l'application. */
export function isStorageKey(key: string): boolean {
  return /^analyses\/[a-zA-Z0-9_-]{4,64}\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(key);
}

/**
 * Lit un objet du bucket privé.
 *
 * Le bucket n'a pas besoin d'être public : la clé contient un UUID, donc elle
 * est aussi peu devinable qu'une URL signée — et elle n'expire pas, ce qui
 * compte pour des images affichées des mois plus tard.
 */
export async function readObject(
  key: string,
): Promise<{ body: Uint8Array; contentType: string } | null> {
  if (!r2UploadConfigured() || !isStorageKey(key)) return null;

  try {
    const res = await getClient().send(
      new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }),
    );
    if (!res.Body) return null;

    const bytes = await (res.Body as { transformToByteArray: () => Promise<Uint8Array> })
      .transformToByteArray();

    return { body: bytes, contentType: res.ContentType ?? "image/jpeg" };
  } catch (error) {
    console.warn("[r2] lecture impossible", key, error);
    return null;
  }
}
