-- Migration 0017 — vues de pilotage.
--
-- Deux vues, deux questions que le dépôt ne savait pas répondre :
--   v_funnel  : quel pourcentage des analyses livrent réellement ?
--   v_costs   : combien coûte chaque étape, vraiment ?
--
-- Ce sont des vues, pas des tables : aucun coût d'écriture, aucune
-- synchronisation à maintenir. /admin/metrics interroge les mêmes agrégats
-- via Drizzle ; les vues servent au diagnostic SQL direct et au runbook.

CREATE OR REPLACE VIEW v_funnel AS
SELECT
  count(*)                                                              AS analyses,
  count(*) FILTER (WHERE status = 'livree')                             AS livrees,
  count(*) FILTER (WHERE status = 'produit_pret')                       AS produit_pret,
  count(*) FILTER (WHERE status = 'bloquee_article')                    AS bloquees_article,
  count(*) FILTER (WHERE status = 'planche_prete')                      AS planches_refusees,
  count(*) FILTER (WHERE status = 'variante_a_choisir')                 AS variantes_en_attente,
  count(*) FILTER (WHERE status = 'echouee')                            AS echouees,
  count(*) FILTER (WHERE status IN ('ocr', 'appariement'))               AS en_cours,
  round(100.0 * count(*) FILTER (WHERE status = 'livree') / NULLIF(count(*), 0), 1)        AS taux_livraison,
  round(100.0 * count(*) FILTER (WHERE status = 'bloquee_article') / NULLIF(count(*), 0), 1) AS taux_blocage,
  round(100.0 * count(*) FILTER (WHERE status = 'planche_prete') / NULLIF(count(*), 0), 1)   AS taux_planche_refusee
FROM analyses;

-- Coût réel par étape : l'arbitre unique des chiffres contradictoires
-- (0,02 $ contre 0,101 $ pour la même recherche).
CREATE OR REPLACE VIEW v_costs AS
SELECT
  step,
  provider,
  count(*)                              AS appels,
  round(avg(cost_usd)::numeric, 5)      AS cout_moyen_usd,
  round(sum(cost_usd)::numeric, 4)      AS cout_total_usd,
  sum((estimated)::int)                 AS lignes_estimees,
  max(created_at)                       AS dernier_appel
FROM pipeline_costs
GROUP BY step, provider;

-- Coût par analyse livrée : le seul chiffre qui décide de la marge.
CREATE OR REPLACE VIEW v_cost_per_delivery AS
SELECT
  (SELECT count(*) FROM analyses WHERE status = 'livree')                    AS analyses_livrees,
  (SELECT coalesce(sum(cost_usd), 0) FROM pipeline_costs WHERE step <> 'payment_fee') AS cout_total_usd,
  round(
    (SELECT coalesce(sum(cost_usd), 0) FROM pipeline_costs WHERE step <> 'payment_fee')
    / NULLIF((SELECT count(*) FROM analyses WHERE status = 'livree'), 0)
  , 5)                                                                        AS cout_par_livraison_usd;
