/**
 * Classement des images par le modèle vision.
 *
 * La similarité d'embeddings mesure la *forme*, pas la *nature* : un logo Jeep
 * ressemble plus au sac orange qu'à rien d'autre, et un gros plan du sac noir
 * tombe sous le seuil. Le modèle, lui, distingue ce que la géométrie confond.
 *
 * Gratuit, par lots de 8 images.
 */
import { generate, toInlinePart } from "../providers/gemini.ts";

export type ImageType = "produit" | "portee" | "tableau" | "logo" | "banniere" | "montage";

export interface ClassifiedImage {
  kind: "produit" | "technique";
  variantValueId?: string;
  type: ImageType;
}

const PROMPT = (count: number, colours: string[]) => `Tu examines ${count} images d'un même produit, dans cet ordre.

Pour CHACUNE, réponds avec :
- "i" : son numéro (1 à ${count})
- "type" : exactement l'un de ces mots :
    "produit"   = le produit photographié seul, sur fond neutre
    "portee"    = le produit porté ou utilisé par une personne
    "tableau"   = tableau de mesures, schéma technique, liste de spécifications
    "logo"      = logo, emblème, marque
    "banniere"  = visuel marketing avec beaucoup de texte, promotions, icônes
    "montage"   = plusieurs vues assemblées dans une même image
- "couleur" : la couleur du produit visible, exactement parmi ${colours.map((c) => `"${c}"`).join(", ")}, ou "aucune" si le produit n'est pas visible

Réponds uniquement par un tableau JSON : [{"i":1,"type":"produit","couleur":"…"}]

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
        // Image inaccessible : elle sera traitée en technique plus bas.
      }
    }

    if (parts.length <= 1) continue;

    try {
      const raw = await generate(input.apiKey, input.model ?? "gemini-3.5-flash", parts, {
        responseMimeType: "application/json",
        temperature: 0.1,
      });

      for (const entry of extractArray(raw)) {
        const item = entry as { i?: number; type?: string; couleur?: string };
        const index = Number(item.i);
        if (!Number.isInteger(index) || index < 1 || index > batch.length) continue;

        const type = (item.type ?? "tableau") as ImageType;
        const showsProduct = type === "produit" || type === "portee";
        const colourName = String(item.couleur ?? "").toLowerCase();

        const colour = input.colours.find(
          (candidate) => candidate.name.replace(/^\d+\s*/, "").toLowerCase() === colourName,
        );

        result.set(offset + index - 1, {
          type,
          kind: showsProduct ? "produit" : "technique",
          // Un produit sans couleur identifiable (montage, couleur douteuse)
          // reste une image qu'on garde, mais non rattachée à un coloris.
          ...(showsProduct && colour ? { variantValueId: colour.valueId } : {}),
        });
      }
    } catch (error) {
      console.warn(`[classify] lot ${offset / batchSize + 1} échoué : ${(error as Error).message}`);
    }
  }

  return result;
}
