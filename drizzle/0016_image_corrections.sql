-- Correction manuelle du coloris d'une image : la décision du commerçant
-- primes sur le classement automatique. Stockée par analyse.
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS image_corrections jsonb;
