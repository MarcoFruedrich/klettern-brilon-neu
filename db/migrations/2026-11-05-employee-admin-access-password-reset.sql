-- Separate, revocable Verwaltung role and one-time password reset support.
-- Run on an isolated test database first; never enable automatically on production.
BEGIN;

ALTER TABLE brilon_pruef_mitarbeitende
  ADD COLUMN IF NOT EXISTS verwaltungszugang BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS brilon_pruef_admin_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  mitarbeiter_id UUID NOT NULL REFERENCES brilon_pruef_mitarbeitende(id) ON DELETE CASCADE,
  ablauf TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS brilon_pruef_admin_sessions_ablauf_idx
  ON brilon_pruef_admin_sessions(ablauf);

CREATE TABLE IF NOT EXISTS brilon_pruef_login_fehler (
  email_hash CHAR(64) PRIMARY KEY,
  versuche INTEGER NOT NULL DEFAULT 0,
  fenster_am TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brilon_pruef_passwort_resets (
  token_hash CHAR(64) PRIMARY KEY,
  mitarbeiter_id UUID NOT NULL REFERENCES brilon_pruef_mitarbeitende(id) ON DELETE CASCADE,
  ablauf TIMESTAMPTZ NOT NULL,
  verwendet_am TIMESTAMPTZ,
  erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS brilon_pruef_passwort_resets_expiry_idx
  ON brilon_pruef_passwort_resets(ablauf);

COMMIT;
