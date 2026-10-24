/**
 * Rédaction du kit production (R3).
 *
 * Un seul appel : on donne au modèle les faits du produit et le portefeuille
 * d'angles **déjà calculé**, et il rédige. Il n'a pas le droit d'inventer un
 * angle : `sourceAngleRef` doit appartenir au portefeuille, et le contrat
 * rejette la sortie sinon.
 */
import { parseCreativeKitAgainst } from "../contracts/index.ts";
import type { CreativeKit } from "../contracts/kits.ts";

export interface CreativeWriter {
  readonly name: string;
  write(prompt: string): Promise<string>;
}

export interface CreativeStepInput {
  product: {
    title: string;
    archetype: string;
    category: string;
    claims: string[];
    specs: string[];
    variant?: string;
  };
  portfolio: readonly {
    family: string;
    action: string;
    advertisers: number;
    medianDays: number;
    rationale: string;
  }[];
  country: string;
  language: string;
}

const SYSTEM = `Tu es directeur de création spécialisé en publicité à la performance pour l'Afrique de l'Ouest.
Tu écris en français, pour des commerçants qui vendent sur Facebook, Instagram et TikTok en vertical 15 s.
Tu ne promets jamais de résultat médical ou cosmétique non prouvé. Tu privilégies la preuve concrète (produit reçu, paiement à la livraison, démonstration) sur la promesse abstraite.
Tu réponds uniquement en JSON valide, sans texte autour.`;

function buildPrompt(input: CreativeStepInput): string {
  const angles = input.portfolio
    .map(
      (a) =>
        `- ${a.family} (${a.action}, ${a.advertisers} annonceurs, ${Math.round(a.medianDays)} j de diffusion médiane) : ${a.rationale}`,
    )
    .join("\n");

  return `${SYSTEM}

PRODUIT
Titre : ${input.product.title}
Archétype : ${input.product.archetype}
Catégorie : ${input.product.category}
Variante : ${input.product.variant ?? "non précisée"}
Allégations vérifiées : ${input.product.claims.join(" | ") || "aucune"}
Specs : ${input.product.specs.join(" | ") || "aucune"}

PORTEFEUILLE D'ANGLES (calculé sur ${input.portfolio.length} familles réellement observées sur le marché ${input.country})
${angles}

CONSIGNES
Produis 3 angles créatifs. Chaque angle DOIT référencer une famille exacte de la liste ci-dessus via "sourceAngleRef".
Un angle "importer" ou "tester-vite" est prioritaire ; un angle "garder-differencier" doit proposer une EXÉCUTION nouvelle, pas l'abandon.
Chaque angle suit la chaîne : insight (ce que le client croit) → promise → mechanism (pourquoi ça marche) → proof (ce qu'on montre) → objectionHandled → hook (≤ 160 caractères) → awarenessLevel (1-5).
Les hooks tiennent dans les 2 premières secondes. Les scripts font 15 s, premier plan à 0 s, hookEndsAtS ≤ 2.
La direction visuelle respecte la catégorie (packshot fidèle, pas de visage généré pour un produit cosmétique, pas de promesse d'éclaircissement).
Les prompts d'image décrivent une scène, sans inventer de caractéristiques produit.

FORMAT JSON EXACT
{
  "bigIdea": "une phrase",
  "angles": [{"id":"a1","insight":"","promise":"","mechanism":"","proof":"","objectionHandled":"","hook":"","awarenessLevel":3,"sourceAngleRef":"<famille>"}],
  "hooks": [{"format":"ugc","text":"","durationS":15}],
  "scripts": [{"format":"ugc","durationS":15,"hookEndsAtS":2,"scenes":[{"atS":0,"visual":""},{"atS":2,"visual":""}]}],
  "visualDirection": {"palette":["#RRGGBB"],"motifs":[],"do":[],"dont":[]},
  "imagePrompts": [{"slotRef":"face","scene":"","prompt":"","negativePrompt":"","referenceImages":[]}]
}`;
}

export interface CreativeStepResult {
  kit: CreativeKit | null;
  warnings: string[];
}

export async function buildCreativeStep(
  writer: CreativeWriter | undefined,
  input: CreativeStepInput,
): Promise<CreativeStepResult> {
  const warnings: string[] = [];

  if (!writer) {
    return { kit: null, warnings: ["Aucun rédacteur configuré : kit production non généré."] };
  }

  const allowed = input.portfolio.map((a) => a.family);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await writer.write(buildPrompt(input));
      const json = JSON.parse(extractJson(raw)) as unknown;
      return { kit: parseCreativeKitAgainst(json, allowed), warnings };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 1) {
        warnings.push(`Kit production non généré : ${message.slice(0, 160)}`);
        return { kit: null, warnings };
      }
      // Une seule seconde chance : le modèle produit parfois du JSON bavard.
    }
  }

  return { kit: null, warnings };
}

/** Retire un éventuel bloc markdown autour du JSON. */
function extractJson(raw: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}
