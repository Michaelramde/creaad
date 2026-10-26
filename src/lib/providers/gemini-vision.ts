/**
 * Vision Gemini : deux jugements dont le pipeline a besoin et qu'aucun
 * embedding ne remplace sans dépendance lourde.
 *
 *  1. **Comparateur visuel** — « cette annonce montre-t-elle le même produit ? »
 *     Un seul appel pour tous les candidats, pas un par candidat.
 *  2. **Classificateur d'emplacements** — « quelle vue est cette photo ? »
 *     C'est ce qui permet de construire la planche sans métadonnées.
 */
import { DEFAULT_GEMINI_MODEL, generate, toInlinePart } from "./gemini.ts";

export interface VisualComparator {
  readonly name: string;
  compare(
    userImages: readonly string[],
    userText: string,
    candidates: readonly { id: string; imageUrl?: string; title: string }[],
  ): Promise<Map<string, { visual: number; text: number }>>;
}

export interface SlotClassifier {
  readonly name: string;
  /** index d'image → identifiant d'emplacement (ou `null` si aucun ne correspond). */
  classify(
    imageUrls: readonly string[],
    slots: readonly { id: string; label: string }[],
  ): Promise<Map<number, string | null>>;
}

const COMPARATOR_PROMPT =
  "Les premières images montrent UN produit de référence, photographié par un commerçant. " +
  "Pour chaque annonce candidate, deux notes de 0 à 100 :\n" +
  "`visual` — probabilité que la photo montre le MÊME produit (même forme, même packaging, " +
  "même marque, même variante). Sois strict : catégorie identique mais marque ou format " +
  "différent ne dépasse pas 35.\n" +
  "`text` — probabilité que le titre décrive le même produit que la description fournie, " +
  "MÊME SI LA LANGUE DIFFÈRE (vitamin/vitamine, face/visage, whitening/blanchissant).\n" +
  "Réponds uniquement en JSON.";

const COMPARATOR_SCHEMA = {
  type: "OBJECT",
  properties: {
    scores: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          visual: { type: "NUMBER" },
          text: { type: "NUMBER" },
        },
        required: ["id", "visual", "text"],
      },
    },
  },
  required: ["scores"],
};

export class GeminiVisualComparator implements VisualComparator {
  readonly name = "gemini-vision";
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string = DEFAULT_GEMINI_MODEL) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async compare(
    userImages: readonly string[],
    userText: string,
    candidates: readonly { id: string; imageUrl?: string; title: string }[],
  ): Promise<Map<string, { visual: number; text: number }>> {
    const result = new Map<string, { visual: number; text: number }>();
    if (candidates.length === 0) return result;

    const parts: unknown[] = [];

    if (userImages.length > 0) {
      parts.push({ text: "PRODUIT DE RÉFÉRENCE :" });
      for (const url of userImages.slice(0, 3)) {
        const inline = await toInlinePart(url, { maxPx: 640 }).catch(() => null);
        if (inline) parts.push(inline);
      }
    }

    parts.push({
      text: `DESCRIPTION FOURNIE PAR LE COMMERÇANT : "${userText.slice(0, 600)}"`,
    });

    /**
     * Cinq candidats suffisent : le classement en retient un, et le 6ᵉ ne
     * change jamais la décision. Huit coûtaient 15 s par analyse.
     */
    for (const candidate of candidates.slice(0, 5)) {
      parts.push({ text: `CANDIDAT ${candidate.id} — titre : "${candidate.title.slice(0, 300)}"` });
      if (candidate.imageUrl) {
        const inline = await toInlinePart(candidate.imageUrl, { maxPx: 640 }).catch(() => null);
        if (inline) parts.push(inline);
      }
    }

    parts.push({ text: COMPARATOR_PROMPT });

    const raw = await generate(this.apiKey, this.model, parts, {
      responseMimeType: "application/json",
      responseSchema: COMPARATOR_SCHEMA,
    }, { step: "visual-compare" });

    try {
      const parsed = JSON.parse(raw) as {
        scores?: { id?: string; visual?: number; text?: number }[];
      };
      for (const entry of parsed.scores ?? []) {
        if (typeof entry.id !== "string") continue;
        result.set(entry.id, {
          visual: Math.min(1, Math.max(0, (entry.visual ?? 0) / 100)),
          text: Math.min(1, Math.max(0, (entry.text ?? 0) / 100)),
        });
      }
    } catch {
      // Réponse illisible : aucune mesure. On ne devine pas un score.
    }

    return result;
  }
}

const SLOT_SCHEMA = {
  type: "OBJECT",
  properties: {
    slots: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { index: { type: "NUMBER" }, slot: { type: "STRING" } },
        required: ["index", "slot"],
      },
    },
  },
  required: ["slots"],
};

export class GeminiSlotClassifier implements SlotClassifier {
  readonly name = "gemini-slots";
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string = DEFAULT_GEMINI_MODEL) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async classify(
    imageUrls: readonly string[],
    slots: readonly { id: string; label: string }[],
  ): Promise<Map<number, string | null>> {
    const result = new Map<number, string | null>();
    if (imageUrls.length === 0) return result;

    const parts: unknown[] = [];
    // Les images doivent être envoyées dans l'ordre, avec leur index en clair.
    for (let i = 0; i < Math.min(imageUrls.length, 6); i += 1) {
      parts.push({ text: `IMAGE ${i} :` });
      const inline = await toInlinePart(imageUrls[i] as string).catch(() => null);
      if (inline) parts.push(inline);
    }

    parts.push({
      text:
        "Pour chaque image, indique l'emplacement qu'elle occupe parmi : " +
        slots.map((s) => `${s.id} (${s.label})`).join(", ") +
        ". Si aucune ne correspond, réponds \"aucun\". Une même photo ne peut pas avoir deux emplacements. " +
        "Réponds uniquement en JSON, avec l'index de l'image.",
    });

    const raw = await generate(this.apiKey, this.model, parts, {
      responseMimeType: "application/json",
      responseSchema: SLOT_SCHEMA,
    }, { step: "slots" });

    const known = new Set(slots.map((s) => s.id));
    try {
      const parsed = JSON.parse(raw) as { slots?: { index?: number; slot?: string }[] };
      for (const entry of parsed.slots ?? []) {
        if (typeof entry.index !== "number") continue;
        const slot = entry.slot && known.has(entry.slot) ? entry.slot : null;
        result.set(entry.index, slot);
      }
    } catch {
      // Aucun classement plutôt qu'un classement inventé.
    }

    return result;
  }
}
