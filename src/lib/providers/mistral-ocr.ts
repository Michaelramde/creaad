/**
 * OCR Mistral — utilisé en escalade quand Tesseract échoue ou doute (SPEC §5).
 *
 * Doc : POST https://api.mistral.ai/v1/ocr
 * Aucune clé n'étant disponible à ce stade, ce fournisseur n'est instancié
 * que si `MISTRAL_API_KEY` est présent. Il n'a pas encore été exercé en réel.
 */
import type { OcrResult } from "../matching/types.ts";
import type { OcrProvider } from "./types.ts";

const ENDPOINT = "https://api.mistral.ai/v1/ocr";

export class MistralOcrProvider implements OcrProvider {
  readonly name = "mistral-ocr";
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async extract(imageUrl: string): Promise<OcrResult> {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "mistral-ocr-latest",
        document: { type: "image_url", image_url: imageUrl },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Mistral OCR → HTTP ${res.status} : ${detail.slice(0, 200)}`);
    }

    const body = (await res.json()) as { pages?: { markdown?: string }[] };
    const text = (body.pages ?? [])
      .map((p) => p.markdown ?? "")
      .join("\n")
      .trim();

    // L'API n'expose pas de score de confiance : on ne prétend pas en avoir un.
    return { text, confidence: text.length > 0 ? 1 : 0, provider: this.name };
  }
}
