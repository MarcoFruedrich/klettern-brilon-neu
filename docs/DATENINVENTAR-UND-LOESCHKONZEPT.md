# Dateninventar und offene Löschentscheidungen

Stand: 3. November 2026  
Arbeitszweig: `entwicklung/phase-1-buchungen-sonderangebote-gps`

## Zweck und Abgrenzung

Dieses Dokument erfasst, welche Daten der aktuelle Anwendungscode verarbeitet und welche Löschwege bereits vorhanden sind. Es legt **keine gesetzlichen Aufbewahrungsfristen** fest und ist keine fertige Datenschutzerklärung oder Rechtsprüfung. Im Code ist derzeit kein allgemeines, zeitgesteuertes Löschkonzept eingerichtet.

## Datenbestände im Anwendungscode

| Bestand | Enthaltene Daten | Zweck | Vorhandene Löschung oder Bereinigung |
|---|---|---|---|
| `brilon_buchungen` (`data` JSONB plus Status-/Zeitspalten) | Name, Vor- und Nachname, E-Mail, Telefon, Termin, Uhrzeit, Angebot, Gruppengröße, Nachricht, Preise und Zahlungseinträge; zusätzlich Verwaltungsnotiz, Zahlungsinfo-Zeitpunkt, Erstellungs-/Änderungszeit und Buchungsstatus | Anfrage, Terminreservierung, Kommunikation und Zahlungsübersicht | Geschützte Admin-Löschung ist vorhanden. Sie löscht zugehörige GPS-Spielzugänge mit; Buchungen mit bestehender Anschlussrabatt-Verknüpfung werden abgewiesen, damit deren Preis- und Zahlungshistorie nicht getrennt wird. Kein automatischer Ablauf. Seit `2026-11-03-v1` werden die erforderliche Bestätigung als `data.datenschutz`, der serverseitige Zeitstempel und die Textversion zusammen gespeichert. Ältere Zeilen können diese Nachweisdaten nicht enthalten.
| `brilon_gps_spiele` | Hash des Spieltokens, Buchungs- und Tourbezug, Fortschritt, Start-/Abschlusszeit, Dauer, Gastname, Einwilligungsstatus, Zeitpunkt und Version, Sperrzeitpunkt | Spielstand, Abschluss und ausdrücklich freigegebener Gästelisteneintrag | Admin kann Gästename und Einwilligungsfelder löschen; Spielstand und Zeit bleiben dabei erhalten. Bei erlaubter Buchungslöschung werden die zugehörigen Spielzeilen gelöscht. Kein automatischer Ablauf.
| `brilon_pruef_mitarbeitende` | Name, E-Mail, Passwort-Hash, Aktivstatus und Erstellungszeit | Zugang für Stationsprüfungen | Deaktivierung sperrt den Zugang und löscht offene Sitzungen, aber nicht Personalstammdaten oder alte Prüfberichte. Keine Personal-Löschroute im Anwendungscode.
| `brilon_pruef_sessions` | Sitzungstoken-Hash, Mitarbeiterbezug, Ablauf- und Freigabezeit | Anmeldung und kurzzeitige Freigabe nach Vor-Ort-Code | Ablauf wird bei Abfragen geprüft; Logout und Deaktivierung löschen gezielt. Im Anwendungscode ist keine regelmäßige Bereinigung abgelaufener Mitarbeiter-Sitzungen erkennbar.
| `brilon_pruef_codes` und `brilon_pruef_tablet_kopplungen` | Code-Hash, gegebenenfalls verschlüsselter Prüfcode, Tablet-Bezug, Ablauf, Verbrauchs- und Erstellungszeit | Einmalige Vor-Ort-Freigabe und Gerätekopplung | Abgelaufene oder verbrauchte Werte werden bei Verwendung abgewiesen. Eine regelmäßige Löschung dieser Zeilen ist im Anwendungscode nicht erkennbar.
| `brilon_pruef_berichte` | Prüfperson, Programm und Startzeit, verwendete Stationen, Ergebnis, Mangel-/Hinweisbeschreibungen und bereinigte optionale Fotobelege | Sicherheitsnachweis und Nachverfolgung von Mängeln | Kein Löschweg im Anwendungscode gefunden. Fotos liegen als JPEG-Daten im Bericht. Ein Mangel kann Folgeeinträge zur Stationssperre und Benachrichtigung auslösen.
| `brilon_pruef_hinweise`, `brilon_pruef_stationsereignisse`, `brilon_pruef_stationsstatus` | Stations- und Berichtsbezug, Beschreibung/Begründung, verantwortliche Person, Zeitpunkte und Nachprüfungsergebnis | Nachverfolgung kleiner Hinweise, Sicherheitsmängel, Freigaben und administrativer Statuswechsel | Hinweise können als erledigt markiert werden; Ereignis- und Statushistorie bleibt erhalten. Kein allgemeiner Löschweg oder Ablauf.
| `brilon_pruef_meldungen` | Berichtsbezug, Versandstatus, Versuchszahl und Versandzeitpunkte, kurzer Fehler-/Wiederholungsgrund | Nachweis und Bearbeitung der Sicherheitsmangel-E-Mail | Kein eigener Löschweg. Der E-Mail-Inhalt und die Fotos werden nicht in dieser Tabelle gespeichert.
| `brilon_pruef_tablets` | Gerätebezeichnung, Token-Hash, Aktivstatus, Kopplungszeit, letzte Verbindung und Auswahl als Prüfdisplay | Widerrufbare Geräteanmeldung und Erreichbarkeitsanzeige | Sperren deaktivieren den Zugang; Zeilen und Verbindungszeit bleiben erhalten. Kein automatischer Ablauf oder Löschweg.
| `brilon_admin_sessions`, `brilon_admin_totp_steps` | Admin-Sitzungstoken-Hash mit Ablaufzeit; zuletzt verwendeter TOTP-Zeitschritt | Geschützte Verwaltung und Schutz vor Code-Wiederverwendung | Abgelaufene Admin-Sitzungen werden bei Admin-Anfragen bereinigt; Logout löscht die aktuelle Sitzung. Für TOTP-Schrittzähler ist keine Bereinigung erkennbar.
| `brilon_aktionen`, `brilon_angebote`, `brilon_gps_touren`, `brilon_kalender` | Angebots-/Tourtexte, Routen- und Terminangaben, Bildadressen sowie Verwaltungszeitpunkte | Öffentliche Angebote und Terminplanung | Einzelne Kalender-/Aktions-/Tour-Einträge können administrativ gelöscht werden; Angebote werden bevorzugt archiviert. Bei Bildern ist kein Entfernen alter Objekte aus dem externen Speicher erkennbar.
| Externer Bildspeicher `angebotsbilder` | Öffentlich abrufbare Angebots- und Aktionsbilder nach vollständiger Neu-Codierung | Darstellung auf der öffentlichen Website | Neue Bilder erhalten neue Objektnamen. Beim Austausch eines Bildes löscht der Anwendungscode das vorherige Objekt nicht.

## Weitere Empfänger und Speicherorte

- Buchungsbestätigungen und Betreiberbenachrichtigungen werden über Brevo versendet. Der Anwendungscode enthält keine Aufbewahrungs- oder Löschsteuerung für Nachrichten beim Anbieter.
- Angebots- und Aktionsbilder werden über Supabase Storage verwaltet und als öffentliche URL verwendet. Anbieter-Backups und deren Fristen lassen sich aus diesem Repository nicht ablesen.
- Datenbank- und Hosting-Backups, Serverprotokolle sowie Kontoeinstellungen externer Anbieter sind nicht durch die hier erfassten Anwendungsrouten löschbar.

## Offene Entscheidungen vor einem Löschplan

1. Für jede Datenart klären, ob und wie lange sie für Buchung, Zahlungsnachweis, Sicherheitsnachverfolgung oder gesetzliche Pflichten benötigt wird.
2. Getrennte Fristen und Verantwortlichkeiten für Buchungsdaten, Prüfberichte/Fotos, Hinweise, Ereignishistorien, Gästelisteneinträge, Sitzungen, Codes und nicht mehr verwendete Bilder festlegen.
3. Festlegen, ob nach einer Löschung anonymisierte Statistik- oder Sicherheitsdaten erhalten bleiben dürfen und wie Verknüpfungen zu Berichten und Buchungen behandelt werden.
4. Backups, Mailanbieter, Bildspeicher, Hosting und Protokolle in die Löschprüfung einbeziehen.
5. Wenn sich der Text der Datenschutzhinweise ändert, die im Server gespeicherte Textversion bewusst aktualisieren und mit dem veröffentlichten Text abgleichen.
6. Lösch- und Exportabläufe mit den betrieblichen Sicherheits-, Buchungs- und Buchführungsanforderungen fachlich prüfen, bevor Fristen oder automatische Jobs im Code eingerichtet werden.

Bis diese Punkte entschieden sind, werden keine pauschalen Fristen oder automatischen Löschjobs eingeführt. Die produktiven Datenbankstrukturen wurden für diese Bestandsaufnahme nicht verändert.
