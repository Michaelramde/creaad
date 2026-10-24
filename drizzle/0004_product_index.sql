-- Index visuel : un vecteur par produit, calculé une fois, interroéable ensuite.
-- Permet « trouve-moi tout ce qui ressemble à cette photo », sans mot-clé.
CREATE TABLE IF NOT EXISTS product_index (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archetype_slug text NOT NULL,
  category text NOT NULL,
  provider text NOT NULL,
  external_id text NOT NULL,
  title text NOT NULL,
  url text NOT NULL,
  image_url text NOT NULL,
  embedding jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_index_provider_external_unique UNIQUE (provider, external_id)
);

CREATE INDEX IF NOT EXISTS product_index_category_idx ON product_index (category);
CREATE INDEX IF NOT EXISTS product_index_archetype_idx ON product_index (archetype_slug);
