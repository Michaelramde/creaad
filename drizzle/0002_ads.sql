-- Migration 0002 — observations publicitaires brutes
-- Séparation nette : la collecte stocke des faits, le moteur de saturation
-- raisonne dessus. On peut ainsi rebrancher la source sans toucher au calcul.

CREATE TABLE IF NOT EXISTS ad_observations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archetype_slug  text NOT NULL,
  country         text NOT NULL,
  platform        text NOT NULL CHECK (platform IN ('meta','tiktok')),
  advertiser_id   text NOT NULL,
  advertiser_name text,
  hook            text,
  start_date      timestamptz,
  end_date        timestamptz,
  is_active       boolean NOT NULL DEFAULT true,
  url             text NOT NULL,
  source          text NOT NULL DEFAULT 'collector',
  collected_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_ad_obs_url UNIQUE (platform, url)
);

CREATE INDEX IF NOT EXISTS ix_ad_obs_lookup
  ON ad_observations (archetype_slug, country, platform);

CREATE INDEX IF NOT EXISTS ix_ad_obs_collected
  ON ad_observations (collected_at);
