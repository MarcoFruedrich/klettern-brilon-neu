# Administrationsbereich – Bedienungsanleitung

Diese Anleitung beschreibt den aktuellen Stand im Branch
`entwicklung/phase-1-buchungen-sonderangebote-gps`. Der Branch ist auf Render
unter `https://klettern-brilon-neu.onrender.com` zur Ansicht bereitgestellt.
Die URL ist öffentlich erreichbar. Offene Prüfungen und Einschränkungen stehen
in `STATUS-ENTWICKLUNG.md`.

## Anmeldung und sichere Testumgebung

1. Node.js 20 oder neuer und die Projektabhängigkeiten bereitstellen.
2. Für einen lokalen Test ausschließlich Zugangsdaten und eine Datenbank aus
   einer isolierten Testumgebung konfigurieren. Keine Produktivzugänge
   verwenden. Benutzername und starkes Passwort im Secret-Store der
   Laufzeitumgebung hinterlegen, niemals in Git.
3. TOTP ist in der aktuellen Version auf Wunsch des Betreibers deaktiviert.
   Die Verwaltungsanmeldung verwendet Benutzername und Passwort; die vorhandene
   Begrenzung von Anmeldeversuchen, Same-Origin-Prüfung und Sitzungs-/CSRF-Schutz
   bleiben aktiv. Die vorherige TOTP-Implementierung kann aus dem Git-Verlauf
   vor Commit `6b6d8d9cdad7495695498104051d75d770dc464a` wieder eingebunden
   werden.
4. Schemaänderungen sind standardmäßig ausgeschaltet. Für PostgreSQL-gestützte
   Admin-Sitzungen muss die kontrollierte Migration die Tabelle
   `brilon_admin_sessions` anlegen. Die Migration wird nicht automatisch
   ausgeführt und darf nur nach Prüfung auf einer dafür vorgesehenen Datenbank
   gestartet werden.
5. `npm start` starten und `/admin.html` öffnen. Zur Anmeldung Benutzername
   und Passwort eingeben. Nach der Anmeldung über „Abmelden“ die Sitzung
   beenden.

## Navigation in der Verwaltung

Nach der Anmeldung nutzt die Verwaltung am Desktop die Bildschirmbreite. Die
Bereiche stehen links in einer senkrechten Navigation; ein Klick zeigt jeweils
nur den gewählten Arbeitsbereich. Die Auswahl bleibt als URL-Fragment erhalten
und kann deshalb direkt verlinkt oder nach dem Neuladen wieder geöffnet werden.
Auf schmalen Bildschirmen wird die Navigation zu einer horizontal wischbaren
Leiste. Innerhalb der Bereiche führen Sprungschaltflächen weiterhin direkt zum
zugehörigen Eintrag.

## Buchungen und Zahlungen

- In „Buchungen & Zahlungen“ nach Name, Buchungsnummer, E-Mail oder Angebot
  suchen und nach Buchungsstatus filtern. Die Liste zeigt 50 Treffer je Seite;
  die Seitensteuerung führt durch alle Treffer und zeigt die Gesamtzahl an.
- Buchungsnummern bleiben stabil und können als Überweisungsverwendungszweck
  genutzt werden.
- In einer Buchung den Status prüfen beziehungsweise aktualisieren. Die
  unterstützten Status sind offen, bestätigt, abgelehnt und storniert.
- Bei bestätigten Buchungen zeigt die Karte den Versandversuch der
  Bestätigungs-E-Mail mit Zeitstempel und Fehlergrund. „Vom Anbieter angenommen“
  bedeutet, dass Brevo die Nachricht akzeptiert hat; die tatsächliche Zustellung
  ist damit nicht bestätigt. Ein ungeklärter Versand wird nicht automatisch
  wiederholt, um Doppel-E-Mails zu vermeiden.
- Das dauerhafte Löschen entfernt auch verknüpfte GPS-Spiele. Buchungen mit
  Anschlussrabatt-Bezug lassen sich nicht löschen; dort bitte „storniert“
  verwenden, damit der Rabatt- und Zahlungsverlauf erhalten bleibt.
- Zahlungseingänge einzeln mit Betrag und Zahlungsart erfassen. Der aktuelle
  Saldo wird aus den Einträgen berechnet. Bei Erreichen der 25-%-Anzahlung wird
  eine offene Buchung automatisch bestätigt; der verbleibende Betrag entspricht
  dem Restbetrag.
- „Zahlungsübersicht“ zeigt Gesamtsummen über alle Buchungen und 50 gefilterte
  Einträge pro Seite. Einzelne Zahlungseingänge lassen sich aufklappen. Eine
  Gutschrift wird nicht automatisch ausgezahlt; Erstattungen müssen kontrolliert
  und separat abgewickelt werden.
- Über „Alle Buchungen dieser Kontakt-E-Mail exportieren (JSON)“ werden alle
  Buchungen mit exakt derselben Kontakt-E-Mail sowie ihre Zahlungseingänge und
  verknüpften GPS-Teilnahmedaten exportiert. Ohne Kontakt-E-Mail enthält die
  Datei nur die ausgewählte Buchung. Interne Bearbeitungsnotizen, Spielzugänge,
  Kontrollcodes und Stationskoordinaten werden nicht exportiert. Prüfen Sie vor
  einer Weitergabe, dass die anfragende Person zu sämtlichen gebündelten
  Buchungen berechtigt ist. Exportdateien enthalten personenbezogene Daten und
  müssen geschützt abgelegt und weitergegeben werden.

## Kalender, Sperrzeiten und Programme

- Im Buchungskalender zwischen Monaten wechseln. Buchungen werden für den
  angezeigten Monat aus der Datenbank geladen. Unter „Eigene Termine &
  Sperrzeiten“ einen Termin oder eine Sperrzeit mit Titel, Datum und optionalen
  Uhrzeiten anlegen. Ein Enddatum kann für mehrtägige Einträge angegeben werden.
- Unter „Angebote & Preise verwalten“ Name, Beschreibung, Dauer, Kategorie,
  Zielgruppe, Ort, Kapazität, optionale verfügbare Daten und Hinweise eintragen.
  „Buchbar“ steuert die Annahme von Anfragen; „Auf der Website
  veröffentlichen“ steuert die öffentliche Anzeige.
- Angebots- und Aktionsbilder können als JPG, PNG oder WebP bis 5 MB hochgeladen
  werden. Der Server prüft tatsächliche Dateisignatur, Grundstruktur und
  Bildabmessungen; animierte PNG- und WebP-Dateien sowie Bilder über 40
  Megapixel werden abgelehnt.
- Für Individualklettern „Einzelplätze reservieren“ wählen und Mindestanmeldungen,
  Kapazität (5–12 Plätze) sowie Preis pro Person festlegen. Eine Anmeldung
  reserviert einen Platz ohne Anzahlung. Der Termin findet ab der eingestellten
  Mindestzahl statt; das Formular zeigt Anmeldestand und freie Plätze.
- Angebote mit „Nach oben“ und „Nach unten“ sortieren. „Angebot archivieren“
  nimmt es aus der öffentlichen Auswahl und erhält vorhandene Buchungen und
  deren Verlauf. Archivierte Angebote lassen sich in der Verwaltung
  wiederherstellen. Eine verknüpfte GPS-Tour muss vor dem Archivieren deaktiviert
  werden.
- Orte zuerst unter „Einstellungen · Veranstaltungsorte“ ergänzen. Das
  Hinzufügen eines Orts ändert vorhandene Programme und Buchungen nicht.
- Wenn Laden oder Speichern mit einem internen Fehler scheitert, kann in der
  Datenbank die Tabelle `brilon_orte` fehlen. Für die einmalige, eng begrenzte
  Einrichtung `RUN_PLACES_MIGRATION=true` setzen und den Server neu starten;
  dabei wird nur diese Tabelle angelegt und „Brilon“ als Startort ergänzt.
  Anschließend die Variable wieder entfernen. Die allgemeine
  `RUN_SCHEMA_MIGRATIONS`-Option ist dafür nicht erforderlich.
- Sonder- und Tagesangebote separat im gleichnamigen Bereich erfassen. Vor
  einer Veröffentlichung Titel, Datum, Beschreibung und Preis kontrollieren.

## Anschlussrabatte

1. Für den gewünschten Tag „Bestätigte Termine laden“ wählen.
2. Programme und Zeitfenster in die Vorschau aufnehmen und „Rabatt berechnen“
   ausführen.
3. Das Ergebnis prüfen. Direkt angrenzende Programme erhalten jeweils 10 %
   Rabatt; bei zwei Anschlüssen wird ein mittleres Programm nur einmal
   rabattiert.
4. Erst mit „10-%-Rabatt kontrolliert anwenden“ die Preisänderungen speichern.
   Die Preisrevision und der neu berechnete Saldo werden in den betroffenen
   Buchungen protokolliert.

Für kundenindividuelle Anschlussangebote benötigt der Server
`PUBLIC_BASE_URL` mit HTTPS und ein starkes `BOOKING_OFFER_SECRET`. Änderungen
am bestätigten Ausgangsprogramm erfolgen erst, wenn eine passende
Zusatzbuchung bestätigt wird.

## GPS-Schatzsuchen

- Eine Tour benötigt Titel, Schwierigkeitsgrad, Altersgruppe, Startpunkt, Ziel,
  Dauer, Gruppenpreis und Stationsdaten. „Buchbar“ und „Aktivieren“ getrennt
  setzen: Nur aktive und buchbare Touren sind für den Spielablauf freigegeben.
- Stationen werden einzeln über „Station hinzufügen“ eingetragen. Jede Karte
  enthält eine eindeutige Stations-ID und QR-Kennung, Frage, zwei Antworttexte,
  richtige Antwort, Breitengrad, Längengrad und Kontrollcode. Mit „Nach oben“
  und „Nach unten“ wird die Spielreihenfolge festgelegt. Beispielwerte für die
  erste Station: ID `s1`, QR-Kennung `BRILON-001`, Code `4821`, Frage „Welche
  Form hat das Dach des alten Rathauses?“, Antworten „Spitzbogen“ und
  „Zwiebelform“, Antwort 1 richtig, Koordinaten `51.394` und `8.571`.

- Kontrollcodes werden serverseitig als HMAC gespeichert und nicht in der
  Admin-Antwort zurückgegeben. Beim Bearbeiten bleibt ein vorhandener Code
  erhalten, wenn Stations-ID und QR-Kennung gleich bleiben; das Codefeld kann
  dann leer bleiben. Bei einer neuen Station oder geänderter Stations-ID oder
  QR-Kennung muss ein neuer 4- bis 8-stelliger Code eingegeben werden.
- Nach dem Speichern „QR-Etiketten drucken“ für die Tour wählen. Die lokalen
  QR-Grafiken enthalten den Spiel-Link mit Stationskennung, aber keine
  Koordinaten oder Kontrollcodes. Den Zahlencode separat verwahren und vor Ort
  anbringen. Ausdrucke vor dem Einsatz mit mehreren Smartphones prüfen.
- Einen Spielzugang nur für eine bestätigte Buchung desselben Programms
  erstellen. Der erzeugte Link enthält einen individuellen Zugangsschlüssel:
  nur direkt an die buchende Gruppe weitergeben und nicht öffentlich ablegen.
- Die Gästeliste zeigt nur abgeschlossene Spiele mit ausdrücklicher Zustimmung.
  Ein Admin kann einen öffentlichen Eintrag entfernen; dabei werden Name und
  Einwilligung gelöscht, der interne Abschluss und die Spielzeit bleiben
  erhalten. Die Verwaltung zeigt außerdem den Einwilligungszeitpunkt und die
  Textversion. Version `2026-11-02-v1` ist im Einwilligungsregister dokumentiert.

GPS-Koordinaten, Routenführung, historische Fragen, Zugänglichkeit und
praktisches Sicherheitskonzept müssen vor Veröffentlichung vor Ort geprüft
werden. Kinder- oder Gruppennamen dürfen nur nach freiwilliger und
ausdrücklicher Zustimmung veröffentlicht werden.

## Vor Veröffentlichung

Die Bedienungsanleitung ersetzt weder die vollständigen PostgreSQL- und
E-Mail-Integrationstests noch die Geräte-, Datenschutz- und Sicherheitsprüfung.
Produktive Migrationen, Veröffentlichung oder Zusammenführung mit `main`
erfolgen erst nach ausdrücklicher Freigabe.
