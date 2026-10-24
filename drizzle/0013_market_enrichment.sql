-- Kit « Convaincre » complet : concurrents, désirs, objections, personas, risques.
-- Stocké par analyse : il dérive des annonces trouvées **pour ce produit**.
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS market_enrichment jsonb;
