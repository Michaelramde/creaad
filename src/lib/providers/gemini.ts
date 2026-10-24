/**
 * Fournisseur Gemini — l'option gratuite pour lire les photos.
 *
 * Un seul modèle multimodal assure l'OCR **et** l'extraction d'attributs.
 * C'est le meilleur rapport qualité/effort quand on n'a pas de budget OCR :
 * aucune infra à héberger, et le palier gratuit de Google AI Studio suffit
 * largement pour développer.
 *
 * ⚠️ Deux réserves à connaître :
 *  - le palier gratuit peut réutiliser les données envoyées pour améliorer
 *    les modèles — à ne pas utiliser tel quel avec des photos sensibles en
 *    production ;
 *  - les quotas sont par minute et par jour : d'où le cache par archétype.
 *
 * Alternative 100 % hors ligne : Tesseract.js (moins bon sur les packagings
 * stylisés). Alternative auto-hébergée de meilleure qualité : PaddleOCR /
 * RapidOCR via ONNX, sur un petit worker.
 */
import type { OcrResult } from "../matching/types.ts";
import type { Attributes } from "../matching/types.ts";
import type { AttributeProvider, OcrProvider } from "./types.ts";

/**
 * Modèle par défaut. Google retire régulièrement d'anciens modèles pour les
 * nouveaux comptes (`gemini-2.5-flash` répond 404 aujourd'hui) : la valeur est
 * surchargeable par `GEMINI_MODEL` sans toucher au code.
 *
 * Liste à jour : `GET /v1beta/models?key=...` → `scripts/list-models.mjs`.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";

/** Un appel modèle ne doit jamais bloquer un pipeline de bout en bout. */
const TIMEOUT_MS = 60_000;

function endpointFor(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

interface InlinePart {
  inline_data: { mime_type: string; data: string };
}

export async function toInlinePart(url: string): Promise<InlinePart> {
  if (url.startsWith("data:")) {
    const match = /^data:([^;]+);base64,(.*)$/s.exec(url);
    if (!match) throw new Error("Data URL malformée");
    return { inline_data: { mime_type: match[1] as string, data: match[2] as string } };
  }

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Image inaccessible (HTTP ${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get("content-type") ?? "image/jpeg";
  return { inline_data: { mime_type: mime.split(";")[0] as string, data: buffer.toString("base64") } };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

export async function generate(
  apiKey: string,
  model: string,
  parts: unknown[],
  generationConfig?: Record<string, unknown>,
): Promise<string> {
  const body = JSON.stringify({
    contents: [{ role: "user", parts }],
    ...(generationConfig ? { generationConfig } : {}),
  });

  // 429 et 503 sont fréquents chez Gemini (« high demand ») : on réessaie
  // avant de déclarer l'étape en échec.
  const retryable = new Set([429, 500, 503]);
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(`${endpointFor(model)}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.ok) {
      const payload = (await res.json()) as GeminiResponse;
      return (payload.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("")
        .trim();
    }

    const detail = await res.text().catch(() => "");
    lastError = new Error(`Gemini → HTTP ${res.status} : ${detail.slice(0, 200)}`);

    if (!retryable.has(res.status) || attempt === 2) throw lastError;
    await new Promise((r) => setTimeout(r, 1_500 * 2 ** attempt));
  }

  throw lastError ?? new Error("Gemini : échec inconnu");
}

export class GeminiOcrProvider implements OcrProvider {
  readonly name = "gemini-ocr";
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string = DEFAULT_GEMINI_MODEL) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async extract(imageUrl: string): Promise<OcrResult> {
    const [result] = await this.extractMany([imageUrl]);
    return result as OcrResult;
  }

  /** Un appel pour toutes les photos — le quota est la ressource rare. */
  async extractMany(imageUrls: readonly string[]): Promise<OcrResult[]> {
    const urls = imageUrls.slice(0, 6);
    if (urls.length === 0) return [];

    const parts: unknown[] = [];
    for (let i = 0; i < urls.length; i += 1) {
      parts.push({ text: `IMAGE ${i} :` });
      const inline = await toInlinePart(urls[i] as string).catch(() => null);
      if (inline) parts.push(inline);
    }

    parts.push({
      text:
        "Transcris **exactement** le texte lisible sur chaque produit (étiquette, emballage, " +
        "mentions). Ne traduis pas, ne reformule pas, ne devine pas. " +
        `Réponds en JSON : un objet par image, index ${urls.map((_, i) => i).join(", ")}, ` +
        "avec le texte brut (chaîne vide si rien n'est lisible).",
    });

    const raw = await generate(this.apiKey, this.model, parts, {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          pages: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { index: { type: "NUMBER" }, text: { type: "STRING" } },
              required: ["index", "text"],
            },
          },
        },
        required: ["pages"],
      },
    });

    const byIndex = new Map<number, string>();
    try {
      const parsed = JSON.parse(raw) as { pages?: { index?: number; text?: string }[] };
      for (const page of parsed.pages ?? []) {
        if (typeof page.index === "number") byIndex.set(page.index, page.text ?? "");
      }
    } catch {
      // Réponse illisible : on renvoie des textes vides, jamais du contenu inventé.
    }

    return urls.map((_, index) => {
      const text = byIndex.get(index) ?? "";
      return { text, confidence: text.length > 0 ? 1 : 0, provider: this.name };
    });
  }
}

const ATTRIBUTE_SCHEMA = {
  type: "OBJECT",
  properties: {
    color: { type: "STRING" },
    form: { type: "STRING" },
    category: { type: "STRING", enum: ["beaute", "cheveux", "mode", "gadgets"] },
    material: { type: "STRING" },
  },
};

export class GeminiAttributeProvider implements AttributeProvider {
  readonly name = "gemini-attributes";
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string = DEFAULT_GEMINI_MODEL) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async describe(imageUrls: readonly string[]): Promise<Attributes> {
    if (imageUrls.length === 0) return {};

    const parts = await Promise.all(imageUrls.slice(0, 4).map(toInlinePart));
    const raw = await generate(
      this.apiKey,
      this.model,
      [
        ...parts,
        {
          text:
            "Décris le produit photographié. Réponds uniquement en JSON avec les clés " +
            "`color` (couleur dominante du produit), `form` (forme du contenant ou de l'objet), " +
            "`category`, `material`. Omets une clé si l'information n'est pas visible — " +
            "n'invente jamais.",
        },
      ],
      { responseMimeType: "application/json", responseSchema: ATTRIBUTE_SCHEMA },
    );

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const pick = (key: string) =>
        typeof parsed[key] === "string" && (parsed[key] as string).length > 0
          ? (parsed[key] as string)
          : undefined;

      const attributes: Attributes = {};
      const color = pick("color");
      const form = pick("form");
      const material = pick("material");
      const category = pick("category");
      if (color) attributes.color = color;
      if (form) attributes.form = form;
      if (material) attributes.material = material;
      if (category === "beaute" || category === "cheveux" || category === "mode" || category === "gadgets") {
        attributes.category = category;
      }
      return attributes;
    } catch {
      // Une réponse illisible ne devient pas une donnée : on ne retourne rien.
      return {};
    }
  }
}
