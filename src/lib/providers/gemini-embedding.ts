/**
 * Embeddings d'images Gemini — 3072 dimensions, palier gratuit.
 *
 * C'est ce qui rend la **recherche par ressemblance** possible : un vecteur
 * par produit, calculé une fois à l'indexation, comparé ensuite en cosinus.
 * Évalué le 24/10 : 11 premiers voisins corrects sur 12, familles séparées
 * (sac↔sac 0,78-0,88 contre sac↔sérum ~0,61).
 */
import type { Embedding } from "../matching/types.ts";

export const EMBEDDING_MODEL = "gemini-embedding-2";

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
  return values;
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
