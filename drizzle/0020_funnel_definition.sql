-- Migration 0020 — une seule définition du taux de livraison.
--
-- La vue 0017 divisait par TOUTES les analyses (77), y compris celles encore
-- en vol et les dossiers d'étape 1 déjà livrés : 24,7 %. La page /admin/metrics
-- divisait par les analyses TERMINÉES (60) : 31,7 %. Deux vérités pour le même
-- chiffre, exactement le défaut que l'audit reprochait au produit.
--
-- Définition retenue, désormais unique :
--   terminées   = livree + bloquee_article + planche_prete + echouee
--   taux_livraison = livree / terminées            (kits complets livrés)
--   dossier_etape1 = livree + produit_pret         (le commerçant a reçu quelque chose)
--   taux_dossier   = dossier_etape1 / (terminées + produit_pret)

-- CREATE OR REPLACE VIEW ne peut pas renommer ni réordonner des colonnes :
-- on supprime la vue avant de la redéfinir (aucune autre vue n'en dépend).
DROP VIEW IF EXISTS v_funnel;

CREATE VIEW v_funnel AS
WITH base AS (
  SELECT
    count(*)                                                                   AS analyses,
    count(*) FILTER (WHERE status IN ('livree','bloquee_article','planche_prete','echouee')) AS terminees,
    count(*) FILTER (WHERE status = 'livree')                                  AS livrees,
    count(*) FILTER (WHERE status = 'produit_pret')                            AS produit_pret,
    count(*) FILTER (WHERE status = 'bloquee_article')                         AS bloquees_article,
    count(*) FILTER (WHERE status = 'planche_prete')                           AS planches_refusees,
    count(*) FILTER (WHERE status = 'variante_a_choisir')                      AS variantes_en_attente,
    count(*) FILTER (WHERE status = 'echouee')                                 AS echouees,
    count(*) FILTER (WHERE status IN ('ocr','appariement'))                    AS en_cours
  FROM analyses
)
SELECT
  analyses,
  terminees,
  livrees,
  produit_pret,
  bloquees_article,
  planches_refusees,
  variantes_en_attente,
  echouees,
  en_cours,
  livrees + produit_pret                                                       AS dossiers_livres,
  round(100.0 * livrees / NULLIF(terminees, 0), 1)                             AS taux_livraison,
  round(100.0 * (livrees + produit_pret) / NULLIF(terminees + produit_pret, 0), 1) AS taux_dossier,
  round(100.0 * bloquees_article / NULLIF(terminees, 0), 1)                    AS taux_blocage,
  round(100.0 * planches_refusees / NULLIF(terminees, 0), 1)                   AS taux_planche_refusee,
  round(100.0 * echouees / NULLIF(terminees, 0), 1)                            AS taux_echec
FROM base;
