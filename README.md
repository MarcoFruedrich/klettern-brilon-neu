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

Für Mailtests nur ein isoliertes Testpostfach und einen Test-Maildienst verwenden. Die gewöhnlichen Unit- und HTTP-Tests verwenden ausschließlich lokale Test-Doubles und keine produktiven Datenbank-, Supabase- oder E-Mail-Dienste.

## Automatisierte Entwicklungstests

Der Workflow `.github/workflows/entwicklung-tests.yml` läuft nur für `entwicklung/phase-1-buchungen-sonderangebote-gps`. Er startet Node.js 22 und einen isolierten PostgreSQL-16-Dienst (`brilon_test`), führt `npm test` aus und prüft insbesondere parallele Buchungen, Zeitfenster, Tageskapazitäten und eindeutige Buchungsnummern. Die Server-Teststrecke ist mit **72 bestandenen Tests** grün. Ein zweiter GitHub-Actions-Job startet zusätzlich Chromium und prüft die Startseite, Verwaltung, GPS- und Anschlussseite bei vier Bildschirmgrößen sowie Mobilnavigation und das öffentliche Buchungsformular. Aktuell sind **11 Browser-Tests** erfolgreich (Testlauf 41528114360). Zusätzlich zum öffentlichen Buchungsformular werden der angemeldete Verwaltungsbereich auf drei Bildschirmbreiten, das Erstellen/Aktivieren/Bearbeiten von Programmen, die Suche und Statusänderung von Buchungen und das Hinzufügen neuer Veranstaltungsorte geprüft. Die Browser-Tests simulieren API-Antworten und Änderungsvorgänge ohne echte Kundenbuchungen oder E-Mails. Ein Belastungstest navigiert auf dem Smartphone durch **135 simulierte Buchungen**, filtert Buchungen und prüft die paginierte Zahlungsübersicht. Der isolierte PostgreSQL-Test prüft zusätzlich **127 tatsächlich gespeicherte Testbuchungen** über drei Seiten, reproduzierbare Sortierung bei gleichen Zeitstempeln und die Such- und Statusfilter. Die separate HTTP-Teststrecke prüft den echten Sitzungsschutz und die CSRF-Validierung. Die GPS-Spielzugangsverwaltung verwendet jetzt die eigene geschützte API `GET /api/admin/gps/buchungen`, welche bestätigte Buchungen für die ausgewählte aktive Tour in Schritten zu 30 Datensätzen nach Buchungsnummer, Name oder Datum durchsuchen kann. Die bisherige 250-Einträge-Grenze der allgemeinen Buchungsliste spielt dafür keine Rolle mehr. Ein Chromium-Test verwendet 330 simulierte Buchungen und prüft auch die Auswahl von Buchung 305; ein echter PostgreSQL-Test erfasst 340 GPS-bezogene Buchungen, darunter 310 bestätigte, und prüft alle elf Seiten. Keine echten Spielzugänge werden im Test ausgestellt.

## Ausgestellte GPS-Spielzugänge verwalten

Unter `/admin.html` werden ausgestellte GPS-Spielzugänge mit Buchungsreferenz, Tour, Start-/Abschlussstatus und möglichen Sperrungen angezeigt. `GET /api/admin/gps/spiele` lädt jeweils 30 Datensätze und kann nach Tour filtern. Die geheime Zugangs-URL wird **nur bei Erstellung** angezeigt; die Übersicht liefert niemals den Token oder seinen Hash. Nach ausdrücklicher Bestätigung sperrt `PATCH /api/admin/gps/spiele/:id/sperren` den Zugang dauerhaft. Das ist idempotent und wird durch die vorhandene Sitzung, Origin-Prüfung und CSRF-Schutz abgesichert. Gesperrte Zugänge dürfen das Spiel weder starten, fortsetzen noch eine Gästelistenfreigabe ändern. Die neue PostgreSQL-Spalte `brilon_gps_spiele.gesperrt_am` wird ausschließlich bei freigegebenen Schemaänderungen angelegt; bisher wurden solche Migrationen nur in einer temporären Testdatenbank ausgeführt. Die Testumgebung prüft auch fehlende Authentifizierung, fehlenden CSRF-Token und dass keine Geheimnisse in der API-Liste erscheinen.

Die Browsertests können in einer lokalen Entwicklungsumgebung mit `npm install --no-save --ignore-scripts playwright@1.56.1`, `npx playwright install chromium` und `node --test browser-tests/*.test.js` separat ausgeführt werden. `npm test` lädt bewusst ausschließlich die Server-Tests unter `test/*.test.js`.

Nur beim ausdrücklich gekennzeichneten lokalen Integrationstest kann `DATABASE_SSL_MODE=disable` verwendet werden. Das ist ausschließlich für Loopback-Adressen zulässig; andere Verbindungen bleiben TLS-gesichert. Die Testdatenbank hat keine Verbindung zum Livebetrieb. Die geschützten Schemaänderungen werden ausschließlich in dieser kurzlebigen Testdatenbank ausgeführt.


## Funktionsstand und Grenzen

Der aktuelle Entwicklungsstand und die Prüfergebnisse stehen in [`docs/STATUS-ENTWICKLUNG.md`](docs/STATUS-ENTWICKLUNG.md). Eine Briloner 15-Stationen-Mustertour ist in [`docs/GPS-MUSTERTOUR-BRILON-ENTWURF.md`](docs/GPS-MUSTERTOUR-BRILON-ENTWURF.md) als örtlich zu prüfender Entwurf dokumentiert.

Es gibt keine Zahlungsanbieterintegration. Zahlungen werden manuell als tatsächliche Zahlungseingänge erfasst. Vor einem produktiven Einsatz sind unter anderem Integrations- und Browserprüfungen, Datenschutz-/Löschkonzept, Sitzungsschutz und eine lokale Prüfung der GPS-Route erforderlich.

Die Arbeit liegt ausschließlich auf `entwicklung/phase-1-buchungen-sonderangebote-gps`. Sie ist nicht veröffentlicht. Keine produktive Migration, Veröffentlichung oder Zusammenführung mit `main` ohne ausdrückliche Freigabe.
