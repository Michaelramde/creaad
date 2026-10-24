-- Statut « variante à choisir » + mémorisation des axes proposés.
-- La contrainte de statut doit être reconstruite, pas complétée.

ALTER TABLE analyses DROP CONSTRAINT IF EXISTS ck_analysis_states;
ALTER TABLE analyses ADD CONSTRAINT ck_analysis_states CHECK (status IN (
  'creee','reservee','capture','ocr','appariement','bloquee_article',
  'variante_a_choisir','moisson','planche_prete','en_attente_validation',
  'recherche_marche','marche_pret','production','livree','echouee'
));

ALTER TABLE analyses ADD COLUMN IF NOT EXISTS pending_variants jsonb;

-- Quelle image de la planche porte le coloris choisi.
ALTER TABLE plan_images ADD COLUMN IF NOT EXISTS is_variant_reference boolean NOT NULL DEFAULT false;

-- Le produit identifié, pour ne pas le recalculer à la reprise.
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS product_ref text;
