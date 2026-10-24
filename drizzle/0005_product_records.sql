-- Cache d'identité produit : une fiche payée une fois, réutilisée 30 jours.
-- Deux niveaux de cache : l'empreinte de la photo (7 j) et le produit (30 j).
CREATE TABLE IF NOT EXISTS product_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  product_id text NOT NULL,
  title text NOT NULL,
  url text NOT NULL,
  price numeric(12, 2),
  currency text,
  rating numeric(3, 2),
  sold integer,
  gallery jsonb NOT NULL DEFAULT '[]'::jsonb,
  variant_axes jsonb NOT NULL DEFAULT '[]'::jsonb,
  variants jsonb NOT NULL DEFAULT '[]'::jsonb,
  specs jsonb NOT NULL DEFAULT '{}'::jsonb,
  facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  seller jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT product_records_provider_product_unique UNIQUE (provider, product_id)
);

CREATE INDEX IF NOT EXISTS ix_product_records_expiry ON product_records (expires_at);

-- Empreinte de photo : la même image envoyée deux fois ne se repaie pas.
CREATE TABLE IF NOT EXISTS image_queries (
  hash text PRIMARY KEY,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_image_queries_expiry ON image_queries (expires_at);
