-- Migration 0019 — machine à états réduite à ce qui existe vraiment.
--
-- La SPEC décrit 16 états ; 8 n'ont JAMAIS été écrits ni lus par le code
-- (mesuré le 25/10 : grep sur tout src/). Les garder dans la contrainte, c'est
-- laisser croire qu'un flux existe alors qu'il n'a pas d'implémentation.
--
-- États conservés : creee, ocr, appariement, variante_a_choisir, produit_pret,
-- planche_prete, bloquee_article, livree, echouee.
-- États retirés : reservee, capture, moisson, en_attente_validation,
-- recherche_marche, marche_pret, production.

-- Sécurité : aucun statut hors liste ne doit subsister avant de resserrer.
UPDATE analyses SET status = 'echouee', failure_code = coalesce(failure_code, 'LEGACY_STATE')
WHERE status IN ('reservee', 'capture', 'moisson', 'en_attente_validation',
                 'recherche_marche', 'marche_pret', 'production');

ALTER TABLE analyses DROP CONSTRAINT IF EXISTS ck_analysis_states;
ALTER TABLE analyses DROP CONSTRAINT IF EXISTS analyses_status_check;

ALTER TABLE analyses ADD CONSTRAINT ck_analysis_states CHECK (status IN (
  'creee', 'ocr', 'appariement', 'variante_a_choisir', 'produit_pret',
  'planche_prete', 'bloquee_article', 'livree', 'echouee'
));
