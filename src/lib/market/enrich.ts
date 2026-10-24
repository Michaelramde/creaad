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

export interface ReviewSample {
  rating: number;
  text: string;
  country?: string;
  date?: string;
}

function buildPrompt(input: {
  ads: readonly { hook: string; url: string; advertiserName: string | null }[];
  reviews: readonly ReviewSample[];
  reviewSourceUrl?: string;
  product: { title: string; category: string; country: string };
}): string {
  const lines = input.ads
    .slice(0, 20)
    .map((ad, index) => `[${index + 1}] ${ad.url}\n    « ${ad.hook.replace(/\s+/g, " ").slice(0, 200)} »`)
    .join("\n");

  const reviews = input.reviews
    .slice(0, 15)
    .map(
      (review, index) =>
        `[A${index + 1}] ${review.rating}/5 · ${review.country ?? "?"} · ${review.date ?? "?"}\n    « ${review.text.replace(/\s+/g, " ").slice(0, 220)} »`,
    )
    .join("\n");

  const reviewUrl = input.reviewSourceUrl ?? "";

  return `${SYSTEM}

PRODUIT : ${input.product.title}
CATÉGORIE : ${input.product.category}
PAYS : ${input.product.country}

ANNONCES DES CONCURRENTS :
${lines || "(aucune)"}

AVIS D'ACHETEURS RÉELS DE CE PRODUIT (note, pays, date, texte) :
${reviews || "(aucun)"}

PRODUIS :
- "desires" : 3 à 5 désirs d'acheteurs, du plus superficiel (1) au plus profond (5).
  Appuie-toi sur les avis les mieux notés ET sur les annonces.
  "evidence" cite les URLs d'annonces (https://…) ou l'URL du produit ${reviewUrl}.
- "objections" : 2 à 4 freins à l'achat avec un "counterAngle" concret.
  Appuie-toi en priorité sur les avis mal notés (≤ 3 étoiles) : ce sont de vraies plaintes.
  "evidence" cite les URLs d'annonces ou ${reviewUrl}.
- "personas" : 1 à 3 profils. Chaque "verbatim" reprend MOT POUR MOT un extrait
  d'avis ou d'annonce, avec sa "sourceUrl".
- "riskFlags" : promesses qui peuvent faire refuser une publicité Meta
  (santé, éclaircissement de peau, garantie absolue).

RÈGLE ABSOLUE : toute URL citée doit être soit une URL d'annonce ci-dessus,
soit ${reviewUrl}. Une affirmation sans preuve sera rejetée.

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
  /** Avis d'acheteurs réels : la source des objections. */
  reviews?: readonly ReviewSample[];
  /** URL de la fiche produit, seule preuve citable pour un avis. */
  reviewSourceUrl?: string;
  product: { title: string; category: string; country: string };
}): Promise<{ enrichment: MarketEnrichment | null; warnings: string[] }> {
  const competitors = buildCompetitors(input.ads);
  const warnings: string[] = [];
  const reviews = input.reviews ?? [];

  const empty: MarketEnrichment = { competitors, desires: [], objections: [], personas: [], riskFlags: [] };

  if (!input.writer) return { enrichment: empty, warnings };

  const withHook = input.ads.filter((ad) => ad.hook);
  if (withHook.length === 0 && reviews.length === 0) return { enrichment: empty, warnings };

  const allowed = new Set(input.ads.map((ad) => ad.url));
  if (input.reviewSourceUrl) allowed.add(input.reviewSourceUrl);

  try {
    const raw = await input.writer.write(
      buildPrompt({
        ads: withHook.map((ad) => ({ hook: ad.hook, url: ad.url, advertiserName: ad.advertiserName })),
        reviews,
        ...(input.reviewSourceUrl ? { reviewSourceUrl: input.reviewSourceUrl } : {}),
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
