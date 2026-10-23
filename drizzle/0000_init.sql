-- Migration 0000 — schéma initial Creaad
-- Écrite à la main pour garder la main sur les contraintes CHECK et l'index partiel
-- (l'index unique (provider, provider_txn_id) WHERE provider_txn_id IS NOT NULL
--  est la garantie d'idempotence du crédit).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── AUTH (Better Auth) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "user" (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  email         text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false,
  image         text,
  phone         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS session (
  id         text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  token      text NOT NULL UNIQUE,
  ip_address text,
  user_agent text,
  user_id    text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account (
  id                      text PRIMARY KEY,
  account_id              text NOT NULL,
  provider_id             text NOT NULL,
  user_id                 text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  access_token            text,
  refresh_token           text,
  id_token                text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope                   text,
  password                text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verification (
  id         text PRIMARY KEY,
  identifier text NOT NULL,
  value      text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─── MÉTIER ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS archetypes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text NOT NULL,
  label      text NOT NULL,
  category   text NOT NULL CHECK (category IN ('beaute','cheveux','mode','gadgets')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_archetype_slug ON archetypes(slug);

CREATE TABLE IF NOT EXISTS products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  archetype_id  uuid REFERENCES archetypes(id),
  name          text,
  category      text NOT NULL CHECK (category IN ('beaute','cheveux','mode','gadgets')),
  regime        text NOT NULL CHECK (regime IN ('detenu','non_detenu')),
  variant_label text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_products_user ON products(user_id);

CREATE TABLE IF NOT EXISTS topups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  amount_xof   integer NOT NULL,
  reference    text UNIQUE,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','processing','completed','failed','cancelled','refunded','expired')),
  gateway      text,
  checkout_url text,
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT ck_topup_min CHECK (amount_xof >= 200)
);
CREATE INDEX IF NOT EXISTS ix_topups_user ON topups(user_id);
CREATE INDEX IF NOT EXISTS ix_topups_status ON topups(status, created_at);

CREATE TABLE IF NOT EXISTS analyses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id       text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  country       text NOT NULL,
  status        text NOT NULL DEFAULT 'creee'
                CHECK (status IN ('creee','reservee','capture','ocr','appariement','bloquee_article',
                                  'moisson','planche_prete','en_attente_validation','recherche_marche',
                                  'marche_pret','production','livree','echouee')),
  reserved_xof  integer NOT NULL DEFAULT 0,
  settled_xof   integer NOT NULL DEFAULT 0,
  failure_code  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_analyses_user ON analyses(user_id, created_at);

CREATE TABLE IF NOT EXISTS plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id    uuid NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  version        integer NOT NULL DEFAULT 1,
  fidelity_score integer NOT NULL CHECK (fidelity_score BETWEEN 0 AND 100),
  breakdown      jsonb NOT NULL,
  gate_passed    boolean NOT NULL,
  gate_reason    text,
  quality_note   text,
  validated_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_plans_analysis ON plans(analysis_id);

CREATE TABLE IF NOT EXISTS plan_images (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id            uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  slot               text NOT NULL,
  angle              text,
  url                text NOT NULL,
  provenance         text NOT NULL
                     CHECK (provenance IN ('utilisateur','fournisseur','marchand','concurrent','generee')),
  width              integer,
  height             integer,
  phash              text,
  is_distinct_source boolean NOT NULL DEFAULT true,
  has_watermark      boolean NOT NULL DEFAULT false,
  source_url         text
);
CREATE INDEX IF NOT EXISTS ix_plan_images_plan ON plan_images(plan_id);
CREATE INDEX IF NOT EXISTS ix_plan_images_phash ON plan_images(phash);

CREATE TABLE IF NOT EXISTS source_listings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    text NOT NULL,
  external_id text NOT NULL,
  url         text NOT NULL,
  title       text,
  payload     jsonb NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_listing_provider_ext ON source_listings(provider, external_id);

CREATE TABLE IF NOT EXISTS market_kits (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archetype_id uuid NOT NULL REFERENCES archetypes(id) ON DELETE CASCADE,
  country      text NOT NULL,
  language     text NOT NULL DEFAULT 'fr',
  content      jsonb NOT NULL,
  ads_found    integer NOT NULL DEFAULT 0,
  confidence   text NOT NULL CHECK (confidence IN ('insufficient','low','medium','high')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_market_cache ON market_kits(archetype_id, country, language);

CREATE TABLE IF NOT EXISTS creative_kits (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid NOT NULL UNIQUE REFERENCES analyses(id) ON DELETE CASCADE,
  content     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── REGISTRE WALLET (append-only) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  type            text NOT NULL
                  CHECK (type IN ('recharge','reservation','reglement','liberation','remboursement','ajustement')),
  amount_xof      integer NOT NULL,
  balance_after   integer NOT NULL,
  analysis_id     uuid REFERENCES analyses(id) ON DELETE SET NULL,
  topup_id        uuid REFERENCES topups(id) ON DELETE SET NULL,
  provider        text,
  provider_txn_id text,
  idempotency_key text NOT NULL,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_wtx_idem
  ON wallet_transactions(idempotency_key);

-- ⚠️ C'est CET index qui garantit l'idempotence du crédit.
CREATE UNIQUE INDEX IF NOT EXISTS ux_wtx_provider_txn
  ON wallet_transactions(provider, provider_txn_id)
  WHERE provider_txn_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_wtx_user_created ON wallet_transactions(user_id, created_at);

-- ─── OBSERVABILITÉ ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_costs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid REFERENCES analyses(id) ON DELETE CASCADE,
  step        text NOT NULL,
  provider    text,
  model       text,
  tokens_in   integer,
  tokens_out  integer,
  cost_usd    numeric(10,6) NOT NULL DEFAULT 0,
  duration_ms integer,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_costs_analysis ON pipeline_costs(analysis_id);
