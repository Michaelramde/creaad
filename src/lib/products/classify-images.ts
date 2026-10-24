/**
 * Classement des images par le modèle vision.
 *
 * La similarité d'embeddings mesure la *forme*, pas la *nature* : un logo Jeep
 * ressemble plus au sac orange qu'à rien d'autre. Le modèle, lui, distingue.
 *
 * Quatre natures, et non deux — parce qu'elles ne servent pas à la même chose :
 *
 *   packshot     produit seul, fond neutre      → montre la couleur, sert à détourer
 *   scene        produit porté ou en situation  → donne l'échelle, sert d'inspiration
 *   spec         produit + texte technique      → porte les dimensions (couleur connue)
 *   sans_produit logo, bannière, texte seul     → aucun produit, jamais dans une scène
 *
 * `spec` est la nuance qui manquait : ces images montrent le produit **et**
 * portent un tableau de mesures. Les jeter ferait perdre les dimensions ;
 * les traiter comme des packshots polluerait la galerie.
 */
import { generate, toInlinePart } from "../providers/gemini.ts";

export type ImageType = "packshot" | "scene" | "spec" | "sans_produit";

export interface ClassifiedImage {
  type: ImageType;
  /** Le produit est-il visible ? `sans_produit` est le seul cas négatif. */
  showsProduct: boolean;
  /** Coloris identifié, quand le produit est visible et la couleur lisible. */
  variantValueId?: string;
  /** L'image porte-t-elle du texte technique (mesures, tableau) ? */
  hasTechnicalText: boolean;
}

const PROMPT = (count: number, colours: string[]) => `Tu examines ${count} images d'un même produit, dans cet ordre.

Pour CHACUNE, réponds avec :
- "i" : son numéro (1 à ${count})
- "type" : exactement l'un de ces quatre mots :
    "packshot"     = le produit seul, posé, sur fond neutre
    "scene"        = le produit porté, utilisé, ou mis en situation réelle
    "spec"         = le PRODUIT EST VISIBLE **ET** l'image contient un tableau de mesures,
                     des cotes, ou une liste de spécifications
    "sans_produit" = aucun produit visible : logo, bannière marketing, bloc de texte, icônes
- "couleur" : la couleur du produit visible, exactement parmi ${colours.map((c) => `"${c}"`).join(", ")}, ou "aucune" si le produit n'est pas visible ou si sa couleur n'est pas identifiable
- "texte_technique" : true si l'image contient des mesures, dimensions ou un tableau de valeurs, sinon false

Attention : un logo de marque n'est PAS un packshot → "sans_produit".
Un collage de plusieurs vues du produit → "scene" si l'une est portée, sinon "packshot".

Réponds uniquement par un tableau JSON :
[{"i":1,"type":"packshot","couleur":"…","texte_technique":false}]

IMAGES :`;

function extractArray(raw: string): unknown[] {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const VALID: ImageType[] = ["packshot", "scene", "spec", "sans_produit"];

export async function classifyImages(input: {
  apiKey: string;
  urls: readonly string[];
  colours: readonly { valueId: string; name: string }[];
  model?: string;
  batchSize?: number;
}): Promise<Map<number, ClassifiedImage>> {
  const batchSize = input.batchSize ?? 8;
  const colourNames = input.colours.map((colour) => colour.name.replace(/^\d+\s*/, ""));
  const result = new Map<number, ClassifiedImage>();

  for (let offset = 0; offset < input.urls.length; offset += batchSize) {
    const batch = input.urls.slice(offset, offset + batchSize);

    const parts: unknown[] = [{ text: PROMPT(batch.length, colourNames) }];
    for (const url of batch) {
      try {
        parts.push(await toInlinePart(url));
      } catch {
        // Image inaccessible : elle ne sera pas classée, donc écartée.
      }
    }
    if (parts.length <= 1) continue;

    try {
      const raw = await generate(input.apiKey, input.model ?? "gemini-3.5-flash", parts, {
        responseMimeType: "application/json",
        temperature: 0,
      });

      for (const entry of extractArray(raw)) {
        const item = entry as {
          i?: number;
          type?: string;
          couleur?: string;
          texte_technique?: boolean;
        };
        const index = Number(item.i);
        if (!Number.isInteger(index) || index < 1 || index > batch.length) continue;

        const type = (VALID.includes(item.type as ImageType) ? item.type : "sans_produit") as ImageType;
        const showsProduct = type !== "sans_produit";

        const colourName = String(item.couleur ?? "").toLowerCase().trim();
        const colour = input.colours.find(
          (candidate) => candidate.name.replace(/^\d+\s*/, "").toLowerCase() === colourName,
        );

        result.set(offset + index - 1, {
          type,
          showsProduct,
          hasTechnicalText: Boolean(item.texte_technique) || type === "spec",
          ...(showsProduct && colour ? { variantValueId: colour.valueId } : {}),
        });
      }
    } catch (error) {
      console.warn(`[classify] lot ${offset / batchSize + 1} échoué : ${(error as Error).message}`);
    }
  }

  return result;
}
