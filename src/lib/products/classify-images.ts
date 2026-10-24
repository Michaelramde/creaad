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

export type ImageType = "packshot" | "scene" | "spec" | "marketing" | "sans_produit";

export interface ClassifiedImage {
  type: ImageType;
  /** Le produit est-il visible ? `sans_produit` et `marketing` sont négatifs. */
  showsProduct: boolean;
  /** Coloris identifié, quand le produit est visible et la couleur lisible. */
  variantValueId?: string;
  /** L'image porte-t-elle du texte technique (mesures, tableau) ? */
  hasTechnicalText: boolean;
}

const PROMPT = (count: number, colours: string[]) => `Tu tries ${count} images d'un même produit.

CINQ catégories, à choisir exactement :

"packshot"
  Le produit seul, posé, sur fond neutre.
  Ex. : un sac sur fond blanc ; un gros plan de la fermeture du sac.

"scene"
  Le produit porté, utilisé, ou posé dans un décor réel.
  Ex. : un homme qui porte le sac dans la rue ; le sac posé sur une table en bois.

"spec"
  LE PRODUIT EST VISIBLE **ET** l'image contient un tableau de mesures, des cotes,
  ou une liste de spécifications chiffrées.
  Ex. : le sac dessiné avec « 32CM / 18CM / 7CM » et un tableau Brand/Model/Material.

"marketing"
  Une infographie de marque SANS vue nette du produit : storytelling, photos de
  famille ou d'équipe, packaging, conseils d'entretien, comparaison de couleurs,
  schéma de protection.
  Ex. : « TIPS FOR LEATHER CARE » ; « LAYER OF PROTECTION » ; photo d'une famille.

"sans_produit"
  Aucun produit, aucune marque : logo seul, bannière promotionnelle, bloc de texte,
  icônes, photo d'atelier.

RÈGLES STRICTES :
- Un logo de marque n'est PAS un packshot → "sans_produit".
- Une image avec beaucoup de texte qui ne montre pas le produit → "marketing".
- Un collage de plusieurs vues portées → "scene". De plusieurs vues posées → "packshot".

Pour CHAQUE image, réponds :
- "i" : son numéro (1 à ${count})
- "type" : un des cinq mots ci-dessus
- "couleur" : la couleur du produit visible, exactement parmi ${colours.map((c) => `"${c}"`).join(", ")}, ou "aucune" si le produit est absent ou si plusieurs coloris apparaissent
- "texte_technique" : true si l'image contient des mesures ou un tableau de valeurs

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

const VALID: ImageType[] = ["packshot", "scene", "spec", "marketing", "sans_produit"];

/** Une URL morte ne doit pas être classée : le modèle ne verrait qu'un blanc. */
async function isReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return false;
    const length = Number(res.headers.get("content-length") ?? 0);
    // Une image de moins de 2 Ko est une vignette ou une page d'erreur.
    return length === 0 || length > 2048;
  } catch {
    return false;
  }
}

export async function classifyImages(input: {
  apiKey: string;
  urls: readonly string[];
  colours: readonly { valueId: string; name: string }[];
  model?: string;
  batchSize?: number;
}): Promise<Map<number, ClassifiedImage>> {
  // Des lots de 4 : l'attention du modèle se dilue au-delà, et les erreurs
  // d'infographie apparaissent précisément sur les lots chargés.
  const batchSize = input.batchSize ?? 4;
  const colourNames = input.colours.map((colour) => colour.name.replace(/^\d+\s*/, ""));
  const result = new Map<number, ClassifiedImage>();

  for (let offset = 0; offset < input.urls.length; offset += batchSize) {
    const batch = input.urls.slice(offset, offset + batchSize);

    const parts: unknown[] = [{ text: PROMPT(batch.length, colourNames) }];
    const positions: number[] = [];
    for (const [localIndex, url] of batch.entries()) {
      if (!(await isReachable(url))) continue;
      try {
        parts.push(await toInlinePart(url));
        positions.push(localIndex);
      } catch {
        // Inaccessible : non classée, donc écartée du livrable.
      }
    }
    if (positions.length === 0) continue;

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
        if (!Number.isInteger(index) || index < 1 || index > positions.length) continue;

        const type = (VALID.includes(item.type as ImageType) ? item.type : "sans_produit") as ImageType;
        const showsProduct = type === "packshot" || type === "scene" || type === "spec";

        const colourName = String(item.couleur ?? "").toLowerCase().trim();
        const colour =
          colourName === "aucune"
            ? undefined
            : input.colours.find(
                (candidate) => candidate.name.replace(/^\d+\s*/, "").toLowerCase() === colourName,
              );

        result.set(offset + (positions[index - 1] ?? 0), {
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
