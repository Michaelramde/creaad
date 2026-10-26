/**
 * Métriques de pilotage — la partie du produit qui regarde le produit.
 *
 * Le dépôt savait dire à 6 décimales près combien il dépense, et pas du tout
 * ce qu'il livre. Ces lectures corrigent ce déséquilibre : elles répondent à
 * « quel pourcentage livrent ? » et « combien coûte une livraison ? ».
 *
 * Aucune n'écrit en base. Toutes sont sûres à appeler depuis une page.
 */
import { desc, eq, sql } from "drizzle-orm";

import { db } from "./db/index.ts";
import { adObservations, analyses, archetypes, pipelineCosts } from "./db/schema.ts";

import { XOF_PER_USD } from "./costs.ts";

export { XOF_PER_USD };

export interface FunnelRow {
  status: string;
  analyses: number;
  pct: number;
}

export interface Funnel {
  rows: FunnelRow[];
  total: number;
  delivered: number;
  blocked: number;
  refused: number;
  failed: number;
  inFlight: number;
  /** 0 → 100. Le chiffre qui décide si le produit fonctionne. */
  deliveryRate: number;
  /** Dossiers d'étape 1 livrés (livree + produit_pret). */
  dossiers: number;
  /**
   * Part des analyses facturables où le commerçant a reçu **quelque chose**.
   * C'est le taux commercial : un blocage remboursé n'est pas une livraison,
   * un dossier produit en est une.
   */
  dossierRate: number;
  blockRate: number;
  refusalRate: number;
  failureRate: number;
}

/** Statuts qui ne sont plus en vol : la base du dénominateur. */
const FINAL = new Set(["livree", "bloquee_article", "planche_prete", "echouee"]);
const IN_FLIGHT = new Set(["ocr", "appariement", "variante_a_choisir"]);

export async function getFunnel(): Promise<Funnel> {
  const rows = await db
    .select({ status: analyses.status, count: sql<number>`count(*)::int` })
    .from(analyses)
    .groupBy(analyses.status)
    .orderBy(desc(sql`count(*)`));

  const total = rows.reduce((acc, row) => acc + Number(row.count), 0);
  const byStatus = new Map(rows.map((row) => [row.status, Number(row.count)]));
  const final = rows
    .filter((row) => FINAL.has(row.status))
    .reduce((acc, row) => acc + Number(row.count), 0);

  const delivered = byStatus.get("livree") ?? 0;
  const blocked = byStatus.get("bloquee_article") ?? 0;
  const refused = byStatus.get("planche_prete") ?? 0;
  const failed = byStatus.get("echouee") ?? 0;
  const inFlight = rows
    .filter((row) => IN_FLIGHT.has(row.status))
    .reduce((acc, row) => acc + Number(row.count), 0);

  const pct = (n: number) => (final === 0 ? 0 : Math.round((1000 * n) / final) / 10);

  const dossiers = delivered + (byStatus.get("produit_pret") ?? 0);
  const dossierBase = final + (byStatus.get("produit_pret") ?? 0);

  return {
    rows: rows.map((row) => ({
      status: row.status,
      analyses: Number(row.count),
      pct: total === 0 ? 0 : Math.round((1000 * Number(row.count)) / total) / 10,
    })),
    total,
    delivered,
    blocked,
    refused,
    failed,
    inFlight,
    // Le taux de livraison se calcule sur les analyses TERMINÉES : compter les
    // analyses en vol comme des échecs ferait paraître le produit cassé.
    deliveryRate: pct(delivered),
    dossiers,
    dossierRate: dossierBase === 0 ? 0 : Math.round((1000 * dossiers) / dossierBase) / 10,
    blockRate: pct(blocked),
    refusalRate: pct(refused),
    failureRate: pct(failed),
  };
}

export interface CostRow {
  step: string;
  provider: string | null;
  calls: number;
  avgUsd: number;
  totalUsd: number;
  estimated: number;
}

export async function getCostByStep(days = 30): Promise<CostRow[]> {
  const rows = await db
    .select({
      step: pipelineCosts.step,
      provider: pipelineCosts.provider,
      calls: sql<number>`count(*)::int`,
      avgUsd: sql<string>`coalesce(avg(${pipelineCosts.costUsd}), 0)`,
      totalUsd: sql<string>`coalesce(sum(${pipelineCosts.costUsd}), 0)`,
      estimated: sql<number>`sum((${pipelineCosts.estimated})::int)::int`,
    })
    .from(pipelineCosts)
    .where(sql`${pipelineCosts.createdAt} > now() - (${days} || ' days')::interval`)
    .groupBy(pipelineCosts.step, pipelineCosts.provider)
    .orderBy(desc(sql`sum(${pipelineCosts.costUsd})`));

  return rows.map((row) => ({
    step: row.step,
    provider: row.provider,
    calls: Number(row.calls),
    avgUsd: Number(row.avgUsd),
    totalUsd: Number(row.totalUsd),
    estimated: Number(row.estimated),
  }));
}

export interface DeliveryCost {
  delivered: number;
  totalUsd: number;
  perDeliveryUsd: number;
  perDeliveryXof: number;
  /** Vrai tant que la colonne contient des estimations faute de facturation. */
  hasEstimates: boolean;
}

/** Coût réel par analyse livrée — les frais de paiement sont exclus (revenus, pas coûts). */
export async function getCostPerDelivery(days = 30): Promise<DeliveryCost> {
  const [cost] = await db
    .select({
      total: sql<string>`coalesce(sum(${pipelineCosts.costUsd}), 0)`,
      estimated: sql<number>`sum((${pipelineCosts.estimated})::int)::int`,
    })
    .from(pipelineCosts)
    .where(
      sql`${pipelineCosts.createdAt} > now() - (${days} || ' days')::interval
          AND ${pipelineCosts.step} <> 'payment_fee'`,
    );

  const [delivered] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(analyses)
    .where(eq(analyses.status, "livree"));

  const totalUsd = Number(cost?.total ?? 0);
  const deliveredCount = Number(delivered?.count ?? 0);
  const perDeliveryUsd = deliveredCount === 0 ? 0 : totalUsd / deliveredCount;

  return {
    delivered: deliveredCount,
    totalUsd,
    perDeliveryUsd,
    perDeliveryXof: Math.round(perDeliveryUsd * XOF_PER_USD),
    hasEstimates: Number(cost?.estimated ?? 0) > 0,
  };
}

export interface ArchetypeCoverage {
  slug: string;
  label: string;
  category: string;
  ads: number;
  advertisers: number;
}

/** Quels archétypes ont réellement des annonces — et lesquels sont vides. */
export async function getArchetypeCoverage(limit = 40): Promise<ArchetypeCoverage[]> {
  const rows = await db
    .select({
      slug: archetypes.slug,
      label: archetypes.label,
      category: archetypes.category,
      ads: sql<number>`count(${adObservations.id})::int`,
      advertisers: sql<number>`count(distinct ${adObservations.advertiserId})::int`,
    })
    .from(archetypes)
    .leftJoin(adObservations, eq(adObservations.archetypeSlug, archetypes.slug))
    .groupBy(archetypes.slug, archetypes.label, archetypes.category)
    .orderBy(desc(sql`count(${adObservations.id})`))
    .limit(limit);

  return rows.map((row) => ({
    slug: row.slug,
    label: row.label,
    category: row.category,
    ads: Number(row.ads),
    advertisers: Number(row.advertisers),
  }));
}

/** Analyses dont l'archétype n'a aucune annonce : le client a payé pour rien. */
export async function getUncoveredAnalyses(limit = 20): Promise<
  { id: string; archetypeSlug: string | null; status: string; createdAt: Date }[]
> {
  const rows = await db
    .select({
      id: analyses.id,
      archetypeSlug: analyses.archetypeSlug,
      status: analyses.status,
      createdAt: analyses.createdAt,
    })
    .from(analyses)
    .where(
      sql`${analyses.archetypeSlug} IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM ${adObservations}
            WHERE ${adObservations.archetypeSlug} = ${analyses.archetypeSlug}
          )`,
    )
    .orderBy(desc(analyses.createdAt))
    .limit(limit);

  return rows;
}

/** Matching : distribution des scores réellement obtenus, pour calibrer les seuils. */
export async function getMatchDistribution(): Promise<
  { bucket: string; analyses: number; avgScore: number }[]
> {
  const rows = await db
    .select({
      bucket: sql<string>`CASE
        WHEN ${analyses.matchScore} IS NULL THEN 'non calculé'
        WHEN ${analyses.matchScore} >= 80 THEN '80-100'
        WHEN ${analyses.matchScore} >= 70 THEN '70-79'
        WHEN ${analyses.matchScore} >= 50 THEN '50-69'
        ELSE '< 50' END`,
      analyses: sql<number>`count(*)::int`,
      avgScore: sql<string>`coalesce(round(avg(${analyses.matchScore}), 1), 0)`,
    })
    .from(analyses)
    .groupBy(
      sql`CASE
        WHEN ${analyses.matchScore} IS NULL THEN 'non calculé'
        WHEN ${analyses.matchScore} >= 80 THEN '80-100'
        WHEN ${analyses.matchScore} >= 70 THEN '70-79'
        WHEN ${analyses.matchScore} >= 50 THEN '50-69'
        ELSE '< 50' END`,
    )
    .orderBy(desc(sql`count(*)`));

  return rows.map((row) => ({
    bucket: row.bucket,
    analyses: Number(row.analyses),
    avgScore: Number(row.avgScore),
  }));
}

/** Référence : sert au diagnostic « aucun produit reconnu ». */
export async function getBlockedReasons(limit = 10): Promise<{ code: string; count: number }[]> {
  const rows = await db
    .select({ code: analyses.failureCode, count: sql<number>`count(*)::int` })
    .from(analyses)
    .where(sql`${analyses.status} IN ('bloquee_article', 'planche_prete', 'echouee')`)
    .groupBy(analyses.failureCode)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);

  return rows.map((row) => ({
    code: row.code ?? "(aucun code)",
    count: Number(row.count),
  }));
}
