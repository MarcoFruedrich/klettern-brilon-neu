# Bearbeitbare Startseiten-Kacheln – 05.11.2026

Status: Anforderung bestätigt, technische Umsetzung noch ausstehend.

Unter „Dein Abenteuer beginnt hier“ sollen die bisherigen vier Kacheln (Klettern & Toprope, Bouldern, Seilabenteuer, Geburtstage & Gruppen) nicht mehr fest im HTML hinterlegt sein.

## Verwaltung
- Kacheln erstellen, bearbeiten, sortieren, aktivieren/deaktivieren.
- Titel, Beschreibung, Bild oder Symbol und optionaler Link editierbar.
- Einer Kachel können mehrere vorhandene buchbare Programme über deren stabile IDs zugeordnet werden.
- Die Kacheln sollen eine Detailansicht mit Beschreibung und passenden Programmen öffnen; von dort Auswahl und Übergang zur Buchungsanfrage.
- Programme ohne passende Zuordnung dürfen nicht fälschlich als buchbar angezeigt werden.
- Freie externe Links nur mit sicherer URL-Prüfung, bevorzugt interne Verlinkung.
- Änderungen an Kacheln dürfen bestehende Buchungen und Programme nicht löschen.

## Veröffentlichung
- Zuerst isolierte Migration und Tests; erst dann kontrollierte Render-Bereitstellung.
