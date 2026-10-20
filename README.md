# Klettern & Abenteuer Brilon – Neuaufbau

Eigenständige responsive Website mit Terminanfragen, PostgreSQL und geschütztem Verwaltungsbereich.

## Lokal starten

1. Node.js 20+ installieren.
2. `npm install`
3. Umgebungsvariablen `DATABASE_URL`, `ADMIN_USER`, `ADMIN_PASSWORD` setzen (siehe `.env.example`).
4. `npm start`
5. `http://localhost:3000` öffnen.

## Render

- Repository auf GitHub hochladen; **alle Dateien aus diesem Ordner in das Repository-Hauptverzeichnis**, nicht den übergeordneten ZIP-Ordner.
- Web Service: Build Command `npm install`, Start Command `npm start`.
- Environment: `DATABASE_URL`, `ADMIN_USER`, `ADMIN_PASSWORD` setzen. Render verwendet `PORT` automatisch.
- Die Tabellen werden beim Start angelegt.
- Admin: `/admin.html`.
- Wichtig: Das alte Projekt erst ersetzen, wenn der neue Dienst erfolgreich getestet wurde.

## Stand und Einschränkungen

- Buchungsanfragen sind **keine verbindlichen Buchungen**; keine automatische Verfügbarkeitsprüfung, Bestätigungsmails oder Zahlungen.
- **PayPal/Kartenzahlung/25 % Anzahlung** sind konzeptionell vorgesehen, aber bewusst noch nicht aktiviert. Dazu sind Zahlungsanbieter-Konten, Webhooks und sichere serverseitige Prüfung erforderlich.
- Für produktiven Betrieb: Datenschutzhinweise und Impressum rechtlich prüfen, AV-Verträge mit Hosting/Datenbank klären, Löschfristen umsetzen, Backup-Strategie festlegen, E-Mail-Benachrichtigung und Admin-2FA ergänzen.
- Der Admin nutzt sichere HttpOnly-Cookies; Sitzungen liegen im Arbeitsspeicher und gehen bei Server-Neustart verloren. Für mehrere Instanzen wäre ein persistenter Session-Store nötig.
- Falls Render-Datenbank TLS-Einstellungen abweichen, PostgreSQL-Konfiguration prüfen. SSL-Zertifikate werden standardmäßig geprüft.
- Buchungsdaten können im Admin gelesen werden; eine Lösch-/Exportfunktion ist noch nicht eingebaut.
- Nur Platzhaltertexte und Symbole, keine fremden Bilder.
