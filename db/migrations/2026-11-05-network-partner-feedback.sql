-- Additive, idempotent schema for separate network partner accounts and private customer feedback.
-- Run against an isolated test database first. This file does not alter existing booking rows.

CREATE TABLE IF NOT EXISTS brilon_netzwerkpartner (
  id UUID PRIMARY KEY,
  unternehmen TEXT NOT NULL CHECK(length(unternehmen) BETWEEN 2 AND 180),
  ansprechpartner TEXT NOT NULL CHECK(length(ansprechpartner) BETWEEN 2 AND 120),
  email TEXT NOT NULL UNIQUE,
  telefon TEXT,
  strasse TEXT,
  plz TEXT,
  ort TEXT,
  weitere_angaben TEXT,
  passwort_hash TEXT NOT NULL,
  aktiv BOOLEAN NOT NULL DEFAULT false,
  erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  freigabe_am TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS brilon_netzwerkpartner_einladungen (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  ablauf TIMESTAMPTZ NOT NULL,
  erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verwendet_am TIMESTAMPTZ,
  widerrufen_am TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS brilon_netzwerkpartner_einladungen_offen_email_idx
  ON brilon_netzwerkpartner_einladungen(email)
  WHERE verwendet_am IS NULL AND widerrufen_am IS NULL;

CREATE TABLE IF NOT EXISTS brilon_netzwerkpartner_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  netzwerkpartner_id UUID NOT NULL REFERENCES brilon_netzwerkpartner(id) ON DELETE CASCADE,
  ablauf TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS brilon_netzwerkpartner_sessions_ablauf_idx
  ON brilon_netzwerkpartner_sessions(ablauf);

CREATE TABLE IF NOT EXISTS brilon_kundenfeedback (
  id UUID PRIMARY KEY,
  buchung_id UUID NOT NULL REFERENCES brilon_buchungen(id) ON DELETE CASCADE,
  buchungsnummer TEXT NOT NULL,
  programm_bewertung SMALLINT NOT NULL CHECK(programm_bewertung BETWEEN 1 AND 5),
  mitarbeiter_bewertung SMALLINT NOT NULL CHECK(mitarbeiter_bewertung BETWEEN 1 AND 5),
  sicherheits_bewertung SMALLINT NOT NULL CHECK(sicherheits_bewertung BETWEEN 1 AND 5),
  veraenderungen TEXT,
  ideen TEXT,
  einwilligung_am TIMESTAMPTZ NOT NULL,
  einwilligung_version TEXT NOT NULL,
  erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(buchung_id)
);
CREATE INDEX IF NOT EXISTS brilon_kundenfeedback_erstellt_idx
  ON brilon_kundenfeedback(erstellt_am DESC);
