import { relations, sql } from "drizzle-orm";
import type { Facts, PoolImage, ProductVariant, VariantAxis } from "../products/types.ts";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ═══════════════════════════════════════════════════════════════════════════
   AUTH — tables Better Auth (noms et colonnes par défaut, ne pas renommer)
   ═══════════════════════════════════════════════════════════════════════════ */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  phone: text("phone"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ═══════════════════════════════════════════════════════════════════════════
   MÉTIER
   ═══════════════════════════════════════════════════════════════════════════ */

export const archetypes = pgTable(
  "archetypes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    label: text("label").notNull(),
    category: text("category")
      .$type<"beaute" | "cheveux" | "mode" | "gadgets">()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ux_archetype_slug").on(t.slug)],
);

/**
 * Index visuel : un vecteur par produit fournisseur.
 * Alimenté hors ligne, interrogé en cosinus à chaque analyse.
 */
export const productIndex = pgTable(
  "product_index",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    archetypeSlug: text("archetype_slug").notNull(),
    category: text("category").notNull(),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    imageUrl: text("image_url").notNull(),
    embedding: jsonb("embedding").$type<number[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("product_index_provider_external_unique").on(table.provider, table.externalId)],
);

/**
 * Cache d'identité produit — voir src/lib/products/records.ts.
 * Une fiche payée une fois, réutilisée 30 jours.
 */
export const productRecords = pgTable(
  "product_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    productId: text("product_id").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    price: numeric("price", { precision: 12, scale: 2 }),
    currency: text("currency"),
    rating: numeric("rating", { precision: 3, scale: 2 }),
    sold: integer("sold"),
    gallery: jsonb("gallery").$type<PoolImage[]>().notNull().default([]),
    variantAxes: jsonb("variant_axes").$type<VariantAxis[]>().notNull().default([]),
    variants: jsonb("variants").$type<ProductVariant[]>().notNull().default([]),
    specs: jsonb("specs").$type<Record<string, string>>().notNull().default({}),
    facts: jsonb("facts").$type<Facts>().notNull().default({}),
    images: jsonb("images").$type<PoolImage[]>().notNull().default([]),
    seller: jsonb("seller").$type<Record<string, unknown>>(),
    /** Marché rattaché au produit : le routage n'est fait qu'une fois. */
    archetypeSlug: text("archetype_slug"),
    archetypeSource: text("archetype_source"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("product_records_provider_product_unique").on(t.provider, t.productId)],
);

/** Empreinte de photo : la même image envoyée deux fois ne se repaie pas. */
export const imageQueries = pgTable("image_queries", {
  hash: text("hash").primaryKey(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const products = pgTable(  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    archetypeId: uuid("archetype_id").references(() => archetypes.id),
    name: text("name"),
    category: text("category")
      .$type<"beaute" | "cheveux" | "mode" | "gadgets">()
      .notNull(),
    regime: text("regime").$type<"detenu" | "non_detenu">().notNull(),
    variantLabel: text("variant_label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ix_products_user").on(t.userId)],
);

export const topups = pgTable(
  "topups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    amountXof: integer("amount_xof").notNull(),
    reference: text("reference").unique(),
    status: text("status")
      .$type<
        | "pending"
        | "processing"
        | "completed"
        | "failed"
        | "cancelled"
        | "refunded"
        | "expired"
      >()
      .notNull()
      .default("pending"),
    gateway: text("gateway"),
    checkoutUrl: text("checkout_url"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("ix_topups_user").on(t.userId),
    check("ck_topup_min", sql`${t.amountXof} >= 200`),
  ],
);

export const analyses = pgTable(
  "analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    country: text("country").notNull(),
    /** Photos du commerçant, gardées pour afficher le résultat même sans planche. */
    photos: jsonb("photos")
      .$type<{ url: string; width?: number; height?: number }[]>()
      .notNull()
      .default([]),
    status: text("status")
      .$type<
        | "creee"
        | "reservee"
        | "capture"
        | "ocr"
        | "appariement"
        | "bloquee_article"
        | "variante_a_choisir"
        | "moisson"
        | "planche_prete"
        | "en_attente_validation"
        | "recherche_marche"
        | "marche_pret"
        | "production"
        | "livree"
        | "echouee"
      >()
      .notNull()
      .default("creee"),
    /** Coût estimé réservé au lancement (XOF). */
    reservedXof: integer("reserved_xof").notNull().default(0),
    /** Coût réel réglé à la livraison (XOF). */
    settledXof: integer("settled_xof").notNull().default(0),
    failureCode: text("failure_code"),
    /** Décision d'appariement — conservée pour l'audit (J1). */
    matchScore: integer("match_score"),
    matchCoverage: numeric("match_coverage", { precision: 3, scale: 2 }),
    matchResult: jsonb("match_result"),
    archetypeSlug: text("archetype_slug"),
    /** Produit fournisseur identifié, pour ne pas le recalculer à la reprise. */
    productRef: text("product_ref"),
    /** Axes de variantes proposés quand l'analyse attend un choix. */
    pendingVariants: jsonb("pending_variants").$type<VariantAxis[]>(),
    /** Provenance du marché produit : pays · zone · monde · archetype. */
    marketScope: text("market_scope"),
    marketNote: text("market_note"),
    manualConfirmedAt: timestamp("manual_confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ix_analyses_user").on(t.userId, t.createdAt),
    index("ix_analyses_archetype").on(t.archetypeSlug),
    check(
      "ck_analysis_states",
      sql`${t.status} IN ('creee','reservee','capture','ocr','appariement','bloquee_article',
        'variante_a_choisir','moisson','planche_prete','en_attente_validation','recherche_marche',
        'marche_pret','production','livree','echouee')`,
    ),
  ],
);

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => analyses.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    fidelityScore: integer("fidelity_score").notNull(),
    breakdown: jsonb("breakdown")
      .$type<{ coverage: number; resolution: number; text: number; distinctSources: number }>()
      .notNull(),
    gatePassed: boolean("gate_passed").notNull(),
    gateReason: text("gate_reason"),
    qualityNote: text("quality_note"),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ix_plans_analysis").on(t.analysisId),
    check("ck_plan_score", sql`${t.fidelityScore} BETWEEN 0 AND 100`),
  ],
);

export const planImages = pgTable(
  "plan_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    slot: text("slot").notNull(),
    angle: text("angle"),
    url: text("url").notNull(),
    provenance: text("provenance")
      .$type<"utilisateur" | "fournisseur" | "marchand" | "concurrent" | "generee">()
      .notNull(),
    width: integer("width"),
    height: integer("height"),
    phash: text("phash"),
    isDistinctSource: boolean("is_distinct_source").notNull().default(true),
    /** Vrai si cette image porte le coloris choisi par le commerçant. */
    isVariantReference: boolean("is_variant_reference").notNull().default(false),
    hasWatermark: boolean("has_watermark").notNull().default(false),
    sourceUrl: text("source_url"),
  },
  (t) => [
    index("ix_plan_images_plan").on(t.planId),
    index("ix_plan_images_phash").on(t.phash),
  ],
);

export const sourceListings = pgTable(
  "source_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    title: text("title"),
    payload: jsonb("payload").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ux_listing_provider_ext").on(t.provider, t.externalId)],
);

export const marketKits = pgTable(
  "market_kits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    archetypeId: uuid("archetype_id")
      .notNull()
      .references(() => archetypes.id, { onDelete: "cascade" }),
    country: text("country").notNull(),
    language: text("language").notNull().default("fr"),
    content: jsonb("content").notNull(),
    adsFound: integer("ads_found").notNull().default(0),
    confidence: text("confidence")
      .$type<"insufficient" | "low" | "medium" | "high">()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("ux_market_cache").on(t.archetypeId, t.country, t.language)],
);

export const creativeKits = pgTable("creative_kits", {
  id: uuid("id").primaryKey().defaultRandom(),
  analysisId: uuid("analysis_id")
    .notNull()
    .references(() => analyses.id, { onDelete: "cascade" })
    .unique(),
  content: jsonb("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ═══════════════════════════════════════════════════════════════════════════
   OBSERVATIONS PUBLICITAIRES — faits bruts collectés, séparés du raisonnement
   ═══════════════════════════════════════════════════════════════════════════ */

export const adObservations = pgTable(
  "ad_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    archetypeSlug: text("archetype_slug").notNull(),
    country: text("country").notNull(),
    platform: text("platform").$type<"meta" | "tiktok">().notNull(),
    advertiserId: text("advertiser_id").notNull(),
    advertiserName: text("advertiser_name"),
    hook: text("hook"),
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    /** Produit fournisseur dont cette annonce fait la promotion. */
    productRef: text("product_ref"),
    /** Devise de l'annonce : proxy d'attribution géographique. */
    adCurrency: text("ad_currency"),
    url: text("url").notNull(),
    source: text("source").notNull().default("collector"),
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ux_ad_obs_url").on(t.platform, t.url),
    index("ix_ad_obs_lookup").on(t.archetypeSlug, t.country, t.platform),
    index("ix_ad_obs_product").on(t.productRef, t.country),
  ],
);

/** Cache des recherches Meta — positif et négatif. */
export const metaQueries = pgTable(
  "meta_queries",
  {
    hash: text("hash").primaryKey(),
    query: text("query").notNull(),
    scope: text("scope").notNull(),
    countries: jsonb("countries").$type<string[]>().notNull(),
    adsFound: integer("ads_found").notNull(),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("ix_meta_queries_expiry").on(t.expiresAt)],
);

/* ═══════════════════════════════════════════════════════════════════════════
   REGISTRE WALLET — append-only. Aucun UPDATE de solde, jamais.
   ═══════════════════════════════════════════════════════════════════════════ */

export const walletTransactions = pgTable(
  "wallet_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    type: text("type")
      .$type<"recharge" | "reservation" | "reglement" | "liberation" | "remboursement" | "ajustement">()
      .notNull(),
    /** Signé : positif = crédit, négatif = débit. */
    amountXof: integer("amount_xof").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    analysisId: uuid("analysis_id").references(() => analyses.id, { onDelete: "set null" }),
    topupId: uuid("topup_id").references(() => topups.id, { onDelete: "set null" }),
    provider: text("provider"),
    providerTxnId: text("provider_txn_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ux_wtx_idem").on(t.idempotencyKey),
    // L'unicité du couple (provider, provider_txn_id) EST l'idempotence de crédit :
    // GeniusPay n'expose pas de clé d'idempotence, on la porte en base.
    uniqueIndex("ux_wtx_provider_txn")
      .on(t.provider, t.providerTxnId)
      .where(sql`${t.providerTxnId} IS NOT NULL`),
    index("ix_wtx_user_created").on(t.userId, t.createdAt),
    check(
      "ck_wtx_types",
      sql`${t.type} IN ('recharge','reservation','reglement','liberation','remboursement','ajustement')`,
    ),
  ],
);

/* ═══════════════════════════════════════════════════════════════════════════
   OBSERVABILITÉ — coût réel par étape, vérifie que la marge tient
   ═══════════════════════════════════════════════════════════════════════════ */

export const pipelineCosts = pgTable(
  "pipeline_costs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    analysisId: uuid("analysis_id").references(() => analyses.id, { onDelete: "cascade" }),
    step: text("step").notNull(),
    provider: text("provider"),
    model: text("model"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    durationMs: integer("duration_ms"),
    /** Vrai quand le montant a été estimé faute de facturation lisible. */
    estimated: boolean("estimated").notNull().default(false),
    /** Identifiant d'exécution chez le fournisseur, pour réconciliation. */
    externalId: text("external_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ix_costs_analysis").on(t.analysisId)],
);

/* ═══════════════════════════════════════════════════════════════════════════
   RELATIONS
   ═══════════════════════════════════════════════════════════════════════════ */

export const userRelations = relations(user, ({ many }) => ({
  products: many(products),
  topups: many(topups),
  analyses: many(analyses),
  wallet: many(walletTransactions),
}));

export const analysisRelations = relations(analyses, ({ one, many }) => ({
  product: one(products, { fields: [analyses.productId], references: [products.id] }),
  plans: many(plans),
  costs: many(pipelineCosts),
}));

export const planRelations = relations(plans, ({ one, many }) => ({
  analysis: one(analyses, { fields: [plans.analysisId], references: [analyses.id] }),
  images: many(planImages),
}));

export type WalletTxType = (typeof walletTransactions.$inferSelect)["type"];
export type AnalysisStatus = (typeof analyses.$inferSelect)["status"];
