# Versionen der GPS-Gästelisten-Einwilligung

## `2026-11-02-v1`

Wortlaut der Version:

> Ich stimme zu, dass der von mir angegebene Name, das Datum und die benötigte Zeit öffentlich in der Gästeliste erscheinen. Die Teilnahme ist auch ohne Einwilligung möglich.

Diese Version wird zusammen mit dem Einwilligungszeitpunkt am abgeschlossenen
GPS-Spiel gespeichert. Beide Werte sind nur in der geschützten Admin-Gästeliste
sichtbar. Die öffentliche Gästeliste erhält weiterhin nur Name, Datum und
Spielzeit. Beim Entfernen eines öffentlichen Eintrags werden Name, Zustimmung,
Zeitpunkt und Textversion gelöscht; der interne Spielabschluss bleibt bestehen.

Wenn sich der Wortlaut ändert, eine neue Versionskennung vergeben und diese in
`site/gps.html`, `server.js` und diesem Verzeichnis aktualisieren. Der Server
weist veraltete Versionskennungen ab. Die Kennung allein ersetzt keine
fachliche Datenschutzprüfung des Textes oder eines Aufbewahrungskonzepts.
