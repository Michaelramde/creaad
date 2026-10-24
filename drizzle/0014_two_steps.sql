-- Étape 1 : toutes les images, toutes les specs, les avis.
-- Étape 2 : facturation distincte.

ALTER TABLE product_records ADD COLUMN IF NOT EXISTS description_url text;
ALTER TABLE product_records ADD COLUMN IF NOT EXISTS reviews jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE analyses ADD COLUMN IF NOT EXISTS step2_reserved_xof integer NOT NULL DEFAULT 0;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS step2_settled_xof integer NOT NULL DEFAULT 0;

-- Le dossier produit est un état livrable : il faut pouvoir le nommer.
-- Les DEUX contraintes existent en base ; n'en corriger qu'une laisse l'autre bloquer.
ALTER TABLE analyses DROP CONSTRAINT IF EXISTS analyses_status_check;
ALTER TABLE analyses ADD CONSTRAINT analyses_status_check CHECK (status IN (
  'creee','reservee','capture','ocr','appariement','bloquee_article',
  'variante_a_choisir','produit_pret','moisson','planche_prete','en_attente_validation',
  'recherche_marche','marche_pret','production','livree','echouee'
));

ALTER TABLE analyses DROP CONSTRAINT IF EXISTS ck_analysis_states;
ALTER TABLE analyses ADD CONSTRAINT ck_analysis_states CHECK (status IN (
  'creee','reservee','capture','ocr','appariement','bloquee_article',
  'variante_a_choisir','produit_pret','moisson','planche_prete','en_attente_validation',
  'recherche_marche','marche_pret','production','livree','echouee'
));
