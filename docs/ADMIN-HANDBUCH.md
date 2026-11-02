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
   verwenden.
3. Schemaänderungen sind standardmäßig ausgeschaltet. Vor Tests, die eine
   Schemaänderung benötigen, zuerst die Migration prüfen und nur eine eigens
   angelegte Testdatenbank verwenden.
4. `npm start` starten und `/admin.html` öffnen. Nach der Anmeldung über
   „Abmelden“ die Sitzung beenden.

## Buchungen und Zahlungen

- In „Buchungen & Zahlungen“ nach Name, Buchungsnummer, E-Mail oder Angebot
  suchen und nach Buchungsstatus filtern. Die Liste zeigt 50 Treffer je Seite;
  die Seitensteuerung führt durch alle Treffer und zeigt die Gesamtzahl an.
- Buchungsnummern bleiben stabil und können als Überweisungsverwendungszweck
  genutzt werden.
- In einer Buchung den Status prüfen beziehungsweise aktualisieren. Die
  unterstützten Status sind offen, bestätigt, abgelehnt und storniert.
- Zahlungseingänge einzeln mit Betrag und Zahlungsart erfassen. Der aktuelle
  Saldo wird aus den Einträgen berechnet. Bei Erreichen der 25-%-Anzahlung wird
  eine offene Buchung automatisch bestätigt; der verbleibende Betrag entspricht
  dem Restbetrag.
- „Zahlungsübersicht“ zeigt Eingänge, offene Beträge und Gutschriften für die
  250 zuletzt geladenen Buchungen. Eine
  Gutschrift wird nicht automatisch ausgezahlt; Erstattungen müssen kontrolliert
  und separat abgewickelt werden.

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
- Stationsdaten werden als JSON-Liste eingetragen. Jede Station benötigt eine
  eindeutige `id` und `qrId`, einen `kontrollcode`, eine Frage, genau zwei
  Antworttexte, `loesungIndex` (`0` oder `1`) sowie gültige `latitude`- und
  `longitude`-Werte. Beispiel:

  ```json
  [
    {
      "id": "s1",
      "qrId": "BRILON-001",
      "kontrollcode": "4821",
      "frage": "Welche Form hat das Dach des alten Rathauses?",
      "antworten": ["Spitzbogen", "Zwiebelform"],
      "loesungIndex": 0,
      "latitude": 51.394,
      "longitude": 8.571
    }
  ]
  ```

- Kontrollcodes werden serverseitig als HMAC gespeichert und nicht in der
  Admin-Antwort zurückgegeben. Beim Bearbeiten bleibt ein vorhandener Code
  erhalten, wenn Stations-ID und QR-Kennung gleich bleiben. Bei einer neuen
  Station oder geänderter QR-Kennung muss ein neuer Code eingegeben werden.
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
  erhalten.

GPS-Koordinaten, Routenführung, historische Fragen, Zugänglichkeit und
praktisches Sicherheitskonzept müssen vor Veröffentlichung vor Ort geprüft
werden. Kinder- oder Gruppennamen dürfen nur nach freiwilliger und
ausdrücklicher Zustimmung veröffentlicht werden.

## Vor Veröffentlichung

Die Bedienungsanleitung ersetzt weder die vollständigen PostgreSQL- und
E-Mail-Integrationstests noch die Geräte-, Datenschutz- und Sicherheitsprüfung.
Produktive Migrationen, Veröffentlichung oder Zusammenführung mit `main`
erfolgen erst nach ausdrücklicher Freigabe.
