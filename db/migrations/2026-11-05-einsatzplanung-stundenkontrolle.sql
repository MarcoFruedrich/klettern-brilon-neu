-- Einsatzplanung: ausdrücklich nur nach Freigabe in der produktiven Datenbank ausführen.
-- Kein automatisches Überschreiben bestehender Buchungen oder Mitarbeiterdaten.
CREATE TABLE IF NOT EXISTS brilon_beschaeftigung (
  mitarbeiter_id UUID PRIMARY KEY REFERENCES brilon_pruef_mitarbeitende(id) ON DELETE CASCADE,
  art TEXT NOT NULL DEFAULT 'nicht_hinterlegt' CHECK (art IN ('nicht_hinterlegt','minijob','teilzeit','vollzeit','honorar')),
  stundenlohn_cent INTEGER CHECK(stundenlohn_cent IS NULL OR stundenlohn_cent BETWEEN 0 AND 100000),
  wochenstunden NUMERIC(6,2) CHECK(wochenstunden IS NULL OR wochenstunden BETWEEN 0 AND 80),
  monatsstunden NUMERIC(7,2) CHECK(monatsstunden IS NULL OR monatsstunden BETWEEN 0 AND 350),
  minijob_grenze_cent INTEGER CHECK(minijob_grenze_cent IS NULL OR minijob_grenze_cent BETWEEN 0 AND 1000000),
  gueltig_ab DATE,
  gueltig_bis DATE,
  aktualisiert_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(gueltig_bis IS NULL OR gueltig_ab IS NULL OR gueltig_bis>=gueltig_ab)
);
CREATE TABLE IF NOT EXISTS brilon_einsaetze (
  buchung_id UUID NOT NULL REFERENCES brilon_buchungen(id) ON DELETE CASCADE,
  mitarbeiter_id UUID NOT NULL REFERENCES brilon_pruef_mitarbeitende(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('beworben','eingeteilt','bestaetigt','abgelehnt','abgeschlossen')),
  arbeitsminuten INTEGER CHECK(arbeitsminuten IS NULL OR arbeitsminuten BETWEEN 1 AND 1440),
  ist_minuten INTEGER CHECK(ist_minuten IS NULL OR ist_minuten BETWEEN 0 AND 1440),
  bewerbung_am TIMESTAMPTZ,
  zugewiesen_am TIMESTAMPTZ,
  bestaetigt_am TIMESTAMPTZ,
  abgeschlossen_am TIMESTAMPTZ,
  aktualisiert_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(buchung_id,mitarbeiter_id)
);
CREATE INDEX IF NOT EXISTS brilon_einsaetze_mitarbeiter_idx ON brilon_einsaetze(mitarbeiter_id,status);
CREATE INDEX IF NOT EXISTS brilon_einsaetze_buchung_idx ON brilon_einsaetze(buchung_id);
