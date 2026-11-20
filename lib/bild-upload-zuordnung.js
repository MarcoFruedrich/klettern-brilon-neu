'use strict';

// Gemeinsamer sicherer Upload für Programm- und Aktionsbilder.
// Die Datei wird erst nach bestätigter Zuordnung als gespeichert gemeldet.
// Scheitert die Datenbank-Aktualisierung, darf niemals eine eventuell bereits
// bestätigte Bildreferenz durch voreiliges Löschen unbrauchbar werden.
async function bildUploadMitZuordnung({bucket,pfad,bild,contentType,zuordnen,zuordnungPruefen,log=console}){
  const hochgeladen=await bucket.upload(pfad,bild,{contentType,upsert:false});
  if(hochgeladen.error){
    log.error('Bild-Upload in Medienbibliothek fehlgeschlagen:',hochgeladen.error.message);
    return {ok:false,status:502,fehler:'Die Bilddatei konnte nicht im Bildspeicher gespeichert werden.'};
  }

  const url=bucket.getPublicUrl(pfad).data.publicUrl;
  let aktualisierung;
  let schreibfehler=null;
  try{
    aktualisierung=await zuordnen(url);
  }catch(error){
    schreibfehler=error;
    log.error('Bildzuordnung in Datenbank fehlgeschlagen:',error.code||error.message);
  }
  if(aktualisierung?.rowCount===1){
    return {ok:true,status:200,bild_url:url};
  }

  // Bei ungeklärtem Datenbankfehler ist nicht sicher, ob das UPDATE
  // vor einem Verbindungsabbruch bereits übernommen wurde.
  // Erst read-after-write versuchen, bevor ein Upload entfernt wird.
  let zugeordneteUrl=null;
  if(schreibfehler){
    try{
      zugeordneteUrl=await zuordnungPruefen();
    }catch(error){
      log.error('Bildzuordnung nach Datenbankabbruch nicht verifizierbar:',error.code||error.message);
      return {ok:false,status:503,
        fehler:'Bild wurde übertragen; ob die Zuordnung gespeichert wurde, ist noch unklar. Bitte Bildzuordnung prüfen, bevor erneut hochgeladen wird.'};
    }
    if(zugeordneteUrl===url){
      return {ok:true,status:200,bild_url:url,
        hinweis:'Die Bildzuordnung wurde nach einer Verbindungsstörung erneut geprüft.'};
    }
  }

  // Nur löschen, wenn keine Referenz übernommen wurde. Bei rowCount=0 hat
  // der UPDATE-Befehl bestätigt, dass der Ziel-Datensatz nicht vorhanden ist.
  try{
    const entfernung=await bucket.remove([pfad]);
    if(entfernung.error)throw entfernung.error;
  }catch(error){
    log.error('Unzugeordneten Bild-Upload nicht entfernbar:',error.message);
    return {ok:false,status:503,
      fehler:'Die Bildzuordnung wurde nicht gespeichert; der nicht zugeordnete Upload konnte nicht bereinigt werden. Bitte Verwaltung prüfen.'};
  }
  return {ok:false,status:aktualisierung?.rowCount===0?404:503,
    fehler:aktualisierung?.rowCount===0
      ?'Programm oder Sonderangebot ist nicht mehr vorhanden. Die hochgeladene Bilddatei wurde entfernt.'
      :'Die Bildzuordnung konnte nicht gespeichert werden. Die hochgeladene Bilddatei wurde entfernt.'};
}

module.exports={bildUploadMitZuordnung};
