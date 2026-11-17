-- Add partner-house contact and billing settings to existing locations.
-- Existing locations, offers, booking requests and booking groups are preserved.
ALTER TABLE brilon_orte
  ADD COLUMN IF NOT EXISTS partnerhaus BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS partnerkontakt_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS partnerkontakt_email TEXT NOT NULL DEFAULT '';
