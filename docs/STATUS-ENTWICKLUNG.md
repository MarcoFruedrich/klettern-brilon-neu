# Entwicklungsstand – Phase 1 Buchungen, Sonderangebote und GPS

Stand: 2. November 2026  
Arbeitszweig: `entwicklung/phase-1-buchungen-sonderangebote-gps`

## Ausgangsbefund

- Die Website enthielt ein Anfrageformular mit getrennten Vor- und Nachnamen, eine PostgreSQL-Anbindung, eine Admin-Sitzung, eine grundlegende Kalender- und Sperrzeitenverwaltung sowie Programme mit einfachen Teilnehmerpreisstaffeln.
- Buchungsnummern nach `NACHNAME-VORNAME-TTMMJJ` und ein DB-Unique-Index waren bereits vorgesehen. Eine globale PostgreSQL-Advisory-Lock-Transaktion serialisiert parallele Buchungen innerhalb der Anwendung.
- Die bisherige Zahlungsverwaltung speicherte einen auswählbaren Zahlungsstatus, aber keine einzelnen Zahlungseingänge. Die angezeigten Zahlungssummen waren daraus pauschal abgeleitet.
- Anschlussrabatte unterstützten bereits eine unverbindliche Vorschau und eine isolierte Berechnungsfunktion; Preisänderungen und gespeicherte Zahlungseingänge wurden noch nicht gemeinsam verarbeitet.
- Eine GPS-Verwaltung, gespeicherte Touren und Gruppen-Spielstände waren nicht vorhanden.
- Die Administrationsoberfläche hatte keine Suche oder Statusfilter. Sie nutzte eine fließende Kartenansicht, jedoch keine geprüfte Viewport-Testautomatisierung.
- Das Startskript führte beim Start `CREATE`-/`ALTER`-Anweisungen aus. Es gab kein `npm test`-Skript. E-Mail-Absender und Betreiberbenachrichtigung waren im Quellcode fest eingetragen.

## Umgesetzt in diesem Abschnitt

- `npm test` startet jetzt die Node-Test-Suite.
- Buchungsstatus, Zeitfenster, Teilnehmerpreisstaffeln, Centbeträge und Zahlungssalden sind als reine Funktionen prüfbar.
- Admins können tatsächliche Zahlungseingänge mit Betrag, Zahlungsart und Erfassungszeitpunkt einzeln buchen. Überzahlungen und ungültige Zahlungsarten werden abgelehnt. Sobald die reale Summe 25 % erreicht, wird eine offene Buchung bestätigt. Die Zahlungen liegen in der vorhandenen JSONB-Buchungszeile; es ist keine neue Tabellenmigration nötig.
- Die Verwaltungsansicht zeigt eingegangene Beträge, den offenen Rest und den Status der Anzahlung. Die Liste kann nach Status und Text gefiltert werden.
- Die Programmverwaltung unterstützt Kategorien, Zielgruppen, Bilder, Dauer, Kapazität, Preisstaffeln von 1–150 Teilnehmenden, verfügbare Tage, Hinweise, Buchbarkeit und Veröffentlichung. Orte sind verwaltbar; Brilon, Rüthen, Soest und Sundern werden als Startorte angelegt.
- Buchungsprüfungen berücksichtigen Preisstaffel, Programmdauer, freigegebene Tage und Tageskapazität zusätzlich zum Terminkonflikt.
- Überweisungsinformationen setzen die stabile Buchungsnummer als Verwendungszweck ein.
- Der Admin kann bestätigte Buchungen eines Tages auswählen, eine 10-%-Vorschau sehen und den Rabatt bewusst anwenden. Es werden nur direkt aneinandergrenzende Zeitfenster rabattiert; jede betroffene Buchung erhält den Rabatt höchstens einmal. Preisrevision, neuer Restbetrag und eine etwaige Überzahlungsgutschrift werden je Buchung gespeichert. Nach Anwendung wird eine Benachrichtigung an betroffene Kunden versucht.
- Bestätigungs-E-Mails können einen HMAC-signierten, ein Jahr gültigen Link zur kundenseitigen Anschlussseite enthalten. Die Seite listet nur zeitlich direkt passende Programme mit freigegebenem Datum und freier Kapazität. Eine Anschlussanfrage prüft Termin, Sperrzeit und Kapazität in einer Transaktion erneut und legt die Zusatzbuchung mit 10 % Rabatt an. Der Rabatt auf das bestätigte Ausgangsprogramm wird erst beim Bestätigen der Zusatzbuchung angewendet. Dafür sind `PUBLIC_BASE_URL` (HTTPS) und `BOOKING_OFFER_SECRET` erforderlich.
- Wird die bestätigte Zusatzbuchung storniert oder abgelehnt und gibt es keine weitere bestätigte Anschlussbuchung, wird der Rabatt auf das Ausgangsprogramm zurückgenommen; Restbetrag und mögliche Gutschrift werden anhand der Zahlungseingänge neu berechnet. Eine Auszahlung einer Gutschrift wird weiterhin manuell abgewickelt.
- E-Mail-Absender und Betreiberempfänger sind nicht mehr fest im Code hinterlegt; sie werden über `BREVO_SENDER_EMAIL` und `BOOKING_NOTIFY_EMAIL` konfiguriert. Der Bildspeicher ist optional und wird ohne Konfiguration sauber abgewiesen.
- Schemaänderungen werden nur noch ausgeführt, wenn `RUN_SCHEMA_MIGRATIONS=true` gesetzt ist. Kein produktiver Datenbankzugriff oder Schemaänderung wurde in dieser Arbeit ausgeführt.
- GPS-Touren sind über den Admin anlegbar, bearbeitbar sowie aktivierbar/deaktivierbar. Stationen enthalten Koordinaten, zwei Antworten und gehashte Kontrollcodes.
- Eine GPS-Tour erzeugt ein passendes buchbares Programm mit Gruppenpreis. Spielzugänge lassen sich nur für bestätigte Buchungen desselben Programms ausstellen.
- Für bestätigte Buchungen lassen sich einzelne Spielzugänge ausstellen. Gruppenstände, Start-/Abschlusszeit und Dauer werden gespeichert. Die mobile Spielseite prüft QR-Kennung, Zahlencode und Antwort; spätere Stationskoordinaten werden nie an den Browser ausgeliefert.
- Die Gästeliste zeigt nur abgeschlossene Spiele mit ausdrücklicher Zustimmung zur Namensveröffentlichung. Ohne Zustimmung wird kein Name gespeichert.
- GPS-Kontrollcodes werden mit HMAC gehasht; Spielzugänge werden nur gehasht gespeichert. Das Geheimnis `GPS_CODE_SECRET` ist erforderlich.
- Admin-Schreibanfragen mit Sitzung verlangen zusätzlich einen passenden `Origin`-Header für denselben Host und dasselbe Protokoll; die vorhandenen `HttpOnly`, `Secure`, `SameSite=Strict`-Cookies bleiben bestehen.
- Ein lokaler HTTP-Test prüft Admin-Anmeldung, Cookie-Flags, geschützte Lesezugriffe und erlaubte/abgewiesene Schreibanfragen mit Datenbank-/Supabase-Stubs; er versendet keine E-Mails.
- Ein HTTP-End-to-End-Test nutzt ein isoliertes, speicherbasiertes PostgreSQL-Test-Double für Buchungen, Konflikte, Referenzkollisionen, Anzahlung, Anschlussvorschläge, rabattierte Zusatzbuchungen und Storno. Dabei wurde ein nicht definierter Dauervariablenname im Anschlussbuchungs-Endpunkt gefunden und korrigiert.
- Die Admin-Verwaltung besitzt eine dauerhaft erreichbare Sprungnavigation für Buchungen/Zahlungen, Kalender, Programme, Tagesangebote, Anschlussrabatte und GPS-Touren. Auf schmalen Bildschirmen bleibt die Navigation horizontal wischbar; Kalenderaktionen und Sprungziele berücksichtigen Touch-Größen und Sticky-Kopfzeilen.
- Die GPS-Gästeliste ist jetzt zusätzlich zentral im Admin-Bereich nach Tour filterbar. Der Admin-Endpunkt liefert ausschließlich abgeschlossene Spiele mit expliziter Einwilligung, verlangt eine gültige Sitzung und gibt weder Spielzugang noch interne Spieldaten aus.
- Admins können einen öffentlichen Gästelisteneintrag nach Bestätigung entfernen. Dabei werden Name und Einwilligung gelöscht; Abschlusszeit und Spielzeit bleiben für den internen Spielstand erhalten. Der HTTP-Test prüft Adminschutz und dass der Name danach auch aus der öffentlichen Gästeliste verschwindet.
- Bei öffentlicher Zustimmung wird nun zusätzlich der Einwilligungszeitpunkt gespeichert und nur in der geschützten Admin-Gästeliste angezeigt. Ein Widerruf entfernt auch diesen Zeitpunkt. Die dazugehörige Spaltenmigration ist migrationsgeschützt und wurde nicht ausgeführt.
- Die GPS-Verwaltung erzeugt QR-Etiketten lokal als SVG aus den festen Stationskennungen und öffnet einen druckbaren Satz pro Tour. Die QR-Grafik enthält nur den Stationslink, keine Koordinaten oder Kontrollcodes. Dafür ist qrcode-generator von Kazuhiko Arase lokal mit MIT-Lizenz beigefügt; es werden keine externen QR-Dienste verwendet.
- Die Zahlungsübersicht fasst tatsächliche Zahlungseingänge, offene Salden und Gutschriften zusammen. Einzelne Zahlungseinträge lassen sich pro Buchung aufklappen; Summen werden centgenau berechnet. Die Übersicht nutzt wie die Buchungsverwaltung die zuletzt geladenen 250 Buchungen.
- Buchungssuche und Statusfilter werden nun parametrisiert in PostgreSQL ausgeführt, bevor die Trefferbegrenzung von 250 greift. Dadurch findet die Suche auch ältere Buchungen; parallele Suchanfragen können keine veraltete Ergebnisliste mehr überschreiben.
- Veranstaltungsorte lassen sich jetzt zentral unter „Einstellungen“ ergänzen und einsehen. Die aktive Ortsliste bleibt mit der Programmauswahl synchron; das Hinzufügen eines Orts ändert keine bestehenden Programme oder Buchungen.
- Beim Bearbeiten einer GPS-Tour bleiben Kontrollcode-Hashes für Stations-ID und QR-Kennung unverändert erhalten. Geänderte QR-Kennungen sowie neue Stationen erfordern einen neuen gültigen Zahlencode; die Admin-Antwort enthält weiterhin weder Code noch Hash.
- Unmögliche Kalendertage werden beim Erstellen einer Anfrage als Eingabefehler zurückgewiesen.

## Prüfergebnisse

Ausgeführt lokal ohne Datenbank, SMTP/Brevo, Supabase oder externe E-Mail:

- `node --check server.js` – bestanden.
- `node --check site/admin.js` – bestanden.
- `node --check lib/gpstour.js` – bestanden.
- `node --check` für das Inline-JavaScript der Anschlussseite – bestanden.
- `npm test` – 36 bestanden, 0 fehlgeschlagen.
- QR-Etiketten: automatisierte Tests prüfen SVG-Ausgabe, Daten-URI, Ruhezone sowie ungültige/überlange Eingaben.
- Der HTTP-Test prüft das Hinzufügen und Auslesen eines Orts sowie die Zurückweisung eines leeren Ortsnamens.
- `node --check test/booking-http.test.js` – bestanden.
- `node --check test/admin-navigation.test.js` – bestanden.
- `node --check site/zahlungsuebersicht.js` – bestanden.
- `git diff --check` – bestanden.

Ein statischer Smoke-Test mit temporären lokalen Dependency-Stubs lieferte für `/anschluss.html` HTTP 200; die Vorschau-API antwortete ohne Datenbank erwartungsgemäß HTTP 503. Die reguläre Arbeitskopie enthält keine installierten Node-Abhängigkeiten (`pg` fehlt). Datenbank- und E-Mail-Routen wurden nicht gegen Dienste aufgerufen. Ein Viewport-Test war nicht möglich, weil die Chromium-Browserdatei fehlt.

## Noch offen

- Der HTTP-End-to-End-Test deckt die Kernstrecke mit einem speicherbasierten PostgreSQL-Test-Double ab. Die echte PostgreSQL-Integration, Datenbank-Constraints/Transaktionsisolation und E-Mail-Zustellung benötigen noch separate Tests in einer isolierten Umgebung mit Mail-Test-Double.
- Eine Admin-Sitzung wird im Arbeitsspeicher gehalten. Für mehrere Instanzen/Neustarts fehlt weiterhin ein persistenter Session-Store; zusätzlich sind CSRF-/Origin-Prüfung, Sitzungsrotation und ein zweiter Faktor zu prüfen.
- Buchungssuche und Statusfilter durchsuchen die Datenbank, die Trefferanzeige bleibt auf 250 Zeilen begrenzt. Kalender und Zahlungsübersicht beziehen sich weiterhin auf die 250 zuletzt geladenen Buchungen.
- Die kundenseitige Anschlussstrecke ist im HTTP-Test mit einem PostgreSQL-Test-Double abgedeckt. Eine erkannte Überzahlung/Gutschrift wird nicht automatisch ausgezahlt; dafür ist ein kontrollierter Erstattungsprozess erforderlich.
- QR-Etiketten können erzeugt und gedruckt werden. Ausdrucke müssen vor dem Einsatz an den Stationen praktisch mit mehreren Smartphones gescannt werden. Beim Bearbeiten bleiben Kontrollcode-Hashes erhalten, sofern Stations-ID und QR-Kennung gleich bleiben; bei einer neuen oder umgezogenen Station ist ein neuer Code erforderlich.
- Die 15 Fragen umfassende Mustertour liegt als Entwurf vor. Koordinaten, Routenführung, Zugänglichkeit und praktische Sicherheit müssen vor Veröffentlichung örtlich geprüft werden.
- Der Status der produktiven Schema- und Kalenderdefinitionen ist noch zu ermitteln. Die Tabellen werden für lokale/isolierte Tests nicht automatisch angelegt.
- Datenschutz- und Löschkonzept, Auskunft/Export, Versionierung des Einwilligungstexts sowie verbindliche Bedingungen sind noch zu entwickeln und fachlich zu prüfen.
- Der Einwilligungszeitpunkt wird gespeichert; eine revisionssichere Dokumentation der Textversion sowie ein allgemeines Aufbewahrungs-/Löschkonzept für alle Buchungs- und Spieldaten bleiben offen.
- Mobile und Desktop-Bedienung, Tastaturbedienbarkeit und Screenreader-Verhalten sind noch visuell und automatisiert zu testen.
- Die neue Admin-Sprungnavigation wurde strukturell auf gültige Ziele geprüft. Ein visueller Smartphone-/Tablet-/Desktop-Test bleibt offen, da in der Umgebung kein Chromium-Browser verfügbar ist.

## Nutzung der bestehenden Verwaltung

1. Lokal Node.js 20+ und Abhängigkeiten bereitstellen.
2. Für eine isolierte Entwicklungsdatenbank `DATABASE_URL`, `ADMIN_USER`, `ADMIN_PASSWORD` und ein mindestens 32 Zeichen langes `GPS_CODE_SECRET` konfigurieren. Keine Produktivzugangsdaten verwenden.
3. Schemaänderungen bleiben standardmäßig aus. Nur in einer eigens angelegten Testdatenbank und nach Schema-Review `RUN_SCHEMA_MIGRATIONS=true` setzen.
4. `npm start` starten und `/admin.html` öffnen. Unter „Einstellungen“ Veranstaltungsorte ergänzen; neue Programme können diese anschließend auswählen. Die Zahlungsübersicht zeigt Eingangssummen, offene Beträge und dokumentierte Gutschriften; Einzelbuchungen lassen sich aufklappen. Zahlungseingänge werden zusätzlich direkt in der jeweiligen Buchung erfasst. Unter „Anschlussrabatt“ bestätigte Buchungen desselben Tages wählen, die Vorschau prüfen und erst dann die dauerhafte Anwendung bestätigen. Bestätigungs-E-Mails führen mit den genannten Zugangseinstellungen zur passenden Anschlussseite. Unter GPS eine Tour mit vollständigem Stations-JSON anlegen und pro Tour „QR-Etiketten drucken“ wählen. Die Etiketten enthalten Station und QR-Link, aber keine Kontrollcodes; diese müssen separat vor Ort verwaltet werden. Für bestätigte Buchungen lassen sich Spielzugänge erstellen.
5. Benachrichtigungen nur mit Test-Mailpostfach und `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` und optional `BOOKING_NOTIFY_EMAIL` testen.

## Veröffentlichungsstatus

Nicht veröffentlicht. Dieser Commit darf nicht nach `main` zusammengeführt und nicht auf ein produktives System angewendet werden. Vor einer späteren Veröffentlichung fehlen die offenen Punkte, vollständige Integrationstests, ein vollständiger Testbericht und eine ausdrückliche Freigabe.
