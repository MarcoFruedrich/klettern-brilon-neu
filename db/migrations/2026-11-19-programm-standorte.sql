-- Opt-in, additive migration. Run against an isolated test database first.
-- Historical programme assignments and booking records remain untouched.
BEGIN;
ALTER TABLE brilon_angebote ADD COLUMN IF NOT EXISTS standorte TEXT[];
UPDATE brilon_angebote
  SET standorte=ARRAY[veranstaltungsort]
  WHERE standorte IS NULL OR cardinality(standorte)=0;
ALTER TABLE brilon_angebote ALTER COLUMN standorte SET DEFAULT ARRAY['Brilon']::TEXT[];
ALTER TABLE brilon_angebote ALTER COLUMN standorte SET NOT NULL;
CREATE INDEX IF NOT EXISTS brilon_angebote_standorte_idx ON brilon_angebote USING GIN(standorte);
COMMIT;
