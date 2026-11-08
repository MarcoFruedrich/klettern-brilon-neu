# Kostenloser Bild-Upload im geschützten Verwaltungsbereich

Die Umschaltung `IMAGE_UPLOAD_SECURITY_MODE=sanitized_images` ermöglicht ausschließlich für die beiden bestehenden authentifizierten Admin-Endpunkte (Programm- und Aktionsbilder) das Speichern ohne einen separaten ClamAV-Dienst.

**Sicherheitskonzept:**
- Administratorsitzung, CSRF-Prüfung und Same-Origin-Schutz bleiben bestehen.
- Nur JPG, PNG, WebP; harte 5-MB-Grenze und maximal 40 Mio. Bildpunkte.
- Bild wird mit sharp vollständig decodiert, in dasselbe Format neu encodiert, neu validiert; EXIF und sonstige Zusatzmetadaten werden nicht übernommen.
- Zufälliger Bilddateiname und Upload zu Supabase statt lokaler flüchtiger Render-Dateien.
- Benutzer-Uploads außerhalb dieser Admin-Routen bleiben unverändert.
- Der Standardmodus `clamav_required` bleibt beim Fehlen der Variable bestehen.

**Einschränkung:** Das erneute Codieren ist kein vollständiger Malware-Scan. Insbesondere Parser-Schwachstellen oder in Bildinhalten versteckte Informationen können damit nicht ausgeschlossen werden. Nur vertrauenswürdige Administratoren dürfen hochladen. Verwende aktuelle Sharp-Versionen.

**Testplan:** Render deploy erfolgreich, Programm-Bild-Upload (gültiges JPG/PNG) und Aktions-Bild-Upload, ungültige Dateien und übergroße Bilder werden zurückgewiesen, gespeicherte Bilder erscheinen im Adminbereich. Keine Testdaten in produktiven Buchungen verändern.

Falls später ein ClamAV-Dienst bereitsteht, die Umgebungsvariable löschen oder auf `clamav_required` ändern, um Virenprüfung wieder verpflichtend zu machen.
