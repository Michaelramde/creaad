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

const MODEL = "gemini-2.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export const GEMINI_MODEL = MODEL;

interface InlinePart {
  inline_data: { mime_type: string; data: string };
}

async function toInlinePart(url: string): Promise<InlinePart> {
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

async function generate(
  apiKey: string,
  parts: unknown[],
  generationConfig?: Record<string, unknown>,
): Promise<string> {
  const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      ...(generationConfig ? { generationConfig } : {}),
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini → HTTP ${res.status} : ${detail.slice(0, 200)}`);
  }

  const body = (await res.json()) as GeminiResponse;
  const text = (body.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();

  return text;
}

export class GeminiOcrProvider implements OcrProvider {
  readonly name = "gemini-ocr";
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async extract(imageUrl: string): Promise<OcrResult> {
    const image = await toInlinePart(imageUrl);

    const text = await generate(this.apiKey, [
      image,
      {
        text:
          "Transcris **exactement** le texte lisible sur ce produit (étiquette, emballage, " +
          "mentions). Ne traduis pas, ne reformule pas, ne devine pas. " +
          "Rends une ligne par bloc de texte, sans commentaire. " +
          "Si aucun texte n'est lisible, réponds une chaîne vide.",
      },
    ]);

    return { text, confidence: text.length > 0 ? 1 : 0, provider: this.name };
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

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async describe(imageUrls: readonly string[]): Promise<Attributes> {
    if (imageUrls.length === 0) return {};

    const parts = await Promise.all(imageUrls.slice(0, 4).map(toInlinePart));
    const raw = await generate(
      this.apiKey,
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
