-- Calendar import only; stores no customer, participant, or employee details.
CREATE TABLE IF NOT EXISTS brilon_teamerbase_programme (
  id BIGSERIAL PRIMARY KEY,
  source_name TEXT NOT NULL,
  standort TEXT NOT NULL,
  angezeigter_name TEXT NOT NULL,
  turm_bedarf TEXT NOT NULL DEFAULT 'pruefen'
    CHECK (turm_bedarf IN ('pruefen', 'turm', 'kein_turm')),
  ignoriert BOOLEAN NOT NULL DEFAULT false,
  zuletzt_gesehen_am TIMESTAMPTZ,
  erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  aktualisiert_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_name, standort)
);

CREATE TABLE IF NOT EXISTS brilon_teamerbase_termine (
  source_uid TEXT PRIMARY KEY,
  titel TEXT NOT NULL,
  standort TEXT NOT NULL,
  datum DATE NOT NULL,
  uhrzeit TIME,
  enddatum DATE,
  endzeit TIME,
  ganztags BOOLEAN NOT NULL DEFAULT false,
  storniert BOOLEAN NOT NULL DEFAULT false,
  zuletzt_gesehen_am TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS brilon_teamerbase_termine_datum_idx
  ON brilon_teamerbase_termine (datum) WHERE storniert = false;

CREATE TABLE IF NOT EXISTS brilon_teamerbase_sync_status (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  zuletzt_geprueft_am TIMESTAMPTZ,
  letzter_fehler TEXT,
  anzahl_termine INTEGER NOT NULL DEFAULT 0
);
