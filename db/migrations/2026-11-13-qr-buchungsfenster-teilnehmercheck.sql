-- QR booking windows, per-group capacity and a separate hostel notification address.
ALTER TABLE brilon_kalender DROP CONSTRAINT IF EXISTS brilon_kalender_typ_check;
ALTER TABLE brilon_kalender ADD CONSTRAINT brilon_kalender_typ_check
  CHECK (typ IN ('termin','sperrzeit','buchungsfenster'));
ALTER TABLE brilon_kalender
  ADD COLUMN IF NOT EXISTS programm_id BIGINT,
  ADD COLUMN IF NOT EXISTS gruppen_kapazitaet INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS automatisch_angelegt BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE brilon_kalender DROP CONSTRAINT IF EXISTS brilon_kalender_gruppen_kapazitaet_check;
ALTER TABLE brilon_kalender ADD CONSTRAINT brilon_kalender_gruppen_kapazitaet_check
  CHECK (gruppen_kapazitaet BETWEEN 1 AND 150);
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
  UNIQUE (buchung_id,mitarbeiter_id)
);
CREATE INDEX IF NOT EXISTS brilon_mitarbeiter_buchungsinteressen_buchung_idx
  ON brilon_mitarbeiter_buchungsinteressen(buchung_id,status,erstellt_am);
CREATE TABLE IF NOT EXISTS brilon_mitarbeiter_buchungsbestaetigungen (
  id UUID PRIMARY KEY,
  buchung_id UUID NOT NULL UNIQUE REFERENCES brilon_buchungen(id) ON DELETE CASCADE,
  mitarbeiter_id UUID NOT NULL REFERENCES brilon_pruef_mitarbeitende(id),
  zugesagt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  versand_nach TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'ausstehend'
    CHECK (status IN ('ausstehend','wird_versendet','angenommen','fehlgeschlagen','abgebrochen')),
  letzter_fehler TEXT,versendet_am TIMESTAMPTZ,aktualisiert_am TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS brilon_mitarbeiter_buchungsbestaetigungen_ausstehend_idx
  ON brilon_mitarbeiter_buchungsbestaetigungen(versand_nach,id) WHERE status='ausstehend';
ALTER TABLE brilon_netzwerkpartner
  ADD COLUMN IF NOT EXISTS programm_benachrichtigung_email TEXT;
CREATE TABLE IF NOT EXISTS brilon_partner_terminanfragen(
  id UUID PRIMARY KEY,
  netzwerkpartner_id UUID NOT NULL REFERENCES brilon_netzwerkpartner(id) ON DELETE CASCADE,
  datum DATE NOT NULL,
  uhrzeit TIME NOT NULL,
  programm TEXT NOT NULL,
  personen INTEGER NOT NULL CHECK(personen BETWEEN 1 AND 150),
  nachricht TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'offen',
  mail_status TEXT,
  erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS brilon_partner_terminanfragen_datum_idx
  ON brilon_partner_terminanfragen(datum, erstellt_am DESC);
