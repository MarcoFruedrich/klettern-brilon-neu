# Gästeermäßigungen für Buchungsanfragen (Anforderung 2026-11-05)

Status: Fachkonzept, noch nicht implementiert oder produktiv aktiviert.

## Kundenformular
- Pflichtfrage: „Sind Sie Gast einer Unterkunft oder Einrichtung?“ Ja/Nein.
- Bei Ja: Dropdown mit aktiven, von der Verwaltung hinterlegten Unterkünften und Netzwerkpartnern (z. B. Jugendherberge Brilon oder Jugendherberge Möhnesee, nur Beispiele). Zusätzlich immer die Option „Andere Unterkunft oder Einrichtung“ mit freiem Textfeld anbieten. Keine Beschränkung auf Jugendherbergen.
- Rabatt unverbindlich als voraussichtlichen Preis ausweisen; tatsächliche Berechtigung vor Bestätigung prüfen.
- Bei Nein keine Rabattdaten erzwingen.

## Administration
- Eigener Bereich „Gästeermäßigungen“: Unterkunft/Netzwerkpartner mit stabiler ID, Anzeigename, Prozentsatz (0–100), aktiv/inaktiv, optional Gültigkeit. Nur aktive Partner im Dropdown anbieten.
- Änderungen ohne Programmcode, deaktivierte Standorte bleiben für alte Buchungen nachvollziehbar.
- Bei freier Eingabe Rabatt nur nach eindeutiger Zuordnung zu einer aktiven Admin-Regel vorschlagen, sonst manuell prüfen.
- Rabattprozentsätze und Auswahl zum Anfragezeitpunkt in der Buchung historisieren.
- Serverseitige Prüfung, kein Vertrauen auf vom Browser gesendete Prozentsätze.

## Preisregeln
- Beispiel 100 EUR, 15 % -> 85 EUR.
- Keine automatische Kumulation mit dem bestehenden 10-%-Anschlussrabatt oder Sonderaktionen; Priorität und Kombinierbarkeit vor Implementierung fachlich klären.
- Rundung auf Cent und Preisaufschlüsselung für Verwaltung/Kunden.

## Umsetzungsschritte
1. Bestehende Tabellen brilon_orte, Buchungsdaten, Preislogik und API-Endpunkte prüfen.
2. Separat aktivierbare, migrationssichere Rabatt-Konfiguration hinzufügen.
3. Geschützte Admin-CRUD-Endpunkte und einfache Admin-Oberfläche ergänzen.
4. Öffentliches Formular um Ja/Nein und Standortauswahl ergänzen.
5. Rabattberechnung ausschließlich serverseitig, berechtigungsabhängige Bestätigung.
6. Tests für unbekannte Standorte, 0/100 %, Änderungen, Manipulation, Anschlussrabatt und Bestandsbuchungen.
7. Erst in Testumgebung prüfen, dann kontrolliert bereitstellen.
