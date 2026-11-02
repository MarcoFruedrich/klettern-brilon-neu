# Stations-Prüfprotokoll – Betriebs- und Testanleitung

**Stand:** Entwicklungszweig, noch nicht für den produktiven Betrieb oder als versicherungsrechtlicher Nachweis freigegeben.

## Ablauf vor jedem Programm

1. Die verantwortliche Person erfasst im Adminbereich unter **Stationsprüfungen** alle zu kontrollierenden Stationen und die Mitarbeiterkonten.
2. Am Standort wird der neue sechsstellige Code erzeugt. Er bleibt höchstens 120 Sekunden gültig und kann nur einmal verwendet werden.
3. Die Fachkraft öffnet `/pruefung.html`, meldet sich persönlich an und trägt den Code ein.
4. Sie gibt Programm und geplanten Programmbeginn an. Alle **tatsächlich verwendeten** Stationen müssen ausgewählt werden; jede wird auf **In Ordnung**, **Hinweis / kleiner Mangel** oder **Sicherheitsmangel** gesetzt.
5. Bei Hinweisen und Mängeln sind eine konkrete Beschreibung und bei Bedarf bis zu drei Fotos möglich. Die Bildverarbeitung erfolgt auf dem Gerät (max. 640 Pixel Kantenlänge und 80 KB JPEG pro Foto). Personen möglichst nicht abbilden.
6. Der Bericht wird gespeichert. Eine neue Prüfung erfordert einen neuen Code. Der Bericht kann in der Verwaltung eingesehen werden. Fotobelege werden separat und nur für angemeldete Administratoren ausgegeben.

**Wichtige Sicherheitsregel:** Bei einem Mangel ist die betroffene Station **nicht zu verwenden**, bis eine fachlich verantwortliche Person ihre Sicherheit geprüft und die Nutzung ausdrücklich freigegeben hat. Eine elektronische Dokumentation ist keine automatische Betriebsfreigabe.

## Hinweise und kleinere Mängel ohne automatische Sperre

Ein Hinweis eignet sich für **nicht unmittelbar sicherheitsrelevante Auffälligkeiten**, beispielsweise eine verblasste Beschriftung oder einen organisatorischen Verbesserungsbedarf. Hier ist eine Beschreibung mit mindestens zehn Zeichen verpflichtend; ein Foto kann ergänzt werden. Der Hinweis erscheint als **offener Prüfpunkt** in der Verwaltung.

Die zuständige Person prüft den Hinweis, dokumentiert Prüfername und Ergebnis und markiert ihn anschließend als erledigt. Der ursprüngliche Prüfbericht bleibt unverändert. Durch das Erstellen oder Erledigen eines Hinweises wird keine Stationssperre gesetzt oder aufgehoben.

**Bei jeder Unsicherheit über die sichere Benutzbarkeit ist stattdessen „Sicherheitsmangel“ zu wählen.** Dieser löst die automatische Sperrung weiterhin aus. Ein Hinweis ist keine Bestätigung der technischen Sicherheit.

## Automatische Stationssperrung und fachliche Freigabe

Jede als **Mangel** gespeicherte Stationsprüfung sperrt die betroffene Station automatisch in der Datenbank und dokumentiert ein Ereignis mit Bericht, Prüfperson und Beschreibung. Die Sperrung bleibt bestehen, auch wenn ein späterer Prüfbericht für dieselbe Station „in Ordnung“ vermerkt.

Die Verwaltung zeigt gesperrte Stationen deutlich an. Erst nachdem eine fachkundige Person die Station vor Ort nachgeprüft und erforderliche Mängel behoben hat, darf eine autorisierte Verwaltungsperson die Schaltfläche „Nach fachlicher Prüfung freigeben“ verwenden. Die Verwaltung verlangt dabei den Namen der prüfenden Person, eine konkrete Dokumentation der Nachkontrolle und eine abschließende Bestätigung. Die Freigabe wird in einem dauerhaft nachvollziehbaren Ereignisverlauf protokolliert.

**Wichtig:** Die digitale Freigabe ist eine dokumentierte Verwaltungsentscheidung; sie führt selbst keine technische Kontrolle durch. Auch nach Freigabe ist vor einem neuen Programm eine eigenständige vollständige Vorabprüfung erforderlich. Eine gemeldete gesperrte Station darf nicht in Betrieb genommen werden.

## Mängelbenachrichtigung

Eine Mängel-E-Mail wird nur verschickt, wenn `PRUEF_MANGEL_EMAIL` und die Mailanbindung gültig eingerichtet sind. Der Server bestätigt gesondert den tatsächlichen Versandstatus. Falls nicht konfiguriert oder gescheitert, muss die Fachkraft die verantwortliche Person direkt informieren. Ein verlässlicher Wiederholungsversand fehlt noch.

## Sicherheits- und Datenschutzgrenzen

- Die Codeausgabe ist derzeit nur aus der **vollwertigen Adminverwaltung** möglich. Ein öffentlich erreichbares Tablet darf daher nicht einfach mit einer offenen Adminsitzung betrieben werden. Vor Ort wird eine separate, technisch beschränkte Kiosk-Anzeige benötigt.
- Ein eingegebener Vor-Ort-Code beweist die physische Anwesenheit nicht unabhängig. Er dient der zusätzlichen Hürde.
- Fotos sind im privaten Bericht gespeichert; eine gesonderte Aufbewahrungsfrist, Ersetzungs-/Löschregelung, Bildinhaltsprüfung und vollständige Datenschutzinformation fehlen.
- Die Auswahl der verwendeten Stationen liegt bei der prüfenden Fachkraft. Das System kann nicht selbst erkennen, ob eine Station ausgelassen wurde.
- Die automatische Sperrung und eine dokumentierte administrative Freigabe sind umgesetzt. Es gibt noch keine unabhängige digitale Verifikation der fachlichen Nachkontrolle, keine verpflichtende gesonderte Abnahme durch einen qualifizierten Prüfer und keine automatisierte Auftragsverfolgung der Mängelbeseitigung.
- Mitarbeitersitzungen sind vier Stunden gültig. Der Vor-Ort-Code ist einmalig, die Berichtsfreigabe läuft spätestens nach 15 Minuten ab.
- Neue Prüftabellen sowie die Spalten `gesperrt_am`/`sperrgrund` und die neue Tabelle `brilon_pruef_stationsereignisse` dürfen nur nach Schema-Review und ausdrücklicher Freigabe migriert werden. **Keine produktive Migration**.

## Testumfang

Isolierte PostgreSQL-Tests decken Mitarbeitereinrichtung, Anmeldung, Codeeinlösung, Wiederverwendungsschutz, unvollständige Mängeltexte, Berichtsspeicherung und geschützten Foto-Download ab. Echte Chromium-Tests prüfen die mobile Anmeldung, Codeeingabe, Fotokonvertierung und Berichtsübermittlung bei 360, 390 und 768 Pixeln.

**Vor einem Echtbetrieb:** Eine Testinstallation mit kontrollierten Rollen, Mängel-Mailzustellung in ein Testpostfach, Datenschutzhinweisen, Foto-Löschfrist, Tabletsperre, Stationssperr-/Freigabekonzept und einer fachlichen Sicherheitsabnahme durchführen.
