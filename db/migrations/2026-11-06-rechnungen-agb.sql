-- Additive invoice and booking-terms storage. Run once against the intended database.
CREATE TABLE IF NOT EXISTS brilon_rechnungsdaten (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  naechste_nummer INTEGER NOT NULL DEFAULT 1 CHECK (naechste_nummer > 0),
  aktualisiert_am TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO brilon_rechnungsdaten(id, data, naechste_nummer)
VALUES (1, jsonb_build_object(
  'agbVersion', 1,
  'agbAktiv', false,
  'empfehlungAktiv', false,
  'empfehlungRabattArt', 'prozent',
  'empfehlungRabattWert', '',
  'empfehlungsText', E'Freunde werben Freunde! Empfiehl uns gerne weiter. So können Freunde und Bekannte ebenfalls von deinen positiven Erfahrungen profitieren. Wenn sie bei ihrer Anfrage deine Kontakt-E-Mail-Adresse als Empfehlungsgeber angeben und eine frühere bestätigte Buchung damit nachgewiesen wird, erhalten sie den aktuell in der Verwaltung festgelegten Rabatt.',
  'agbText', E'MUSTER – bitte vor der Veröffentlichung rechtlich prüfen und an das konkrete Angebot anpassen.\n\n1. Buchung und Zahlung\nDie Buchungsanfrage wird erst nach Bestätigung durch Klettern & Abenteuer verbindlich. Für Gruppenveranstaltungen werden 25 % Anzahlung innerhalb der mitgeteilten Frist fällig; der Restbetrag ist spätestens am Veranstaltungstag zu zahlen.\n\n2. Rücktritt durch den Kunden\nEin kostenfreier Rücktritt ist bis einschließlich zehn Kalendertage vor dem Veranstaltungstermin möglich. Bei einem späteren Rücktritt kann ein angemessener Ersatz des konkret entstandenen Schadens verlangt werden. Eine pauschalierte Stornopauschale darf nur verwendet werden, wenn sie den typischerweise zu erwartenden Schaden nicht übersteigt und dem Kunden ausdrücklich der Nachweis gestattet wird, dass kein oder ein wesentlich geringerer Schaden entstanden ist. Ersparte Aufwendungen und eine anderweitige Besetzung des Termins werden berücksichtigt.\n\n3. Nichterscheinen\nErscheint die Gruppe ohne rechtzeitige Absage nicht, wird nicht automatisch der gesamte Preis als Vertragsstrafe einbehalten. Klettern & Abenteuer kann einen nachweisbaren Anspruch auf Ersatz des entstandenen Schadens geltend machen; ersparte Aufwendungen und anderweitige Verwertung werden berücksichtigt. Der Kunde darf nachweisen, dass kein oder ein wesentlich geringerer Schaden entstanden ist.\n\n4. Absage durch Klettern & Abenteuer\nBei einer Absage durch Klettern & Abenteuer werden bereits geleistete Zahlungen für die nicht erbrachte Leistung erstattet oder nach Wahl des Kunden auf einen Ersatztermin angerechnet. Gesetzliche Rechte bleiben unberührt.\n\n5. Widerruf\nFür Freizeitdienstleistungen mit einem spezifischen Termin kann das gesetzliche Widerrufsrecht ausgeschlossen sein. Die konkrete Anwendbarkeit hängt vom gebuchten Angebot ab; gesetzliche Rechte bleiben unberührt.'
), 1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS brilon_rechnungen (
  id UUID PRIMARY KEY,
  buchung_id UUID NOT NULL UNIQUE REFERENCES brilon_buchungen(id) ON DELETE RESTRICT,
  rechnungsnummer TEXT NOT NULL UNIQUE,
  data JSONB NOT NULL,
  pdf BYTEA NOT NULL,
  email_status TEXT NOT NULL DEFAULT 'ausstehend'
    CHECK (email_status IN ('ausstehend','angenommen','fehlgeschlagen','unklar','ohne_empfaenger')),
  email_fehler TEXT,
  erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  versandt_am TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS brilon_rechnungen_erstellt_idx ON brilon_rechnungen(erstellt_am DESC);

CREATE TABLE IF NOT EXISTS brilon_buchungswiderrufe (
  id UUID PRIMARY KEY,
  buchung_id UUID NOT NULL REFERENCES brilon_buchungen(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  angefragt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ablauf TIMESTAMPTZ NOT NULL,
  bestaetigt_am TIMESTAMPTZ,
  abgeschlossen_am TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'bestaetigung_ausstehend'
    CHECK (status IN ('bestaetigung_ausstehend','bestaetigt','abgelaufen','fehlgeschlagen')),
  anfrage_email TEXT NOT NULL,
  erstellt_am TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS brilon_buchungswiderrufe_buchung_idx ON brilon_buchungswiderrufe(buchung_id,erstellt_am DESC);
CREATE INDEX IF NOT EXISTS brilon_buchungswiderrufe_ablauf_idx ON brilon_buchungswiderrufe(ablauf) WHERE status='bestaetigung_ausstehend';
ALTER TABLE brilon_buchungswiderrufe ADD COLUMN IF NOT EXISTS anliegen TEXT NOT NULL DEFAULT 'widerruf';
ALTER TABLE brilon_buchungswiderrufe ADD COLUMN IF NOT EXISTS wunschdatum DATE;
ALTER TABLE brilon_buchungswiderrufe ADD COLUMN IF NOT EXISTS wunschzeit TIME;
ALTER TABLE brilon_buchungswiderrufe DROP CONSTRAINT IF EXISTS brilon_buchungswiderrufe_status_check;
ALTER TABLE brilon_buchungswiderrufe ADD CONSTRAINT brilon_buchungswiderrufe_status_check
  CHECK (status IN ('bestaetigung_ausstehend','bestaetigt','wartet_verwaltung','freigegeben','abgelehnt','abgelaufen','fehlgeschlagen'));
ALTER TABLE brilon_buchungswiderrufe DROP CONSTRAINT IF EXISTS brilon_buchungswiderrufe_anliegen_check;
ALTER TABLE brilon_buchungswiderrufe ADD CONSTRAINT brilon_buchungswiderrufe_anliegen_check
  CHECK (anliegen IN ('widerruf','umbuchung'));
CREATE INDEX IF NOT EXISTS brilon_umbuchungsanfragen_status_idx
  ON brilon_buchungswiderrufe(status,angefragt_am DESC) WHERE anliegen='umbuchung';

ALTER TABLE brilon_buchungen ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
