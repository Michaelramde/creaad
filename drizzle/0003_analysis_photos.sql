-- Photos envoyées par le commerçant, conservées pour l'affichage du résultat
-- même lorsque l'article n'est pas reconnu (aucune planche n'existe alors).
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS photos jsonb NOT NULL DEFAULT '[]'::jsonb;
