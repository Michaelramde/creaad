/**
 * Classification des hooks par le modèle, avec cache permanent.
 *
 * Pourquoi ce module existe : le classifieur par mots-clés mesurait **29 %**
 * de précision sur 24 annonces ivoiriennes réelles (voir
 * `tests/fixtures/hooks-labelled.ts`). Or la matrice de saturation — le
 * livrable vedette — compte des familles. Compter du bruit produisait des
 * conclusions fausses *présentées comme sourcées*.
 *
 * Dispositif :
 *   1. cache en base, par empreinte du texte (jamais repayé) ;
 *   2. un appel modèle par lot de 20 hooks non vus ;
 *   3. repli déterministe (75 % de précision) si le modèle est indisponible —
 *      non mis en cache, pour être recalculé dès son retour.
 */
import { createHash } from "node:crypto";
import { inArray } from "drizzle-orm";

import { db } from "../db/index.ts";
import { hookLabels } from "../db/schema.ts";
import type { CreativeWriter } from "../pipeline/creative.ts";
import { classifyHook } from "./classify.ts";
import { ANGLE_FAMILIES, type AngleFamily } from "./types.ts";

/** À incrémenter dès qu'une famille est renommée ou ajoutée. */
export const LABEL_VERSION = 2;
const BATCH = 20;

export function hookKey(hook: string): string {
  return createHash("sha1").update(hook.trim().slice(0, 400)).digest("hex").slice(0, 32);
}

const SYSTEM = `Tu classes des accroches publicitaires d'Afrique de l'Ouest.
On te donne une liste numérotée. Pour chacune, tu choisis LA famille d'angle dominante.
Tu ne juges pas la qualité : seulement l'angle que l'annonceur exploite.
Réponds uniquement en JSON.`;

function prompt(hooks: readonly string[]): string {
  const lines = hooks
    .map((hook, index) => `[${index + 1}] ${hook.replace(/\s+/g, " ").slice(0, 300)}`)
    .join("\n");

  return `${SYSTEM}

FAMILLES POSSIBLES (une seule par annonce) :
- preuve-sociale : nombre de clients, avis, recommandations, déjà vu
- avant-apres : transformation, résultat visible, comparaison temporelle
- probleme-solution : nommer un problème puis proposer le produit
- prix-offre : prix affiché, promo, pack, cadeau, réduction
- autorite : médecin, pharmacien, laboratoire, certification
- urgence : stock limité, dernier lot, 2 jours seulement, arrivage
- demonstration : montrer le geste, l'usage, le mode d'emploi
- temoignage : récit à la première personne
- identite : statut social, appartenance, niveau, classe
- comparaison : opposition explicite à une alternative
- garantie : paiement à la livraison, satisfait ou remboursé, SAV
- nouveaute : nouveau produit, nouvelle version, « enfin là »
- non-classe : annonce de distribution ou d'information qui ne vend aucun angle

ANNONCES :
${lines}

FORMAT : {"labels":[{"i":1,"family":"prix-offre"}]}
`;
}

function extractJson(raw: string): string {
  const fenced = /\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/.exec(raw);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

async function remember(
  rows: readonly { hash: string; family: AngleFamily; model: string; sample: string }[],
): Promise<void> {
  if (rows.length === 0) return;
  try {
    await db
      .insert(hookLabels)
      .values(
        rows.map((row) => ({
          hash: row.hash,
          family: row.family,
          labelVersion: LABEL_VERSION,
          model: row.model,
          source: "llm",
          sample: row.sample,
        })),
      )
      .onConflictDoNothing();
  } catch (error) {
    // Le cache ne doit jamais faire échouer une analyse.
    console.warn("[classify-llm] écriture du cache impossible", error);
  }
}

async function fromCache(hashes: readonly string[]): Promise<Map<string, AngleFamily>> {
  const found = new Map<string, AngleFamily>();
  if (hashes.length === 0) return found;
  try {
    const rows = await db
      .select({ hash: hookLabels.hash, family: hookLabels.family, version: hookLabels.labelVersion })
      .from(hookLabels)
      .where(inArray(hookLabels.hash, [...hashes]));
    for (const row of rows) {
      if (row.version === LABEL_VERSION) found.set(row.hash, row.family as AngleFamily);
    }
  } catch (error) {
    console.warn("[classify-llm] lecture du cache impossible", error);
  }
  return found;
}

/**
 * Rend une étiquette par hook, indexée par **texte brut** (ce qu'attend
 * `ingestAds`). Coût : un appel modèle par 20 hooks jamais vus.
 */
export async function labelsForHooks(
  writer: CreativeWriter | undefined,
  hooks: readonly string[],
): Promise<Map<string, AngleFamily>> {
  const result = new Map<string, AngleFamily>();
  const unique = [...new Set(hooks.filter((hook) => hook.trim().length > 0))];
  if (unique.length === 0) return result;

  const byHash = new Map<string, string>();
  for (const hook of unique) byHash.set(hookKey(hook), hook);

  const cached = await fromCache([...byHash.keys()]);
  for (const [hash, hook] of byHash) {
    const family = cached.get(hash);
    if (family) result.set(hook, family);
  }

  const missing = unique.filter((hook) => !result.has(hook));

  if (writer && missing.length > 0) {
    for (let offset = 0; offset < missing.length; offset += BATCH) {
      const batch = missing.slice(offset, offset + BATCH);
      try {
        const raw = await writer.write(prompt(batch), { step: "hook-labels" });
        const parsed = JSON.parse(extractJson(raw)) as {
          labels?: { i?: number; family?: string }[];
        };
        const toStore: { hash: string; family: AngleFamily; model: string; sample: string }[] = [];

        for (const entry of parsed.labels ?? []) {
          const index = Number(entry.i);
          const hook = batch[index - 1];
          const family = String(entry.family ?? "") as AngleFamily;
          if (!hook || !ANGLE_FAMILIES.includes(family)) continue;
          result.set(hook, family);
          toStore.push({
            hash: hookKey(hook),
            family,
            model: writer.name,
            sample: hook.slice(0, 200),
          });
        }

        await remember(toStore);
      } catch (error) {
        console.warn("[classify-llm] lot échoué, repli déterministe", error);
      }
    }
  }

  for (const hook of missing) {
    if (!result.has(hook)) result.set(hook, classifyHook(hook).family);
  }

  return result;
}
