# Klettern & Abenteuer Brilon

Responsive Website, Buchungsanfragen, PostgreSQL-Anbindung und Verwaltungsbereich.

## Lokal starten

1. Node.js 20+ installieren und `npm install` ausführen.
2. Eine isolierte Entwicklungsdatenbank einrichten und `.env.example` nach `.env` kopieren. Nur Testzugänge eintragen.
3. `npm start` starten und `http://localhost:3000` öffnen. Die Verwaltung liegt unter `/admin.html`.
4. Automatisierte Fachtests mit `npm test` ausführen.

Schemaänderungen sind standardmäßig deaktiviert. `RUN_SCHEMA_MIGRATIONS=true` darf nur in einer eigens angelegten Testdatenbank und nach Prüfung des Schemas gesetzt werden.

## Konfiguration

- Buchungsdatenbank: `DATABASE_URL`
- Admin: `ADMIN_USER`, `ADMIN_PASSWORD`
- Mailversand: `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, optional `BOOKING_NOTIFY_EMAIL`
- Personalisierte Anschlusslinks: `PUBLIC_BASE_URL` (HTTPS) und `BOOKING_OFFER_SECRET` (mindestens 32 Zeichen)
- GPS-Kontrollcodes: `GPS_CODE_SECRET` (mindestens 32 Zeichen)

Für Mailtests nur ein isoliertes Testpostfach und einen Test-Maildienst verwenden. Automatisierte Tests rufen keine Datenbank, Supabase oder E-Mail-Dienste auf.

## Funktionsstand und Grenzen

Der aktuelle Entwicklungsstand und die Prüfergebnisse stehen in [`docs/STATUS-ENTWICKLUNG.md`](docs/STATUS-ENTWICKLUNG.md). Eine Briloner 15-Stationen-Mustertour ist in [`docs/GPS-MUSTERTOUR-BRILON-ENTWURF.md`](docs/GPS-MUSTERTOUR-BRILON-ENTWURF.md) als örtlich zu prüfender Entwurf dokumentiert.

Es gibt keine Zahlungsanbieterintegration. Zahlungen werden manuell als tatsächliche Zahlungseingänge erfasst. Vor einem produktiven Einsatz sind unter anderem Integrations- und Browserprüfungen, Datenschutz-/Löschkonzept, Sitzungsschutz und eine lokale Prüfung der GPS-Route erforderlich.

Die Arbeit liegt ausschließlich auf `entwicklung/phase-1-buchungen-sonderangebote-gps`. Sie ist nicht veröffentlicht. Keine produktive Migration, Veröffentlichung oder Zusammenführung mit `main` ohne ausdrückliche Freigabe.
