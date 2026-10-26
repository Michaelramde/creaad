/** Rédacteur Gemini pour le kit production. */
import { DEFAULT_GEMINI_MODEL, generate } from "./gemini.ts";
import type { CreativeWriter } from "../pipeline/creative.ts";

export class GeminiCreativeWriter implements CreativeWriter {
  readonly name = "gemini-writer";
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string = DEFAULT_GEMINI_MODEL) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async write(prompt: string, meta?: { step?: string; analysisId?: string }): Promise<string> {
    return generate(
      this.apiKey,
      this.model,
      [{ text: prompt }],
      { responseMimeType: "application/json", temperature: 0.8 },
      {
        step: meta?.step ?? "creative",
        ...(meta?.analysisId ? { analysisId: meta.analysisId } : {}),
      },
    );
  }
}
