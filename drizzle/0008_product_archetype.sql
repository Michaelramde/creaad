-- Mémorise le marché auquel un produit a été rattaché : le routage n'est fait
-- qu'une fois par produit, jamais à chaque analyse.
ALTER TABLE product_records ADD COLUMN IF NOT EXISTS archetype_slug text;
ALTER TABLE product_records ADD COLUMN IF NOT EXISTS archetype_source text;
