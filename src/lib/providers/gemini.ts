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
import { logPipelineCost } from "../costs.ts";
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

/**
 * Modèles de repli. Les quotas Gemini sont **par modèle** : quand le principal
 * est saturé, un modèle plus léger répond encore. Constaté en production le
 * 24/10 : `gemini-3.5-flash` en 429, `gemini-3.5-flash-lite` disponible.
 */
export const GEMINI_FALLBACKS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];

/** Un appel modèle ne doit jamais bloquer un pipeline de bout en bout. */
const TIMEOUT_MS = 60_000;
function endpointFor(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

interface InlinePart {
  inline_data: { mime_type: string; data: string };
}

/**
 * Prépare une image pour un appel multimodal.
 *
 * Deux protections apprises en production le 26/10 :
 *  · **délai d'attente** — sans lui, une image candidate dont le CDN ne répond
 *    pas bloquait la fonction jusqu'à la coupure de la plateforme ;
 *  · **redimensionnement** — comparer 8 vignettes en pleine résolution coûtait
 *    15 s par analyse. À 640 px, la comparaison de forme est identique.
 *
 * `maxPx` reste optionnel : l'OCR et le classement des vues ont besoin de la
 * résolution d'origine.
 */
export async function toInlinePart(
  url: string,
  options: { maxPx?: number; timeoutMs?: number } = {},
): Promise<InlinePart> {
  if (url.startsWith("data:")) {
    const match = /^data:([^;]+);base64,(.*)$/s.exec(url);
    if (!match) throw new Error("Data URL malformée");
    return shrink({ inline_data: { mime_type: match[1] as string, data: match[2] as string } }, options.maxPx);
  }

  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  });
  if (!res.ok) throw new Error(`Image inaccessible (HTTP ${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get("content-type") ?? "image/jpeg";

  return shrink(
    { inline_data: { mime_type: mime.split(";")[0] as string, data: buffer.toString("base64") } },
    options.maxPx,
  );
}

/** Réduit une image avant envoi. Silencieux si `sharp` est indisponible. */
async function shrink(part: InlinePart, maxPx?: number): Promise<InlinePart> {
  if (!maxPx) return part;

  try {
    const mod = (await import("sharp")) as unknown as { default?: unknown };
    const sharp = (mod.default ?? mod) as (input: Buffer) => {
      metadata: () => Promise<{ width?: number; height?: number }>;
      resize: (opts: { width: number; height: number; fit: string }) => {
        jpeg: (opts: { quality: number }) => { toBuffer: () => Promise<Buffer> };
      };
    };

    const input = Buffer.from(part.inline_data.data, "base64");
    const meta = await sharp(input).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width <= maxPx && height <= maxPx) return part;

    const resized = await sharp(input)
      .resize({ width: maxPx, height: maxPx, fit: "inside" })
      .jpeg({ quality: 80 })
      .toBuffer();

    return { inline_data: { mime_type: "image/jpeg", data: resized.toString("base64") } };
  } catch {
    return part;
  }
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

/**
 * Contexte de coût. Sans lui, six appels par analyse resteraient invisibles :
 * c'est exactement le trou que l'audit avait relevé (logPipelineCost n'était
 * appelé que par Apify).
 */
export interface GeminiMeta {
  step: string;
  analysisId?: string;
}

/** Tarif public indicatif du palier payant — 0 tant que le palier gratuit tient. */
const PRICE_PER_MTOKENS = { input: 0.3, output: 2.5 };

export function geminiCostUsd(input: { in?: number; out?: number }, paid: boolean): number {
  if (!paid) return 0;
  const inCost = ((input.in ?? 0) / 1_000_000) * PRICE_PER_MTOKENS.input;
  const outCost = ((input.out ?? 0) / 1_000_000) * PRICE_PER_MTOKENS.output;
  return inCost + outCost;
}

const isPaidTier = () => process.env.GEMINI_PAID === "1" || process.env.GEMINI_PAID === "true";

/** Un appel, avec deux tentatives sur les erreurs transitoires. */
async function attemptModel(
  apiKey: string,
  model: string,
  body: string,
): Promise<{ text: string; usage: GeminiResponse["usageMetadata"] }> {
  const retryable = new Set([429, 500, 503]);
  let lastError: Error & { status?: number } = new Error("Gemini : échec inconnu");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await fetch(`${endpointFor(model)}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.ok) {
      const payload = (await res.json()) as GeminiResponse;
      const text = (payload.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("")
        .trim();
      return { text, usage: payload.usageMetadata };
    }

    const detail = await res.text().catch(() => "");
    lastError = Object.assign(
      new Error(`Gemini → HTTP ${res.status} : ${detail.slice(0, 200)}`),
      { status: res.status },
    );

    if (!retryable.has(res.status) || attempt === 1) throw lastError;
    await new Promise((r) => setTimeout(r, 1_500 * 2 ** attempt));
  }

  throw lastError;
}

export async function generate(
  apiKey: string,
  model: string,
  parts: unknown[],
  generationConfig?: Record<string, unknown>,
  meta?: GeminiMeta,
): Promise<string> {
  const body = JSON.stringify({
    contents: [{ role: "user", parts }],
    ...(generationConfig ? { generationConfig } : {}),
  });

  const models = [model, ...GEMINI_FALLBACKS.filter((m) => m !== model)];
  let lastError: Error & { status?: number } = new Error("Gemini : échec inconnu");

  for (const candidate of models) {
    try {
      const started = Date.now();
      const { text, usage } = await attemptModel(apiKey, candidate, body);
      const tokensIn = usage?.promptTokenCount;
      const tokensOut = usage?.candidatesTokenCount;
      // Journalisé même à 0 $ : le jour où le palier gratuit tombe, la ligne
      // existe déjà et la marge ne devient pas une surprise.
      void logPipelineCost({
        ...(meta?.analysisId ? { analysisId: meta.analysisId } : {}),
        step: meta?.step ?? "gemini",
        provider: "gemini",
        model: candidate,
        costUsd: geminiCostUsd({ in: tokensIn, out: tokensOut }, isPaidTier()),
        durationMs: Date.now() - started,
        estimated: !isPaidTier(),
        ...(tokensIn !== undefined ? { tokensIn } : {}),
        ...(tokensOut !== undefined ? { tokensOut } : {}),
      });
      return text;
    } catch (error) {
      lastError = error as Error & { status?: number };
      // 429 = quota du modèle atteint, 404 = modèle retiré : un autre peut répondre.
      // 401/400 = problème de clé ou de requête : inutile d'insister.
      if (lastError.status !== 429 && lastError.status !== 404) throw lastError;
      console.warn(`[gemini] ${candidate} indisponible (${lastError.status}), repli…`);
    }
  }

  throw lastError;
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
    }, { step: "ocr" });

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

    const parts = await Promise.all(imageUrls.slice(0, 4).map((url) => toInlinePart(url)));
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
      { step: "attributes" },
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

/* ═══════════════════════════════════════════════════════════════════════════
   LECTURE GROUPÉE — OCR + attributs en un seul appel
   ═══════════════════════════════════════════════════════════════════════════ */

const READER_SCHEMA = {
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
    attributes: {
      type: "OBJECT",
      properties: {
        color: { type: "STRING" },
        form: { type: "STRING" },
        category: { type: "STRING", enum: ["beaute", "cheveux", "mode", "gadgets"] },
        material: { type: "STRING" },
      },
    },
  },
  required: ["pages", "attributes"],
};

/**
 * Une seule lecture pour deux besoins.
 *
 * Avant : un appel OCR (6 images), puis un appel attributs (4 images) — les
 * mêmes pixels envoyés deux fois sur le réseau, deux fois facturés, deux fois
 * attendus. La latence du pipeline en dépendait directement.
 */
export class GeminiReaderProvider {
  readonly name = "gemini-reader";
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string = DEFAULT_GEMINI_MODEL) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async read(imageUrls: readonly string[]): Promise<{ ocr: OcrResult[]; attributes: Attributes }> {
    const urls = imageUrls.slice(0, 6);
    if (urls.length === 0) return { ocr: [], attributes: {} };

    const parts: unknown[] = [];
    for (let i = 0; i < urls.length; i += 1) {
      parts.push({ text: `IMAGE ${i} :` });
      const inline = await toInlinePart(urls[i] as string).catch(() => null);
      if (inline) parts.push(inline);
    }

    parts.push({
      text:
        "Deux tâches, un seul passage.\n" +
        "1. Transcris EXACTEMENT le texte lisible de chaque produit (étiquette, emballage, " +
        "mentions). Ne traduis pas, ne reformule pas, ne devine pas.\n" +
        "2. Décris le produit photographié : couleur dominante, forme, matière, catégorie.\n" +
        "Omets une clé d'attribut si l'information n'est pas visible — n'invente jamais.\n" +
        `Réponds en JSON : pages = un objet par image (index de 0 à ${urls.length - 1}, texte brut), ` +
        "attributes = uniquement des valeurs réellement visibles.",
    });

    const raw = await generate(
      this.apiKey,
      this.model,
      parts,
      { responseMimeType: "application/json", responseSchema: READER_SCHEMA },
      { step: "read" },
    );

    let pages: { index?: number; text?: string }[] = [];
    let attributes: Attributes = {};

    try {
      const parsed = JSON.parse(raw) as {
        pages?: { index?: number; text?: string }[];
        attributes?: Record<string, unknown>;
      };
      pages = parsed.pages ?? [];

      const pick = (key: string) =>
        typeof parsed.attributes?.[key] === "string" &&
        (parsed.attributes[key] as string).length > 0
          ? (parsed.attributes[key] as string)
          : undefined;

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
    } catch {
      // Réponse illisible : textes vides, aucun attribut. On ne devine pas.
    }

    const byIndex = new Map<number, string>();
    for (const page of pages) {
      if (typeof page.index === "number") byIndex.set(page.index, page.text ?? "");
    }

    return {
      ocr: urls.map((_, index) => {
        const text = byIndex.get(index) ?? "";
        return { text, confidence: text.length > 0 ? 1 : 0, provider: this.name };
      }),
      attributes,
    };
  }
}
