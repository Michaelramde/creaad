/**
 * Embeddings d'images Gemini — 3072 dimensions, palier gratuit.
 *
 * C'est ce qui rend la **recherche par ressemblance** possible : un vecteur
 * par produit, calculé une fois à l'indexation, comparé ensuite en cosinus.
 * Évalué le 24/10 : 11 premiers voisins corrects sur 12, familles séparées
 * (sac↔sac 0,78-0,88 contre sac↔sérum ~0,61).
 */
import { logPipelineCost } from "../costs.ts";
import type { Embedding } from "../matching/types.ts";

export const EMBEDDING_MODEL = "gemini-embedding-2";

/**
 * Cache mémoire : la même photo est vectorisée deux fois par analyse — une
 * fois par la recherche visuelle, une fois pour le score d'appariement.
 * On garde les derniers vecteurs pour n'appeler le modèle qu'une seule fois.
 */
const cache = new Map<string, Embedding>();
const CACHE_MAX = 60;

function cached(url: string): Embedding | undefined {
  return cache.get(url);
}

function remember(url: string, vector: Embedding): Embedding {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(url, vector);
  return vector;
}

async function toBase64(url: string): Promise<{ mime: string; data: string }> {
  if (url.startsWith("data:")) {
    const match = /^data:([^;]+);base64,(.*)$/s.exec(url);
    if (!match) throw new Error("Data URL malformée");
    return { mime: match[1] as string, data: match[2] as string };
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
  if (!res.ok) throw new Error(`Image inaccessible (HTTP ${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return {
    mime: (res.headers.get("content-type") ?? "image/jpeg").split(";")[0] as string,
    data: buffer.toString("base64"),
  };
}

export async function embedImage(
  apiKey: string,
  url: string,
  model: string = EMBEDDING_MODEL,
): Promise<Embedding> {
  const hit = cached(url);
  if (hit) return hit;

  const image = await toBase64(url);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${model}`,
        content: { parts: [{ inline_data: { mime_type: image.mime, data: image.data } }] },
      }),
      signal: AbortSignal.timeout(45_000),
    },
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Embedding → HTTP ${res.status} : ${detail.slice(0, 160)}`);
  }

  const payload = (await res.json()) as { embedding?: { values?: number[] } };
  const values = payload.embedding?.values;
  if (!values || values.length === 0) throw new Error("Embedding vide");

  // Le palier gratuit rend l'appel gratuit, pas invisible : on compte les appels.
  void logPipelineCost({
    step: "embedding",
    provider: "gemini",
    model,
    costUsd: 0,
    estimated: true,
    tokensIn: values.length,
  });

  return remember(url, values);
}

/** Trois images en parallèle : au-delà, le palier gratuit proteste. */
export async function embedImages(
  apiKey: string,
  urls: readonly string[],
  model: string = EMBEDDING_MODEL,
): Promise<Embedding[]> {
  const out: Embedding[] = [];
  for (let i = 0; i < urls.length; i += 3) {
    const batch = urls.slice(i, i + 3);
    const vectors = await Promise.all(batch.map((url) => embedImage(apiKey, url, model)));
    out.push(...vectors);
  }
  return out;
}

/** Fournisseur d'embeddings du pipeline : c'est lui qui donne un vecteur aux photos du commerçant. */
export class GeminiEmbeddingProvider {
  readonly name = "gemini-embedding";
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async embed(urls: readonly string[]): Promise<Embedding[]> {
    return embedImages(this.apiKey, urls);
  }
}
