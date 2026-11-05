# Stations-Prüfprotokoll – Betriebs- und Testanleitung

**Stand:** Entwicklungszweig, noch nicht für den produktiven Betrieb oder als versicherungsrechtlicher Nachweis freigegeben.

## Ablauf vor jedem Programm

1. Die Verwaltung trägt Name und E-Mail der Person ein und sendet ihr eine Einladung. Der persönliche Link ist sieben Tage gültig und nur einmal verwendbar. Er setzt `PUBLIC_BASE_URL` sowie den E-Mail-Versand voraus; wenn der Mailversand nicht bestätigt wird, zeigt die Verwaltung den Link zur sicheren manuellen Weitergabe an.
2. Die eingeladene Person öffnet den Link und ergänzt Namen, Telefonnummer, vollständige Anschrift und Qualifikationen/Erfahrung. Sie kann bis zu fünf Bescheinigungen als Foto hochladen und setzt ihr eigenes Passwort. Die E-Mail-Adresse ist an die Einladung gebunden.
3. Nach dem Absenden bleibt das Konto **gesperrt**. Die Verwaltung prüft die persönlichen Angaben und Fotos, wählt mindestens einen aktiven Standort und eine oder mehrere belegte Qualifikationen und klickt **„Auswahl freigeben und Zugang aktivieren“**. Erst danach kann sich die Person anmelden; die Benachrichtigung nennt den freigegebenen Umfang.
4. Die Fachkraft meldet sich auf ihrem Smartphone an und tippt **„Code am Tablet anzeigen“**. Der neue sechsstellige Code erscheint nur auf einem bereits gekoppelten Tablet am Standort. Er bleibt höchstens 120 Sekunden gültig und kann nur einmal verwendet werden.
5. Die Fachkraft liest den Code am Tablet ab und trägt ihn auf ihrem Smartphone unter `/pruefung.html` ein.
6. Sie gibt Programm und geplanten Programmbeginn an. Alle **tatsächlich verwendeten** Stationen müssen ausgewählt werden; jede wird auf **In Ordnung**, **Hinweis / kleiner Mangel** oder **Sicherheitsmangel** gesetzt.
7. Bei Hinweisen und Mängeln sind eine konkrete Beschreibung und bei Bedarf bis zu drei Fotos möglich. Die Bildverarbeitung erfolgt auf dem Gerät (max. 640 Pixel Kantenlänge und 80 KB JPEG pro Foto). Personen möglichst nicht abbilden.
8. Der Bericht wird gespeichert. Eine neue Prüfung erfordert einen neuen Code. Der Bericht kann in der Verwaltung eingesehen werden. Fotobelege werden separat und nur für angemeldete Administratoren ausgegeben.
9. Im Abschnitt **„Meine letzten Prüfprotokolle“** sieht die angemeldete Fachkraft bis zu 20 eigene Berichte mit Ergebnis und Stationen. Andere Mitarbeiterkonten und Fotodateien sind dort nicht zugänglich.

**Wichtige Sicherheitsregel:** Bei einem Mangel ist die betroffene Station **nicht zu verwenden**, bis eine fachlich verantwortliche Person ihre Sicherheit geprüft und die Nutzung ausdrücklich freigegeben hat. Eine elektronische Dokumentation ist keine automatische Betriebsfreigabe.

## Gesichertes Werbetablet – einmalige Einrichtung

1. Das fest installierte Tablet über eine gesicherte HTTPS-Verbindung mit `/tablet.html` verbinden. Solange es nicht gekoppelt ist, erscheint das einmalige Kopplungsformular.
2. In der geschützten Verwaltung unter `/admin.html#stationspruefung` **Tablet-Kopplungscode erzeugen** wählen. Es erscheint ein achtstelliger Code, der zehn Minuten lang und nur einmal nutzbar ist.
3. Am Tablet eine aussagekräftige Gerätebezeichnung, zum Beispiel `Kletterhalle Fenster-Tablet`, und den achtstelligen Code eingeben.
4. In der Verwaltung neben dem gekoppelten Tablet **„Als Prüfdisplay auswählen“** anklicken und bestätigen. Nur dieses Gerät ist zur Anzeige der sechsstelligen Stationsprüfcodes berechtigt. Weitere gekoppelte Geräte bleiben reine Werbeanzeigen.
5. Das Tablet zeigt nun abwechselnd die öffentlich buchbaren Angebote. Wird von einer angemeldeten Fachkraft eine Prüfung angefordert, wechselt das Tablet für höchstens zwei Minuten zur sechsstelligen Codeanzeige. Bei Ablauf, Verbrauch oder Verbindungsausfall verschwindet der Code.
6. Wird das Tablet verloren, entwendet oder ausgetauscht, in der Verwaltung **Tablet-Zugang sperren** auswählen. Eine erneute Nutzung erfordert eine neue Kopplung.

**Gerät ersetzen oder auf demselben Tablet neu koppeln:** In der Verwaltung beim bisherigen Gerät **„Tablet ersetzen / neu koppeln“** wählen und die sofortige Sperrung bestätigen. Die Verwaltung zeigt einen achtstelligen Ersatz-Kopplungscode an (zehn Minuten, einmal verwendbar). Das Altgerät kann ab diesem Augenblick keine Prüfcodes mehr erhalten. Auch noch nicht verwendete Codes für dieses Tablet sind ungültig. Am neuen Gerät oder auf dem neu einzurichtenden bisherigen Tablet `/tablet.html` öffnen und den Ersatzcode eintragen. Das Gerät erscheint als neue Kopplung in der Verwaltung, zunächst nur für die Angebotsanzeige. Falls es Stationsprüfcodes zeigen soll, anschließend ausdrücklich **„Als Prüfdisplay auswählen“**. Bis dahin werden Prüfcode-Anforderungen der Mitarbeitenden ohne gewähltes, online erreichbares Prüfdisplay verweigert. Bei einem fehlgeschlagenen oder abgelaufenen Ersatzcode erzeugt die Verwaltung einen neuen einmaligen Kopplungscode. Bei Verlust des Tablets niemals den alten Gerätezugang erneut freischalten.

**Technische Grenzen:** Das Tablet hat keine Adminsitzung. Sein Geräteschlüssel liegt als `HttpOnly`-, `Secure`- und `SameSite=Strict`-Cookie vor und wird nicht in JavaScript gespeichert. Die zugehörige Berechtigung läuft spätestens nach 30 Tagen ab und ist widerrufbar. Die Administration wählt höchstens ein Gerät als Prüfdisplay aus. Eine gültige Kopplung allein berechtigt **nicht** zum Einblenden eines Prüfcodes. Der angeforderte Prüfcode wird nur verschlüsselt in PostgreSQL vorgehalten und mit einem serverseitigen Geheimnis entschlüsselt. Die Fachkraft kann ihn nicht auf ihrem eigenen Telefon abrufen. Ein ungültiger oder mehrfach verwendeter Code wird abgewiesen.

**Gerätewechsel:** Falls das Prüfdisplay ausgetauscht wird, kann die Verwaltung ein anderes bereits gekoppeltes Tablet auswählen. Dabei werden bisherige noch nicht verwendete Prüfdisplay-Codes ungültig. Mitarbeitende müssen anschließend einen neuen Code anfordern. Ein anderes verbundenes Werbetablet darf einen Code weder vor noch nach dem Wechsel auslesen, sofern es nicht selbst ausgewählt wurde. Wird das ausgewählte Display gesperrt oder ist es offline, sind neue Codeanforderungen blockiert, auch wenn weitere Werbetablets online sind.

**Festgelegte Zugangssituation:** Das Tablet ist ausschließlich für die Verwaltung physisch erreichbar und bedienbar. Mitarbeitende bedienen das Tablet **nicht**; sie können den kurz angezeigten Code lediglich ablesen. Gäste können Werbung sehen, jedoch keinerlei Eingaben am Tablet vornehmen. Daher ist eine zusätzliche Android-Kiosksperre gegen unbefugte Touch-Bedienung nicht zwingend, sofern die Abschirmung in der Praxis gewährleistet ist. Die Verwaltung übernimmt die Erstkopplung, Betriebssystem-Einstellungen und nötige Gerätesperrungen. Vor echtem Einsatz sollten Befestigung, Sichtbarkeit der Anzeige, WLAN-Ausfall und automatischer Wiederanlauf geprüft werden. Die physische Anwesenheit wird durch den Code nicht unabhängig bewiesen.

## Tablet-Verbindung in der Verwaltung prüfen

In der geschützten Stationsprüfung-Verwaltung zeigt **„Tablet-Verbindung prüfen“** die gekoppelten Tablets mit dem letzten vom Server empfangenen Lebenszeichen. Die Anzeige unterscheidet:

- **Erreichbar:** Ein gültig gekoppeltes, nicht gesperrtes Tablet hat sich in den letzten 45 Sekunden beim Server gemeldet.
- **Keine aktuelle Verbindung:** Das Tablet ist zwar gekoppelt, hat sich aber seit mehr als 45 Sekunden nicht gemeldet oder die Werbeseite wurde noch nie geöffnet. Neue Prüfcode-Anforderungen werden dann abgewiesen.
- **Gesperrt:** Der Gerätezugang wurde durch die Verwaltung deaktiviert und kann keine Prüfcodes mehr empfangen.

Ist die Code-Anforderung auf dem Mitarbeitertelefon gesperrt, zunächst vor Ort überprüfen, ob das Werbetablet eingeschaltet ist, die Webseite sichtbar läuft und eine Internetverbindung besteht. Nach Wiederherstellung der Verbindung wird der Status durch eine neue Tabletanfrage aktualisiert. Die Erreichbarkeitsanzeige bestätigt **nur den letzten Kontakt zum Server**, nicht die tatsächliche physische Aufstellung oder Anwesenheit einer Person.

Bei einem Wechsel zu einer anderen App oder einem unsichtbaren Browser-Tab beendet die Werbeseite ihre regelmäßigen Lebenszeichen und blendet einen gerade sichtbaren Prüfcode aus. Die Werbeanzeige selbst wird nicht über den Mitarbeiterzugang bedient.

## Zuverlässige Werbeanzeige im Dauerbetrieb

- **Angebote:** Alle elf Sekunden wird zum nächsten veröffentlichten Angebot gewechselt. Alle fünf Minuten wird die Liste aktualisiert; Änderungen aus der Verwaltung können so ohne Neustart sichtbar werden. Bei einem kurzzeitigen Serverausfall bleibt die zuvor geladene Werbung erhalten.
- **Sicherheitscode:** Der Code unterbricht die Werbung nur kurzzeitig und wird lokal zeitlich begrenzt. Bei Codeverbrauch, Ablauf, Netzwerkausfall oder zwischenzeitlichem Wechsel zu einer anderen App wird die Codeanzeige sofort ausgeblendet bzw. vor erneuter Anzeige durch den Server überprüft.
- **Bildschirm:** Die Webseite versucht über die Browser-Schnittstelle Screen Wake Lock, den Bildschirm während der Anzeige wach zu halten. Das funktioniert nur bei unterstütztem Browser und sicherer HTTPS-Verbindung. Es ersetzt **keine** Android-Einstellung für dauerhaft eingeschalteten Bildschirm beim Laden.
- **Neustart:** Nach erneutem Öffnen der Webseite beginnt die Werbeanzeige ohne zusätzliche Anmeldung, sofern die widerrufbare Tablet-Kopplung gültig bleibt. Für einen **automatischen Browserstart nach vollständigem Android-Neustart** ist eine gesonderte Konfiguration des Gerätes erforderlich; das kann eine Webseite nicht selbst erzwingen.
- **Bedienung:** Das Tablet ist gemäß Betriebsvorgabe ausschließlich von der Verwaltung physisch zugänglich. Andere Personen können nur die Anzeige sehen. Ein zusätzlicher Besucherschutz gegen Bedienung wird deshalb nicht vorausgesetzt.

**Vor Ort prüfen:** Gerät dauerhaft laden, Bildschirm-Energiesparverhalten im Android-System kontrollieren, Ausfall der Internetverbindung simulieren, anschließend die Werbeanzeige und die kurze Codeeinblendung mit einem Testmitarbeiter prüfen. Erst danach das Tablet fest montieren bzw. freigeben.

## Hinweise und kleinere Mängel ohne automatische Sperre

Ein Hinweis eignet sich für **nicht unmittelbar sicherheitsrelevante Auffälligkeiten**, beispielsweise eine verblasste Beschriftung oder einen organisatorischen Verbesserungsbedarf. Hier ist eine Beschreibung mit mindestens zehn Zeichen verpflichtend; ein Foto kann ergänzt werden. Der Hinweis erscheint als **offener Prüfpunkt** in der Verwaltung.

Die zuständige Person prüft den Hinweis, dokumentiert Prüfername und Ergebnis und markiert ihn anschließend als erledigt. Der ursprüngliche Prüfbericht bleibt unverändert. Durch das Erstellen oder Erledigen eines Hinweises wird keine Stationssperre gesetzt oder aufgehoben.

**Bei jeder Unsicherheit über die sichere Benutzbarkeit ist stattdessen „Sicherheitsmangel“ zu wählen.** Dieser löst die automatische Sperrung weiterhin aus. Ein Hinweis ist keine Bestätigung der technischen Sicherheit.

## Sicherheitsübersicht und offene Nachkontrollen

Nach der Admin-Anmeldung steht **„Aktuelle Sicherheitsübersicht“** am Beginn der Stationsprüfverwaltung. Mit **„Sicherheitsübersicht aktualisieren“** werden die aktuellen Daten erneut eingelesen. Die Übersicht ist **nur lesend** und unterscheidet klar zwischen:

- **Sicherheitsmängeln / Stationssperren:** „NICHT BENUTZEN“. Betroffene Stationen stehen in der Aufgabenübersicht zuerst, einschließlich des dokumentierten Sperrgrundes. Eine Freigabe ist ausschließlich im bestehenden Verfahren mit fachlicher Nachprüfung und ausführlicher Dokumentation möglich.
- **Administrativen Stilllegungen:** „NICHT BENUTZEN“. Eine Stilllegung allein ist keine Mängelsperre; eine Station kann zugleich beide Sperrgründe haben. In der Liste erscheint sie nur einmal. Auch eine Reaktivierung beseitigt eine fachliche Mängelsperre nicht.
- **Kleineren offenen Hinweisen:** Sie werden nachverfolgt, ohne allein eine automatische Sperre auszulösen. In der Hinweisverwaltung kann der Eintrag erst nach dokumentierter Nachprüfung als erledigt gekennzeichnet werden. Ist die Station gleichzeitig gesperrt, wird dies ausdrücklich angezeigt.
- **Nicht bestätigt versendeten Sicherheitsmeldungen:** Hierzu zählen fehlgeschlagene, noch nicht konfigurierte und ungeklärte E-Mail-Versandzustände. Die jeweilige Meldung muss im Mängel-Mailausgang geprüft werden. Ein angenommenes E-Mail-Schreiben ist keine Zustellgarantie.

Jeder Eintrag hat eine Schaltfläche, die zum jeweiligen Verwaltungsbereich führt. Die Übersicht selbst kann **keinen Bericht schließen, keine Sperre aufheben und keine E-Mail erneut senden**. Die Gesamtzahlen werden vollständig berechnet; für längere Listen werden zunächst höchstens 100 Stationen, 100 Hinweise und 50 Mängelbenachrichtigungen angezeigt.

**Wichtig:** Dies ist eine Übersicht offener Vorgänge, kein automatischer Wartungsplan und keine Bestätigung der sicheren Benutzbarkeit. Vor jedem Kletterprogramm müssen alle tatsächlich verwendeten Stationen weiterhin auf die fachlich vorgeschriebene Weise geprüft werden. Für kalendarische Prüfintervalle, Prüffristen und Verantwortlichkeiten ist zunächst ein gesondertes fachlich freigegebenes Wartungs- und Prüfschema erforderlich.

## Mitarbeiterzugänge und Stationen verwalten

Neue Mitarbeitende werden über **„Mitarbeiter zur Registrierung einladen“** mit Name und E-Mail-Adresse eingeladen. Sie vervollständigen ihre Anschrift, Telefonnummer und Qualifikationen über den persönlichen, sieben Tage gültigen Link, laden bis zu fünf Bescheinigungsfotos hoch und vergeben ihr eigenes Passwort. Fotos werden auf dem Server neu codiert, von Metadaten bereinigt und vor dem Speichern auf Schadsoftware geprüft. Bis zur Prüfung und Freigabe durch die Verwaltung bleibt das Konto gesperrt. Offene Einladungen können neu ausgestellt werden; dabei wird der alte Link ungültig. Noch nicht verwendete Einladungen lassen sich widerrufen. Wird eine E-Mail nicht bestätigt versandt, zeigt die Verwaltung den Link zur sicheren Weitergabe an.

Bei der Freigabe prüft die Verwaltung die Angaben und Bescheinigungen. Sie wählt mindestens einen aktiven Standort und eine oder mehrere nachgewiesene Qualifikationen aus. Die Mitarbeiter-App zeigt anschließend nur Stationen, deren Standort und erforderliche Qualifikation der Person zugewiesen wurden. Jede Station benötigt dafür in der Verwaltung eine Standort- und Qualifikationszuordnung. Nicht zugeordnete Stationen sind für Mitarbeitende nicht prüfbar.

In der geschützten Verwaltung kann ein Mitarbeiterzugang mit **„Zugang deaktivieren“** umgehend gesperrt werden. Damit werden alle noch aktiven Sitzungen dieses Mitarbeiters widerrufen; die Person kann sich nicht mehr anmelden oder eine Prüfung durchführen. Die vorhandenen und früher unterzeichneten Prüfberichte bleiben unverändert erhalten.

Für eine **Reaktivierung** muss die Verwaltung ein frisches persönliches Passwort (mindestens zwölf Zeichen) vergeben. Das alte Passwort wird nicht wieder gültig. Bei noch aktiven Mitarbeiterkonten steht außerdem **„Passwort zurücksetzen“** zur Verfügung; auch dieser Vorgang beendet alle bestehenden Sitzungen. Persönliche Passwörter gehören nicht in E-Mails oder frei zugängliche Dokumente.

Jede Station kann mit **„Station deaktivieren“** vorübergehend aus dem mobilen Prüfangebot entfernt werden. Dabei ist ein nachvollziehbarer Grund mit mindestens 15 Zeichen erforderlich; Status und verantwortliche Verwaltungskennung werden im **Stilllegungs- und Reaktivierungsverlauf** dokumentiert. Die Stilllegung löscht weder Sicherheitsmängel noch alte Prüfberichte. Mit **„Station reaktivieren“** darf die Verwaltung die Station wieder im Formular verfügbar machen, muss aber einen neuen Grund angeben. **Eine vorhandene Mängelsperre bleibt ausdrücklich bestehen.** Zur tatsächlichen Sicherheitsfreigabe ist weiterhin eine fachliche Nachprüfung und getrennte dokumentierte Freigabe erforderlich.

**Sicherheitsgrenze:** Deaktivierte Stationen dürfen nicht verwendet werden. Auch eine reaktivierte, noch wegen Sicherheitsmängeln gesperrte Station darf trotz Anzeige im Prüfformular nicht benutzt werden. Die administrative Wiederaufnahme ist keine technische Abnahme.

## Automatische Stationssperrung und fachliche Freigabe

Jede als **Mangel** gespeicherte Stationsprüfung sperrt die betroffene Station automatisch in der Datenbank und dokumentiert ein Ereignis mit Bericht, Prüfperson und Beschreibung. Die Sperrung bleibt bestehen, auch wenn ein späterer Prüfbericht für dieselbe Station „in Ordnung“ vermerkt.

Die Verwaltung zeigt gesperrte Stationen deutlich an. Erst nachdem eine fachkundige Person die Station vor Ort nachgeprüft und erforderliche Mängel behoben hat, darf eine autorisierte Verwaltungsperson die Schaltfläche „Nach fachlicher Prüfung freigeben“ verwenden. Die Verwaltung verlangt dabei den Namen der prüfenden Person, eine konkrete Dokumentation der Nachkontrolle und eine abschließende Bestätigung. Die Freigabe wird in einem dauerhaft nachvollziehbaren Ereignisverlauf protokolliert.

**Wichtig:** Die digitale Freigabe ist eine dokumentierte Verwaltungsentscheidung; sie führt selbst keine technische Kontrolle durch. Auch nach Freigabe ist vor einem neuen Programm eine eigenständige vollständige Vorabprüfung erforderlich. Eine gemeldete gesperrte Station darf nicht in Betrieb genommen werden.

## Mängelbenachrichtigung

Jede Sicherheitsmangelmeldung wird dauerhaft in der isolierten Testdatenbank als Mail-Ausgangsvorgang angelegt. Der erste Versand erfolgt unmittelbar nach dem Speichern des Prüfprotokolls, sofern `PRUEF_MANGEL_EMAIL` und die E-Mail-Anbindung korrekt eingerichtet sind. Gespeichert werden der Versandstatus, die Zahl der Versuche und die Zeitpunkte. **„Vom Anbieter angenommen“ bedeutet nicht „beim Empfänger zugestellt“.**

Unter **Stationsprüfungen → Mängelmeldungen – E-Mail-Versand** sieht die berechtigte Verwaltung nicht bestätigte Meldungen. Bei `fehlgeschlagen` oder `nicht_konfiguriert` kann nach ausdrücklicher Kontrolle und Bestätigung ein neuer Versandversuch gestartet werden. Dabei sollte zuvor geprüft werden, ob die Nachricht trotz Fehlermeldung angekommen ist. Wurde sie vom Anbieter bereits angenommen, sperrt das System den Neuversand. Sicherheitsmangel-Mails verwenden für höchstens drei kurzfristige Versuche denselben Anbieter-Idempotenzschlüssel. Bleibt die Anbieterantwort unklar, wird der Vorgang gesperrt und muss vor Ort im Anbieterprotokoll geprüft werden; er wird nicht blind erneut versucht.

**Bei sicherheitsrelevanten Mängeln und jeder ausgefallenen Benachrichtigung:** Verantwortliche Person zusätzlich unmittelbar kontaktieren; der E-Mail-Ausgang ist kein Ersatz für notwendige Gefahrenabwehr. Kleine nicht sicherheitsrelevante Hinweise erzeugen keine Sicherheitsmangel-E-Mail. Nach einer Brevo-Rate-Limit-Antwort (HTTP 429) plant das System genau einen automatischen Wiederholungsversuch etwa zwei Minuten später ein. Netzwerkfehler und unklare Anbieterantworten werden nicht automatisch erneut gesendet.

## Sicherheits- und Datenschutzgrenzen

- Der eigenständige Tablet-Modus mit Gerätetausch/Sperrung ist implementiert. Laut vorgesehenem Betrieb kann nur die Verwaltung das Tablet physisch erreichen und bedienen. Entscheidend ist, diese unzugängliche Anbringung vor Ort tatsächlich sicherzustellen; eine Kiosk-/Einzel-App-Sperre gegen Besucher ist unter dieser Voraussetzung optional. Die physische Installation wurde im Entwicklungsprojekt nicht geprüft.
- Ein eingegebener Vor-Ort-Code beweist die physische Anwesenheit nicht unabhängig. Er dient der zusätzlichen Hürde, ebenso wie die widerrufbare Kopplung des Tablets.
- Fotos sind im privaten Bericht gespeichert; eine gesonderte Aufbewahrungsfrist, Ersetzungs-/Löschregelung, Bildinhaltsprüfung und vollständige Datenschutzinformation fehlen.
- Die Auswahl der verwendeten Stationen liegt bei der prüfenden Fachkraft. Das System kann nicht selbst erkennen, ob eine Station ausgelassen wurde.
- Die automatische Sperrung und eine dokumentierte administrative Freigabe sind umgesetzt. Es gibt noch keine unabhängige digitale Verifikation der fachlichen Nachkontrolle, keine verpflichtende gesonderte Abnahme durch einen qualifizierten Prüfer und keine automatisierte Auftragsverfolgung der Mängelbeseitigung.
- Mitarbeitersitzungen sind vier Stunden gültig. Der Vor-Ort-Code ist einmalig, die Berichtsfreigabe läuft spätestens nach 15 Minuten ab.
- Neue Prüftabellen sowie die Spalten `gesperrt_am`/`sperrgrund` und die Tabellen `brilon_pruef_stationsereignisse` und `brilon_pruef_meldungen` dürfen nur nach Schema-Review und ausdrücklicher Freigabe migriert werden. **Keine produktive Migration**.

## Testumfang

Isolierte PostgreSQL-Tests decken Mitarbeitereinrichtung, Anmeldung, Codeeinlösung, Wiederverwendungsschutz, unvollständige Mängeltexte, Berichtsspeicherung und geschützten Foto-Download ab. Echte Chromium-Tests prüfen die mobile Anmeldung, Codeeingabe, Fotokonvertierung und Berichtsübermittlung bei 360, 390 und 768 Pixeln.

**Vor einem Echtbetrieb:** Eine Testinstallation mit kontrollierten Rollen, Mängel-Mailzustellung in ein Testpostfach, Datenschutzhinweisen, Foto-Löschfrist, Tabletsperre, Stationssperr-/Freigabekonzept und einer fachlichen Sicherheitsabnahme durchführen.
