# ClamAV für Bild-Uploads

## Problem
`server.js` blockiert Bild-Uploads absichtlich, wenn der ClamAV-Dienst (CLAMD_HOST und CLAMD_PORT) nicht erreichbar ist. Die Formatprüfung durch `lib/bilddatei.js` ersetzt den Virenscan nicht.

## Deployment (nur nach Budgetfreigabe)
1. In Render **My Workspace** in Region **Oregon** einen **Private Service** mit Docker und `infra/clamav/Dockerfile` erstellen. Nicht als öffentliches Web-Service bereitstellen. Alternativ das optionale Blueprint `render-clamav.yaml` verwenden. Für ClamAV und Signatur-Updates ausreichend RAM bereitstellen (Plan/Preis vorher prüfen).
2. Warten, bis die ClamAV-Signaturen geladen und der TCP-Scanner auf Port **3310** erreichbar ist. Beim Start muss der Service die Malware-Signaturdaten laden können.
3. Internen Hostnamen des privaten Dienstes aus Render **Connect > Internal** entnehmen.
4. Im bestehenden Render-Web-Service `klettern-brilon-neu` unter Environment die Werte `CLAMD_HOST=<privater Hostname>`, `CLAMD_PORT=3310` setzen (keine öffentliche URL, kein http://).
5. Dienst und Bild-Upload sicher testen: gültiges kleines JPG/PNG wird angenommen, Scanner-Ausfall blockiert weiterhin, erkannte Malware wird abgewiesen. Testdateien mit privatem Inhalt vermeiden.
6. Keine Sicherheitsprüfung abschalten und niemals Port 3310 öffentlich zugänglich machen.

**Hinweis:** Render-MCP kann derzeit nur neue **Web Services**, keine Private Services erstellen. Daher erfordert dieser Schritt die Render-Oberfläche oder einen bewussten Blueprint-Sync. Dieses Repository erzeugt durch das Vorhandensein der Dateien **keinen** kostenpflichtigen Service.
