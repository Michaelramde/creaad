-- Migration 0001 — résultat d'appariement (J1)
-- On conserve la décision d'appariement et sa couverture pour l'audit :
-- « pourquoi cette annonce a-t-elle été retenue ? » doit rester répondable.

ALTER TABLE analyses ADD COLUMN IF NOT EXISTS match_score integer;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS match_coverage numeric(3,2);
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS match_result jsonb;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS archetype_slug text;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS manual_confirmed_at timestamptz;

CREATE INDEX IF NOT EXISTS ix_analyses_archetype ON analyses(archetype_slug);

ALTER TABLE analyses DROP CONSTRAINT IF EXISTS ck_analysis_match_score;
ALTER TABLE analyses ADD CONSTRAINT ck_analysis_match_score
  CHECK (match_score IS NULL OR match_score BETWEEN 0 AND 100);
