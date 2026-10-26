-- Migration 0018 — étiquettes d'angles, mises en cache.
--
-- Le classifieur par mots-clés mesurait 29 % de précision sur 24 annonces
-- réelles (mesuré le 25/10). Le modèle devient la source primaire ; cette
-- table rend le résultat **permanent** : une annonce étiquetée une fois ne
-- se repaie jamais, et deux mois plus tard la même matrice donne le même
-- résultat (auditabilité).
--
-- `label_version` invalide le cache quand la définition des familles change :
-- une matrice calculée avec l'ancienne taxonomie ne doit pas survivre.

CREATE TABLE IF NOT EXISTS hook_labels (
  hash          text PRIMARY KEY,
  family        text NOT NULL,
  label_version integer NOT NULL DEFAULT 1,
  model         text,
  source        text NOT NULL DEFAULT 'llm',
  sample        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_hook_labels_version ON hook_labels (label_version, created_at);

-- Le kit marché dépend du classifieur : il faut pouvoir l'invalider.
ALTER TABLE market_kits ADD COLUMN IF NOT EXISTS label_version integer NOT NULL DEFAULT 1;
