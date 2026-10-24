/**
 * Le kit « Convaincre » au-delà des angles : désirs, objections, personas.
 *
 * Même discipline que R3 : **chaque affirmation cite une annonce réelle**.
 * Un désir sans preuve est une intuition de modèle — il est rejeté.
 */
import type { CreativeWriter } from "../pipeline/creative.ts";
import { buildCompetitors, type AdForCompetitors, type Competitor } from "./competitors.ts";

export interface Desire {
  level: number;
  statement: string;
  evidence: string[];
}

export interface Objection {
  objection: string;
  counterAngle: string;
  evidence: string[];
}

export interface Persona {
  name: string;
  profile: string;
  verbatims: { quote: string; sourceUrl: string }[];
}

export interface RiskFlag {
  type: "meta_policy" | "legal" | "category";
  severity: "info" | "warning" | "blocking";
  note: string;
}

export interface MarketEnrichment {
  competitors: Competitor[];
  desires: Desire[];
  objections: Objection[];
  personas: Persona[];
  riskFlags: RiskFlag[];
}

interface RawEnrichment {
  desires?: { level?: number; statement?: string; evidence?: string[] }[];
  objections?: { objection?: string; counterAngle?: string; evidence?: string[] }[];
  personas?: { name?: string; profile?: string; verbatims?: { quote?: string; sourceUrl?: string }[] }[];
  riskFlags?: { type?: string; severity?: string; note?: string }[];
}

const SYSTEM = `Tu analyses un marché publicitaire pour un commerçant d'Afrique de l'Ouest.
Tu travailles UNIQUEMENT à partir des annonces fournies. Tu n'inventes rien :
chaque désir et chaque objection doit citer les URLs des annonces qui le prouvent.
Tu réponds en français, uniquement en JSON.`;

function buildPrompt(input: {
  ads: readonly { hook: string; url: string; advertiserName: string | null }[];
  product: { title: string; category: string; country: string };
}): string {
  const lines = input.ads
    .slice(0, 30)
    .map((ad, index) => `[${index + 1}] ${ad.url}\n    « ${ad.hook.replace(/\s+/g, " ").slice(0, 220)} »`)
    .join("\n");

  return `${SYSTEM}

PRODUIT : ${input.product.title}
CATÉGORIE : ${input.product.category}
PAYS : ${input.product.country}

ANNONCES RÉELLEMENT DIFFUSÉES (URL + texte de l'annonce) :
${lines}

PRODUIS :
- "desires" : 3 à 5 désirs d'acheteurs, du plus superficiel (1) au plus profond (5).
  Chaque désir cite au moins une URL de la liste dans "evidence".
- "objections" : 2 à 4 freins à l'achat, chacun avec un "counterAngle" concret.
  Chaque objection cite au moins une URL dans "evidence".
- "personas" : 1 à 3 profils d'acheteurs. Chaque persona a 1 à 2 "verbatims"
  reprenant MOT POUR MOT un extrait d'une annonce, avec sa "sourceUrl".
- "riskFlags" : promesses qui peuvent faire refuser une publicité Meta
  (santé, éclaircissement de peau, garantie absolue). "type" vaut
  "meta_policy" | "legal" | "category", "severity" vaut "info" | "warning" | "blocking".

RÈGLE ABSOLUE : toute URL citée doit exister dans la liste ci-dessus, à l'identique.
Une affirmation sans preuve sera rejetée.

FORMAT :
{"desires":[{"level":3,"statement":"…","evidence":["https://…"]}],
 "objections":[{"objection":"…","counterAngle":"…","evidence":["https://…"]}],
 "personas":[{"name":"…","profile":"…","verbatims":[{"quote":"…","sourceUrl":"https://…"}]}],
 "riskFlags":[{"type":"meta_policy","severity":"warning","note":"…"}]}`;
}

function extractJson(raw: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

/**
 * `allowed` sert de garde-fou : toute URL hors liste est éliminée, et l'item
 * qui n'a plus aucune preuve est supprimé. Sans ça, un modèle bienveillant
 * inventerait des sources crédibles.
 */
export function sanitizeEnrichment(raw: RawEnrichment, allowed: ReadonlySet<string>): MarketEnrichment {
  const keepUrls = (urls: string[] | undefined) =>
    (urls ?? []).filter((url) => typeof url === "string" && allowed.has(url));

  const desires: Desire[] = (raw.desires ?? [])
    .map((entry) => ({
      level: Math.min(5, Math.max(1, Math.round(Number(entry.level ?? 3)))),
      statement: String(entry.statement ?? "").trim().slice(0, 300),
      evidence: keepUrls(entry.evidence),
    }))
    .filter((entry) => entry.statement.length >= 5 && entry.evidence.length > 0);

  const objections: Objection[] = (raw.objections ?? [])
    .map((entry) => ({
      objection: String(entry.objection ?? "").trim().slice(0, 300),
      counterAngle: String(entry.counterAngle ?? "").trim().slice(0, 300),
      evidence: keepUrls(entry.evidence),
    }))
    .filter((entry) => entry.objection.length >= 5 && entry.evidence.length > 0);

  const personas: Persona[] = (raw.personas ?? [])
    .map((entry) => ({
      name: String(entry.name ?? "").trim().slice(0, 80),
      profile: String(entry.profile ?? "").trim().slice(0, 800),
      verbatims: (entry.verbatims ?? [])
        .filter((v) => v.quote && v.sourceUrl && allowed.has(v.sourceUrl))
        .map((v) => ({ quote: String(v.quote).slice(0, 400), sourceUrl: String(v.sourceUrl) })),
    }))
    .filter((entry) => entry.name.length >= 2 && entry.profile.length >= 10);

  const riskFlags: RiskFlag[] = (raw.riskFlags ?? [])
    .map((entry) => ({
      type: ["meta_policy", "legal", "category"].includes(String(entry.type))
        ? (entry.type as RiskFlag["type"])
        : ("meta_policy" as const),
      severity: ["info", "warning", "blocking"].includes(String(entry.severity))
        ? (entry.severity as RiskFlag["severity"])
        : ("info" as const),
      note: String(entry.note ?? "").trim().slice(0, 500),
    }))
    .filter((entry) => entry.note.length >= 10);

  return { competitors: [], desires, objections, personas, riskFlags };
}

export async function enrichMarket(input: {
  writer: CreativeWriter | undefined;
  ads: readonly (AdForCompetitors & { hook: string })[];
  product: { title: string; category: string; country: string };
}): Promise<{ enrichment: MarketEnrichment | null; warnings: string[] }> {
  const competitors = buildCompetitors(input.ads);
  const warnings: string[] = [];

  if (!input.writer) {
    return { enrichment: { competitors, desires: [], objections: [], personas: [], riskFlags: [] }, warnings };
  }

  const withHook = input.ads.filter((ad) => ad.hook);
  if (withHook.length === 0) {
    return { enrichment: { competitors, desires: [], objections: [], personas: [], riskFlags: [] }, warnings };
  }

  const allowed = new Set(input.ads.map((ad) => ad.url));

  try {
    const raw = await input.writer.write(
      buildPrompt({
        ads: withHook.map((ad) => ({ hook: ad.hook, url: ad.url, advertiserName: ad.advertiserName })),
        product: input.product,
      }),
    );

    const parsed = JSON.parse(extractJson(raw)) as RawEnrichment;
    const sanitized = sanitizeEnrichment(parsed, allowed);

    if (sanitized.desires.length === 0 && sanitized.objections.length === 0) {
      warnings.push("Désirs et objections non retenus : aucune preuve citée ne correspondait aux annonces.");
    }

    return { enrichment: { ...sanitized, competitors }, warnings };
  } catch (error) {
    warnings.push(`Analyse du marché incomplète : ${(error as Error).message.slice(0, 120)}`);
    return { enrichment: { competitors, desires: [], objections: [], personas: [], riskFlags: [] }, warnings };
  }
}
