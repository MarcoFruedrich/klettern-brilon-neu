# Internes Mitarbeiter-Wissensportal

Das Wissensportal ist in der geschützten Verwaltung unter **Wissensportal** und
im angemeldeten Mitarbeiterbereich unter **Wissensportal – internes Nachschlagewerk** eingebunden.

## Inhalt und Bedienung

- Kategorien: Allgemeines, Programme, Standorte, Sicherheitseinweisungen, Arbeitsabläufe, Notfall & Erste Hilfe.
- Titel, Kurzbeschreibung, Artikeltext, optionale HTTPS-Dokumentlinks und beliebig viele Standortzuordnungen.
- Entwurf/Veröffentlichung über die Verwaltung; Veröffentlichung ist standardmäßig ausgeschaltet.
- Suche und Standort-/Kategoriefilter für Mitarbeiter.
- Standortbezogene Beiträge sind nur für Mitarbeiter sichtbar, die für mindestens einen zugewiesenen Standort freigegeben wurden. Beiträge ohne Zuordnung sind für alle angemeldeten Mitarbeiter lesbar.
- Sicherheitseinweisungen und Notfallartikel haben eine versionsbezogene Lesebestätigung. Inhaltliche Änderungen erhöhen die Versionsnummer und machen ältere Bestätigungen für die neue Fassung ungültig.
- Die Verwaltung kann Lesebestätigungen pro Artikel und aktueller Version ansehen. Eine Lesebestätigung ist **kein** Ersatz für eine praktische oder gesetzlich geforderte Unterweisung.

## Einrichtung nach Freigabe

Die neue Datenbankstruktur wird **nicht** bei einem normalen Serverstart angelegt.
Vor Nutzung auf Render muss die verantwortliche Verwaltung die eng begrenzte,
idempotente Migration einmalig mit der Umgebungsvariable
`RUN_WISSENSPORTAL_MIGRATION=true` und einem Service-Neustart ausführen.
Nach erfolgreicher Schema-Prüfung den Schalter wieder entfernen und neu starten.

Voraussetzungen: vorhandene Tabellen `brilon_pruef_mitarbeitende`,
`brilon_pruef_freigaben` und `brilon_orte`.
Die Migration verändert keine Buchungsdaten, Entgelte, E-Mail-Einstellungen
oder Benutzerpasswörter.

## Sicherheits- und Versionsregeln

Die Artikel sind serverseitig auf Veröffentlichungsstatus und Standortberechtigung begrenzt.
Administrative Änderungen erfordern gültige Admin-Sitzung samt CSRF-Prüfung.
Lesebestätigungen erfordern eine aktive Mitarbeiter-Sitzung und gleiche Herkunft.
Externe Verweise sind ausschließlich HTTPS. Artikeltexte werden als reiner Text angezeigt;
HTML-Skripte werden nicht interpretiert. PDF-/Bild-Uploads sind in dieser Ausbaustufe
noch nicht integriert. 
