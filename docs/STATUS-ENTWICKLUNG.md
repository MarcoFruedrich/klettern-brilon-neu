# Entwicklungsstand – Phase 1 Buchungen, Sonderangebote und GPS

Stand: 2. November 2026  
Arbeitszweig: `entwicklung/phase-1-buchungen-sonderangebote-gps`

## Ausgangsbefund

- Die Website enthielt ein Anfrageformular mit getrennten Vor- und Nachnamen, eine PostgreSQL-Anbindung, eine Admin-Sitzung, eine grundlegende Kalender- und Sperrzeitenverwaltung sowie Programme mit einfachen Teilnehmerpreisstaffeln.
- Buchungsnummern nach `NACHNAME-VORNAME-TTMMJJ` und ein DB-Unique-Index waren bereits vorgesehen. Eine globale PostgreSQL-Advisory-Lock-Transaktion serialisiert parallele Buchungen innerhalb der Anwendung.
- Die bisherige Zahlungsverwaltung speicherte einen auswählbaren Zahlungsstatus, aber keine einzelnen Zahlungseingänge. Die angezeigten Zahlungssummen waren daraus pauschal abgeleitet.
- Anschlussrabatte unterstützten eine Vorschau und hatten eine isolierte Berechnungsfunktion. Eine kontrollierte Freigabe, Preisänderung und Verknüpfung mit Zahlungen fehlte.
- Eine GPS-Verwaltung, gespeicherte Touren und Gruppen-Spielstände waren nicht vorhanden.
- Die Administrationsoberfläche hatte keine Suche oder Statusfilter. Sie nutzte eine fließende Kartenansicht, jedoch keine geprüfte Viewport-Testautomatisierung.
- Das Startskript führte beim Start `CREATE`-/`ALTER`-Anweisungen aus. Es gab kein `npm test`-Skript. E-Mail-Absender und Betreiberbenachrichtigung waren im Quellcode fest eingetragen.

## Umgesetzt in diesem Abschnitt

- `npm test` startet jetzt die Node-Test-Suite.
- Buchungsstatus, Zeitfenster, Teilnehmerpreisstaffeln, Centbeträge und Zahlungssalden sind als reine Funktionen prüfbar.
- Admins können tatsächliche Zahlungseingänge mit Betrag, Zahlungsart und Erfassungszeitpunkt einzeln buchen. Überzahlungen und ungültige Zahlungsarten werden abgelehnt. Sobald die reale Summe 25 % erreicht, wird eine offene Buchung bestätigt. Die Zahlungen liegen in der vorhandenen JSONB-Buchungszeile; es ist keine neue Tabellenmigration nötig.
- Die Verwaltungsansicht zeigt eingegangene Beträge, den offenen Rest und den Status der Anzahlung. Die Liste kann nach Status und Text gefiltert werden.
- Überweisungsinformationen setzen die stabile Buchungsnummer als Verwendungszweck ein.
- E-Mail-Absender und Betreiberempfänger sind nicht mehr fest im Code hinterlegt; sie werden über `BREVO_SENDER_EMAIL` und `BOOKING_NOTIFY_EMAIL` konfiguriert. Der Bildspeicher ist optional und wird ohne Konfiguration sauber abgewiesen.
- Schemaänderungen werden nur noch ausgeführt, wenn `RUN_SCHEMA_MIGRATIONS=true` gesetzt ist. Kein produktiver Datenbankzugriff oder Schemaänderung wurde in dieser Arbeit ausgeführt.
- GPS-Touren sind über den Admin anlegbar, bearbeitbar sowie aktivierbar/deaktivierbar. Stationen enthalten Koordinaten, zwei Antworten und gehashte Kontrollcodes.
- Eine GPS-Tour erzeugt ein passendes buchbares Programm mit Gruppenpreis. Spielzugänge lassen sich nur für bestätigte Buchungen desselben Programms ausstellen.
- Für bestätigte Buchungen lassen sich einzelne Spielzugänge ausstellen. Gruppenstände, Start-/Abschlusszeit und Dauer werden gespeichert. Die mobile Spielseite prüft QR-Kennung, Zahlencode und Antwort; spätere Stationskoordinaten werden nie an den Browser ausgeliefert.
- Die Gästeliste zeigt nur abgeschlossene Spiele mit ausdrücklicher Zustimmung zur Namensveröffentlichung. Ohne Zustimmung wird kein Name gespeichert.
- GPS-Kontrollcodes werden mit HMAC gehasht; Spielzugänge werden nur gehasht gespeichert. Das Geheimnis `GPS_CODE_SECRET` ist erforderlich.
- Unmögliche Kalendertage werden beim Erstellen einer Anfrage als Eingabefehler zurückgewiesen.

## Prüfergebnisse

Ausgeführt lokal ohne Datenbank, SMTP/Brevo, Supabase oder externe E-Mail:

- `node --check server.js` – bestanden.
- `node --check site/admin.js` – bestanden.
- `npm test` – 17 bestanden, 0 fehlgeschlagen.
- `git diff --check` – bestanden.

Die Datenbank- und E-Mail-Routen wurden nicht gegen Produktivdienste aufgerufen. Es wurden keine UI-Viewport- oder Browsertests ausgeführt.

## Noch offen

- Die Buchungs-API, Datenbanktransaktionen und Mailbenachrichtigungen benötigen Integrationstests mit Test-Doubles für PostgreSQL und Mailtransport.
- Eine Admin-Sitzung wird im Arbeitsspeicher gehalten. Für mehrere Instanzen/Neustarts fehlt weiterhin ein persistenter Session-Store; zusätzlich sind CSRF-/Origin-Prüfung, Sitzungsrotation und ein zweiter Faktor zu prüfen.
- Such- und Statusfilter sind clientseitig und begrenzen nicht die geladene Ergebnismenge von 250 Einträgen.
- Der Programmstamm braucht Kategorien, Zielgruppen, Veranstaltungsorte, Kapazitäten, Termine, Hinweise, Buchbarkeit/Veröffentlichungsstatus und erweiterbare Ortsverwaltung.
- Anschlussangebote benötigen Verfügbarkeits-/Kapazitätsprüfung, Vorschau mit kontrollierter Freigabe, nachvollziehbare Preisrevisionen und korrekte Neubewertung bereits geleisteter Zahlungen.
- GPS benötigt noch QR-Code-Erzeugung und druckbare Etiketten. Die Verwaltung zeigt dafür stationäre QR-Zieladressen. Beim Bearbeiten einer Tour müssen neue Kontrollcodes für alle Stationen eingetragen werden.
- Die Brilon-Mustertour mit 15 Stationen fehlt. Historische Fakten, genaue Koordinaten, Zugänglichkeit und praktische Sicherheit müssen vor Veröffentlichung örtlich geprüft werden.
- Der Status der produktiven Schema- und Kalenderdefinitionen ist noch zu ermitteln. Die Tabellen werden für lokale/isolierte Tests nicht automatisch angelegt.
- Datenschutz- und Löschkonzept, Auskunft/Export, Einwilligungsnachweis für öffentliche Gästeliste sowie verbindliche Bedingungen sind noch zu entwickeln und fachlich zu prüfen.
- Mobile und Desktop-Bedienung, Tastaturbedienbarkeit und Screenreader-Verhalten sind noch visuell und automatisiert zu testen.

## Nutzung der bestehenden Verwaltung

1. Lokal Node.js 20+ und Abhängigkeiten bereitstellen.
2. Für eine isolierte Entwicklungsdatenbank `DATABASE_URL`, `ADMIN_USER`, `ADMIN_PASSWORD` und ein mindestens 32 Zeichen langes `GPS_CODE_SECRET` konfigurieren. Keine Produktivzugangsdaten verwenden.
3. Schemaänderungen bleiben standardmäßig aus. Nur in einer eigens angelegten Testdatenbank und nach Schema-Review `RUN_SCHEMA_MIGRATIONS=true` setzen.
4. `npm start` starten und `/admin.html` öffnen. Zahlungseingänge werden in der Buchungskarte mit tatsächlichem Betrag und Zahlungsart ergänzt. Unter GPS eine Tour mit vollständigem Stations-JSON anlegen, die dauerhaften Standort-QR-Codes auf die angezeigten Zieladressen verweisen lassen und für bestätigte Buchungen Spielzugänge erstellen.
5. Benachrichtigungen nur mit Test-Mailpostfach und `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` und optional `BOOKING_NOTIFY_EMAIL` testen.

## Veröffentlichungsstatus

Nicht veröffentlicht. Dieser Commit darf nicht nach `main` zusammengeführt und nicht auf ein produktives System angewendet werden. Vor einer späteren Veröffentlichung fehlen die offenen Punkte, vollständige Integrationstests, ein vollständiger Testbericht und eine ausdrückliche Freigabe.
