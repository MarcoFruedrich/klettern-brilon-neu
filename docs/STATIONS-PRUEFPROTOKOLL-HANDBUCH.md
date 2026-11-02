# Stations-Prüfprotokoll – Betriebs- und Testanleitung

**Stand:** Entwicklungszweig, noch nicht für den produktiven Betrieb oder als versicherungsrechtlicher Nachweis freigegeben.

## Ablauf vor jedem Programm

1. Die verantwortliche Person erfasst im Adminbereich unter **Stationsprüfungen** alle zu kontrollierenden Stationen und die Mitarbeiterkonten.
2. Die Fachkraft meldet sich auf ihrem Smartphone an und tippt **„Code am Tablet anzeigen“**. Der neue sechsstellige Code erscheint nur auf einem bereits gekoppelten Tablet am Standort. Er bleibt höchstens 120 Sekunden gültig und kann nur einmal verwendet werden.
3. Die Fachkraft liest den Code am Tablet ab und trägt ihn auf ihrem Smartphone unter `/pruefung.html` ein.
4. Sie gibt Programm und geplanten Programmbeginn an. Alle **tatsächlich verwendeten** Stationen müssen ausgewählt werden; jede wird auf **In Ordnung**, **Hinweis / kleiner Mangel** oder **Sicherheitsmangel** gesetzt.
5. Bei Hinweisen und Mängeln sind eine konkrete Beschreibung und bei Bedarf bis zu drei Fotos möglich. Die Bildverarbeitung erfolgt auf dem Gerät (max. 640 Pixel Kantenlänge und 80 KB JPEG pro Foto). Personen möglichst nicht abbilden.
6. Der Bericht wird gespeichert. Eine neue Prüfung erfordert einen neuen Code. Der Bericht kann in der Verwaltung eingesehen werden. Fotobelege werden separat und nur für angemeldete Administratoren ausgegeben.

**Wichtige Sicherheitsregel:** Bei einem Mangel ist die betroffene Station **nicht zu verwenden**, bis eine fachlich verantwortliche Person ihre Sicherheit geprüft und die Nutzung ausdrücklich freigegeben hat. Eine elektronische Dokumentation ist keine automatische Betriebsfreigabe.

## Gesichertes Werbetablet – einmalige Einrichtung

1. Das fest installierte Tablet über eine gesicherte HTTPS-Verbindung mit `/tablet.html` verbinden. Solange es nicht gekoppelt ist, erscheint das einmalige Kopplungsformular.
2. In der geschützten Verwaltung unter `/admin.html#stationspruefung` **Tablet-Kopplungscode erzeugen** wählen. Es erscheint ein achtstelliger Code, der zehn Minuten lang und nur einmal nutzbar ist.
3. Am Tablet eine aussagekräftige Gerätebezeichnung, zum Beispiel `Kletterhalle Fenster-Tablet`, und den achtstelligen Code eingeben.
4. Das Tablet zeigt nun abwechselnd die öffentlich buchbaren Angebote. Wird von einer angemeldeten Fachkraft eine Prüfung angefordert, wechselt das Tablet für höchstens zwei Minuten zur sechsstelligen Codeanzeige. Bei Ablauf, Verbrauch oder Verbindungsausfall verschwindet der Code.
5. Wird das Tablet verloren, entwendet oder ausgetauscht, in der Verwaltung **Tablet-Zugang sperren** auswählen. Eine erneute Nutzung erfordert eine neue Kopplung.

**Technische Grenzen:** Das Tablet hat keine Adminsitzung. Sein Geräteschlüssel liegt als `HttpOnly`-, `Secure`- und `SameSite=Strict`-Cookie vor und wird nicht in JavaScript gespeichert. Die zugehörige Berechtigung läuft spätestens nach 30 Tagen ab und ist widerrufbar. Der angeforderte Prüfcode wird nur verschlüsselt in PostgreSQL vorgehalten und mit einem serverseitigen Geheimnis entschlüsselt. Die Fachkraft kann ihn nicht auf ihrem eigenen Telefon abrufen. Ein ungültiger oder mehrfach verwendeter Code wird abgewiesen.

**Vor dem realen Einsatz:** Den Android-Kioskmodus bzw. den Einzel-App-Modus durch die Geräteverwaltung einrichten, das Tablet physisch gegen Zugriff absichern, Kopplung unter Aufsicht durchführen und den Ablauf bei WLAN-Ausfall testen. Eine Browserseite allein verhindert weder das Verlassen der App noch die Nutzung des Tablets an einem anderen Standort. Die physische Anwesenheit wird durch dieses Verfahren nicht unabhängig bewiesen.

## Hinweise und kleinere Mängel ohne automatische Sperre

Ein Hinweis eignet sich für **nicht unmittelbar sicherheitsrelevante Auffälligkeiten**, beispielsweise eine verblasste Beschriftung oder einen organisatorischen Verbesserungsbedarf. Hier ist eine Beschreibung mit mindestens zehn Zeichen verpflichtend; ein Foto kann ergänzt werden. Der Hinweis erscheint als **offener Prüfpunkt** in der Verwaltung.

Die zuständige Person prüft den Hinweis, dokumentiert Prüfername und Ergebnis und markiert ihn anschließend als erledigt. Der ursprüngliche Prüfbericht bleibt unverändert. Durch das Erstellen oder Erledigen eines Hinweises wird keine Stationssperre gesetzt oder aufgehoben.

**Bei jeder Unsicherheit über die sichere Benutzbarkeit ist stattdessen „Sicherheitsmangel“ zu wählen.** Dieser löst die automatische Sperrung weiterhin aus. Ein Hinweis ist keine Bestätigung der technischen Sicherheit.

## Automatische Stationssperrung und fachliche Freigabe

Jede als **Mangel** gespeicherte Stationsprüfung sperrt die betroffene Station automatisch in der Datenbank und dokumentiert ein Ereignis mit Bericht, Prüfperson und Beschreibung. Die Sperrung bleibt bestehen, auch wenn ein späterer Prüfbericht für dieselbe Station „in Ordnung“ vermerkt.

Die Verwaltung zeigt gesperrte Stationen deutlich an. Erst nachdem eine fachkundige Person die Station vor Ort nachgeprüft und erforderliche Mängel behoben hat, darf eine autorisierte Verwaltungsperson die Schaltfläche „Nach fachlicher Prüfung freigeben“ verwenden. Die Verwaltung verlangt dabei den Namen der prüfenden Person, eine konkrete Dokumentation der Nachkontrolle und eine abschließende Bestätigung. Die Freigabe wird in einem dauerhaft nachvollziehbaren Ereignisverlauf protokolliert.

**Wichtig:** Die digitale Freigabe ist eine dokumentierte Verwaltungsentscheidung; sie führt selbst keine technische Kontrolle durch. Auch nach Freigabe ist vor einem neuen Programm eine eigenständige vollständige Vorabprüfung erforderlich. Eine gemeldete gesperrte Station darf nicht in Betrieb genommen werden.

## Mängelbenachrichtigung

Jede Sicherheitsmangelmeldung wird dauerhaft in der isolierten Testdatenbank als Mail-Ausgangsvorgang angelegt. Der erste Versand erfolgt unmittelbar nach dem Speichern des Prüfprotokolls, sofern `PRUEF_MANGEL_EMAIL` und die E-Mail-Anbindung korrekt eingerichtet sind. Gespeichert werden der Versandstatus, die Zahl der Versuche und die Zeitpunkte. **„Vom Anbieter angenommen“ bedeutet nicht „beim Empfänger zugestellt“.**

Unter **Stationsprüfungen → Mängelmeldungen – E-Mail-Versand** sieht die berechtigte Verwaltung nicht bestätigte Meldungen. Bei `fehlgeschlagen` oder `nicht_konfiguriert` kann nach ausdrücklicher Kontrolle und Bestätigung ein neuer Versandversuch gestartet werden. Dabei sollte zuvor geprüft werden, ob die Nachricht trotz Fehlermeldung angekommen ist. Wurde sie vom Anbieter bereits angenommen, sperrt das System den Neuversand. Ein **unklarer Versandzustand** nach Serverabbruch wird nicht blind erneut versucht.

**Bei sicherheitsrelevanten Mängeln und jeder ausgefallenen Benachrichtigung:** Verantwortliche Person zusätzlich unmittelbar kontaktieren; der E-Mail-Ausgang ist kein Ersatz für notwendige Gefahrenabwehr. Kleine nicht sicherheitsrelevante Hinweise erzeugen keine Sicherheitsmangel-E-Mail. Ein automatischer zeitgesteuerter Neuversand ist noch nicht vorhanden.

## Sicherheits- und Datenschutzgrenzen

- Der eigenständige Tablet-Modus mit Gerätetausch/Sperrung ist implementiert. Eine physische Installation und eine echte Android-Kiosk-/Einzel-App-Konfiguration sind noch nicht durchgeführt; ohne diese organisatorischen Schutzmaßnahmen darf das Tablet nicht unbeaufsichtigt betrieben werden.
- Ein eingegebener Vor-Ort-Code beweist die physische Anwesenheit nicht unabhängig. Er dient der zusätzlichen Hürde, ebenso wie die widerrufbare Kopplung des Tablets.
- Fotos sind im privaten Bericht gespeichert; eine gesonderte Aufbewahrungsfrist, Ersetzungs-/Löschregelung, Bildinhaltsprüfung und vollständige Datenschutzinformation fehlen.
- Die Auswahl der verwendeten Stationen liegt bei der prüfenden Fachkraft. Das System kann nicht selbst erkennen, ob eine Station ausgelassen wurde.
- Die automatische Sperrung und eine dokumentierte administrative Freigabe sind umgesetzt. Es gibt noch keine unabhängige digitale Verifikation der fachlichen Nachkontrolle, keine verpflichtende gesonderte Abnahme durch einen qualifizierten Prüfer und keine automatisierte Auftragsverfolgung der Mängelbeseitigung.
- Mitarbeitersitzungen sind vier Stunden gültig. Der Vor-Ort-Code ist einmalig, die Berichtsfreigabe läuft spätestens nach 15 Minuten ab.
- Neue Prüftabellen sowie die Spalten `gesperrt_am`/`sperrgrund` und die Tabellen `brilon_pruef_stationsereignisse` und `brilon_pruef_meldungen` dürfen nur nach Schema-Review und ausdrücklicher Freigabe migriert werden. **Keine produktive Migration**.

## Testumfang

Isolierte PostgreSQL-Tests decken Mitarbeitereinrichtung, Anmeldung, Codeeinlösung, Wiederverwendungsschutz, unvollständige Mängeltexte, Berichtsspeicherung und geschützten Foto-Download ab. Echte Chromium-Tests prüfen die mobile Anmeldung, Codeeingabe, Fotokonvertierung und Berichtsübermittlung bei 360, 390 und 768 Pixeln.

**Vor einem Echtbetrieb:** Eine Testinstallation mit kontrollierten Rollen, Mängel-Mailzustellung in ein Testpostfach, Datenschutzhinweisen, Foto-Löschfrist, Tabletsperre, Stationssperr-/Freigabekonzept und einer fachlichen Sicherheitsabnahme durchführen.
