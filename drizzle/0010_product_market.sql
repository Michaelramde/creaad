-- Recherche d'annonces pilotée par le produit.
ALTER TABLE ad_observations ADD COLUMN IF NOT EXISTS product_ref text;
-- Devise de l'annonce : proxy d'attribution géographique quand la plateforme
-- ne renseigne pas le pays (GHS → Ghana, EGP → Égypte, XOF → zone CFA).
ALTER TABLE ad_observations ADD COLUMN IF NOT EXISTS ad_currency text;

CREATE INDEX IF NOT EXISTS ix_ad_obs_product ON ad_observations (product_ref, country);

-- Cache des recherches Meta : positif ET négatif. Sans le négatif, un produit
-- sans annonce serait re-recherché à chaque analyse, indéfiniment.
CREATE TABLE IF NOT EXISTS meta_queries (
  hash text PRIMARY KEY,
  query text NOT NULL,
  scope text NOT NULL,
  countries jsonb NOT NULL,
  ads_found integer NOT NULL,
  cost_usd numeric(10, 6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_meta_queries_expiry ON meta_queries (expires_at);
