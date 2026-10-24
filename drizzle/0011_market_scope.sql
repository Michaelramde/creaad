-- Provenance du marché produit : pays, zone, monde — ou repli archétype.
-- Le kit doit dire d'où viennent ses angles, jamais le laisser deviner.
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS market_scope text;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS market_note text;
