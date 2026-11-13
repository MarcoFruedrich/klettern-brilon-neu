-- Opt-in schema for the staff calendar and trusted employee confirmations.
-- Apply only to the development database after reviewing the target environment.
ALTER TABLE brilon_pruef_mitarbeitende
  ADD COLUMN IF NOT EXISTS terminbestaetigung_freigegeben BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS brilon_mitarbeiter_buchungsinteressen (
  id UUID PRIMARY KEY,
  buchung_id UUID NOT NULL REFERENCES brilon_buchungen(id) ON DELETE CASCADE,
  mitarbeiter_id UUID NOT NULL REFERENCES brilon_pruef_mitarbeitende(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'interesse'
    CHECK (status IN ('interesse','vorlaeufig_bestaetigt','zugewiesen','zurueckgezogen')),
  erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  aktualisiert_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (buchung_id, mitarbeiter_id)
);
CREATE INDEX IF NOT EXISTS brilon_mitarbeiter_buchungsinteressen_buchung_idx
  ON brilon_mitarbeiter_buchungsinteressen(buchung_id, status, erstellt_am);

CREATE TABLE IF NOT EXISTS brilon_mitarbeiter_buchungsbestaetigungen (
  id UUID PRIMARY KEY,
  buchung_id UUID NOT NULL UNIQUE REFERENCES brilon_buchungen(id) ON DELETE CASCADE,
  mitarbeiter_id UUID NOT NULL REFERENCES brilon_pruef_mitarbeitende(id),
  zugesagt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  versand_nach TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'ausstehend'
    CHECK (status IN ('ausstehend','wird_versendet','angenommen','fehlgeschlagen','abgebrochen')),
  letzter_fehler TEXT,
  versendet_am TIMESTAMPTZ,
  aktualisiert_am TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS brilon_mitarbeiter_buchungsbestaetigungen_ausstehend_idx
  ON brilon_mitarbeiter_buchungsbestaetigungen(versand_nach, id)
  WHERE status = 'ausstehend';
