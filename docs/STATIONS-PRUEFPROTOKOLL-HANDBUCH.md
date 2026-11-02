# Stations-Prüfprotokoll – Betriebs- und Testanleitung

**Stand:** Entwicklungszweig, noch nicht für den produktiven Betrieb oder als versicherungsrechtlicher Nachweis freigegeben.

## Ablauf vor jedem Programm

1. Die verantwortliche Person erfasst im Adminbereich unter **Stationsprüfungen** alle zu kontrollierenden Stationen und die Mitarbeiterkonten.
2. Am Standort wird der neue sechsstellige Code erzeugt. Er bleibt höchstens 120 Sekunden gültig und kann nur einmal verwendet werden.
3. Die Fachkraft öffnet `/pruefung.html`, meldet sich persönlich an und trägt den Code ein.
4. Sie gibt Programm und geplanten Programmbeginn an. Alle **tatsächlich verwendeten** Stationen müssen ausgewählt werden; jede wird auf **in Ordnung** oder **Mangel** gesetzt.
5. Bei Mängeln sind eine konkrete Beschreibung und bei Bedarf bis zu drei Fotos möglich. Die Bildverarbeitung erfolgt auf dem Gerät (max. 640 Pixel Kantenlänge und 80 KB JPEG pro Foto). Personen möglichst nicht abbilden.
6. Der Bericht wird gespeichert. Eine neue Prüfung erfordert einen neuen Code. Der Bericht kann in der Verwaltung eingesehen werden. Fotobelege werden separat und nur für angemeldete Administratoren ausgegeben.

**Wichtige Sicherheitsregel:** Bei einem Mangel ist die betroffene Station **nicht zu verwenden**, bis eine fachlich verantwortliche Person ihre Sicherheit geprüft und die Nutzung ausdrücklich freigegeben hat. Eine elektronische Dokumentation ist keine automatische Betriebsfreigabe.

## Mängelbenachrichtigung

Eine Mängel-E-Mail wird nur verschickt, wenn `PRUEF_MANGEL_EMAIL` und die Mailanbindung gültig eingerichtet sind. Der Server bestätigt gesondert den tatsächlichen Versandstatus. Falls nicht konfiguriert oder gescheitert, muss die Fachkraft die verantwortliche Person direkt informieren. Ein verlässlicher Wiederholungsversand fehlt noch.

## Sicherheits- und Datenschutzgrenzen

- Die Codeausgabe ist derzeit nur aus der **vollwertigen Adminverwaltung** möglich. Ein öffentlich erreichbares Tablet darf daher nicht einfach mit einer offenen Adminsitzung betrieben werden. Vor Ort wird eine separate, technisch beschränkte Kiosk-Anzeige benötigt.
- Ein eingegebener Vor-Ort-Code beweist die physische Anwesenheit nicht unabhängig. Er dient der zusätzlichen Hürde.
- Fotos sind im privaten Bericht gespeichert; eine gesonderte Aufbewahrungsfrist, Ersetzungs-/Löschregelung, Bildinhaltsprüfung und vollständige Datenschutzinformation fehlen.
- Die Auswahl der verwendeten Stationen liegt bei der prüfenden Fachkraft. Das System kann nicht selbst erkennen, ob eine Station ausgelassen wurde.
- Es gibt noch keinen automatischen Workflow für Mängelbeseitigung, Nachkontrolle und fachliche Wiederfreigabe.
- Mitarbeitersitzungen sind vier Stunden gültig. Der Vor-Ort-Code ist einmalig, die Berichtsfreigabe läuft spätestens nach 15 Minuten ab.
- Neue Prüftabellen dürfen nur nach Schema-Review und ausdrücklicher Freigabe migriert werden. **Keine produktive Migration**.

## Testumfang

Isolierte PostgreSQL-Tests decken Mitarbeitereinrichtung, Anmeldung, Codeeinlösung, Wiederverwendungsschutz, unvollständige Mängeltexte, Berichtsspeicherung und geschützten Foto-Download ab. Echte Chromium-Tests prüfen die mobile Anmeldung, Codeeingabe, Fotokonvertierung und Berichtsübermittlung bei 360, 390 und 768 Pixeln.

**Vor einem Echtbetrieb:** Eine Testinstallation mit kontrollierten Rollen, Mängel-Mailzustellung in ein Testpostfach, Datenschutzhinweisen, Foto-Löschfrist, Tabletsperre, Stationssperr-/Freigabekonzept und einer fachlichen Sicherheitsabnahme durchführen.
