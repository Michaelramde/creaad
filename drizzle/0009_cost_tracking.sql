-- Traçabilité exacte des coûts Apify.
-- `usageTotalUsd` n'est écrit qu'après la fin de l'exécution : on peut lire 0
-- alors que l'appel a bien été facturé. On marque donc les lignes estimées et
-- on conserve l'identifiant d'exécution pour pouvoir les corriger ensuite.
ALTER TABLE pipeline_costs ADD COLUMN IF NOT EXISTS estimated boolean NOT NULL DEFAULT false;
ALTER TABLE pipeline_costs ADD COLUMN IF NOT EXISTS external_id text;

CREATE INDEX IF NOT EXISTS ix_costs_external ON pipeline_costs (provider, external_id);
CREATE INDEX IF NOT EXISTS ix_costs_estimated ON pipeline_costs (estimated, created_at);
