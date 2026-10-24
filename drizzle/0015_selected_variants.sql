-- La sélection de coloris est une décision du commerçant : elle est enregistrée.
-- Elle pilote la galerie ET le contenu de l'export.
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS selected_variants jsonb;
