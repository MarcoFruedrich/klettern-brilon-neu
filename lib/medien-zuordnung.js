'use strict';

// Eine Bilddatei wird zuerst in Supabase gespeichert und dann mit dem Programm
// bzw. Sonderangebot verknüpft. Keine Erfolgsmeldung ohne bestätigte DB-Zuordnung.
// Ist das Ergebnis der DB-Abfrage unbekannt, darf die Datei nicht gelöscht werden:
// sonst könnte eine bereits gespeicherte Zuordnung auf eine gelöschte Datei zeigen.
async function bildHochladenUndZuordnen({bucket,pfad,bild,contentType,zuordnen,zuordnungPruefen,logger=console}){
  if(!bucket||typeof bucket.upload!=='function'||typeof bucket.remove!=='function'||
    typeof bucket.getPublicUrl!=='function'||typeof zuordnen!=='function')
    throw new TypeError('Bildspeicher und Zuordnungsfunktion sind erforderlich.');
  let upload;
  try{
    upload=await bucket.upload(pfad,bild,{contentType,upsert:false});
  }catch(error){
    logger.error('Bilddatei konnte nicht gespeichert werden:',error?.message||'Uploadverbindung');
    return {status:502,error:'Bild konnte nicht im Bildspeicher gespeichert werden.'};
  }
  if(upload?.error){
    logger.error('Bilddatei konnte nicht gespeichert werden:',upload.error.message||'Speicherfehler');
    return {status:502,error:'Bild konnte nicht im Bildspeicher gespeichert werden.'};
  }
  const url=bucket.getPublicUrl(pfad)?.data?.publicUrl;
  if(typeof url!=='string'||!url.startsWith('https://')){
    // Bei kaputter URL-Antwort keine nicht belegbare Zuordnung durchführen.
    // Kein Löschen bei unbekanntem Speicherzustand.
    logger.error('Bilddatei hochgeladen, aber keine gültige öffentliche Adresse erhalten:',pfad);
    return {status:503,error:'Bild wurde gespeichert, aber die öffentliche Bildadresse konnte nicht bestätigt werden.'};
  }
  let gespeichert;
  try{
    gespeichert=await zuordnen(url);
  }catch(error){
    // Ein unterbrochenes Query kann NACH einem DB-Commit werfen.
    // Mit einem gezielten Read-after-write wird ein bereits erfolgreich
    // gespeichertes Bild dennoch bestätigt, ohne es erneut hochzuladen.
    logger.error('Bildadresse in Datenbank möglicherweise gespeichert; Prüfung nötig:',error?.code||'DB_ERROR');
    if(typeof zuordnungPruefen==='function'){
      try{
        const bestaetigteUrl=await zuordnungPruefen();
        if(bestaetigteUrl===url){
          return {status:200,success:true,bild_url:url,
            hinweis:'Die Bildzuordnung wurde nach einer unterbrochenen Datenbankantwort bestätigt.'};
        }
      }catch(verifyError){
        logger.error('Bildzuordnung nach Verbindungsproblem nicht prüfbar:',verifyError?.code||'DB_ERROR');
      }
    }
    // Bei ungeklärtem Status bleibt die Datei erhalten: automatisches
    // Löschen könnte andernfalls auf ein bereits gespeichertes Bild zeigen.
    return {status:503,unklar:true,
      error:'Bild wurde hochgeladen, aber die Zuordnung konnte nicht bestätigt werden. Bitte Programm neu laden und Bild prüfen, bevor du erneut hochlädst.'};
  }
  if(gespeichert?.rowCount!==1){
    // Hier ist eindeutig bestätigt, dass KEIN Datensatz aktualisiert wurde.
    // Nur dann ist ein Rückgängigmachen des frisch hochgeladenen Objekts sicher.
    try{
      const removed=await bucket.remove([pfad]);
      if(removed?.error)throw removed.error;
    }catch(error){
      logger.error('Nicht zugeordnetes Bild konnte nicht entfernt werden:',error?.message||pfad);
      return {status:503,error:'Das Programm oder Sonderangebot existiert nicht mehr. Die hochgeladene Bilddatei konnte nicht automatisch entfernt werden. Bitte Medienbibliothek prüfen.'};
    }
    return {status:409,error:'Das Programm oder Sonderangebot wurde inzwischen entfernt. Die nicht zugeordnete Bilddatei wurde wieder entfernt.'};
  }
  return {status:200,success:true,bild_url:url};
}

module.exports={bildHochladenUndZuordnen};
