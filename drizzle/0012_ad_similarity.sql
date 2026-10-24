-- Vérification visuelle des annonces : l'annonce montre-t-elle vraiment ce produit ?
ALTER TABLE ad_observations ADD COLUMN IF NOT EXISTS ad_image_url text;
-- Similarité entre le visuel de l'annonce et la photo du produit (0 → 1).
-- NULL = non vérifiée (pas d'image, ou vérification pas encore passée).
ALTER TABLE ad_observations ADD COLUMN IF NOT EXISTS product_similarity numeric(4, 3);

CREATE INDEX IF NOT EXISTS ix_ad_obs_unverified
  ON ad_observations (product_ref)
  WHERE product_ref IS NOT NULL AND product_similarity IS NULL;
