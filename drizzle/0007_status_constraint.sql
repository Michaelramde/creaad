-- La table porte deux contraintes de statut : celle du DDL initial
-- (`analyses_status_check`) et celle du schéma Drizzle (`ck_analysis_states`).
-- N'en corriger qu'une laisse l'autre bloquer : on les aligne toutes les deux.
ALTER TABLE analyses DROP CONSTRAINT IF EXISTS analyses_status_check;
ALTER TABLE analyses ADD CONSTRAINT analyses_status_check CHECK (status IN (
  'creee','reservee','capture','ocr','appariement','bloquee_article',
  'variante_a_choisir','moisson','planche_prete','en_attente_validation',
  'recherche_marche','marche_pret','production','livree','echouee'
));
