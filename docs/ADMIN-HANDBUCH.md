# Administrationsbereich – Bedienungsanleitung

Diese Anleitung beschreibt den aktuellen Entwicklungsstand im Branch
`entwicklung/phase-1-buchungen-sonderangebote-gps`. Die Seite ist nicht
veröffentlicht. Vor einem Betrieb müssen die offenen Prüfungen in
`STATUS-ENTWICKLUNG.md` abgeschlossen und eine ausdrückliche Freigabe erteilt
werden.

## Anmeldung und sichere Testumgebung

1. Node.js 20 oder neuer und die Projektabhängigkeiten bereitstellen.
2. Für einen lokalen Test ausschließlich Zugangsdaten und eine Datenbank aus
   einer isolierten Testumgebung konfigurieren. Keine Produktivzugänge
   verwenden. Zusätzlich `ADMIN_TOTP_SECRET_BASE32` als zufälligen Base32-Schlüssel
   mit mindestens 160 Bit im Secret-Store der Laufzeitumgebung setzen und in
   einer Authenticator-App hinterlegen. Ohne gültigen Schlüssel bleibt die
   Anmeldung gesperrt; den Schlüssel niemals in Git speichern.
3. Schemaänderungen sind standardmäßig ausgeschaltet. Vor Tests, die eine
   Schemaänderung benötigen, zuerst die Migration prüfen und nur eine eigens
   angelegte Testdatenbank verwenden. Für PostgreSQL-gestützte Admin-Sitzungen
   und den Schutz vor wiederverwendeten Authenticator-Codes muss die
   kontrollierte Migration die Tabellen `brilon_admin_sessions` und
   `brilon_admin_totp_steps` anlegen. Die Migration wird nicht automatisch
   ausgeführt.
4. `npm start` starten und `/admin.html` öffnen. Bei PostgreSQL muss die
   Sitzungstabelle und TOTP-Zählertabelle über die kontrollierte Migration
   angelegt sein; andernfalls bleibt der Admin-Login gesperrt. Zur Anmeldung
   Benutzername, Passwort und den aktuellen sechsstelligen Authenticator-Code
   eingeben. Codes sind nur einmal nutzbar. Nach der Anmeldung über „Abmelden“
   die Sitzung beenden.
5. Bei Verlust oder Wechsel des Authenticator-Schlüssels muss die Identität
   administrativ geprüft, ein neuer zufälliger Schlüssel im Secret-Store
   hinterlegt und der zugehörige alte TOTP-Zähler kontrolliert zurückgesetzt
   werden. Den alten Schlüssel nicht weiterverwenden und keinen Notfallzugang
   im Repository hinterlegen.

## Buchungen und Zahlungen

- In „Buchungen & Zahlungen“ nach Name, Buchungsnummer, E-Mail oder Angebot
  suchen und nach Buchungsstatus filtern. Die Liste zeigt 50 Treffer je Seite;
  die Seitensteuerung führt durch alle Treffer und zeigt die Gesamtzahl an.
- Buchungsnummern bleiben stabil und können als Überweisungsverwendungszweck
  genutzt werden.
- In einer Buchung den Status prüfen beziehungsweise aktualisieren. Die
  unterstützten Status sind offen, bestätigt, abgelehnt und storniert.
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
- Orte zuerst unter „Einstellungen · Veranstaltungsorte“ ergänzen. Das
  Hinzufügen eines Orts ändert vorhandene Programme und Buchungen nicht.
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
