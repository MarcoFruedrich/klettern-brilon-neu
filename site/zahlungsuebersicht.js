'use strict';
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BuchungsZahlungen=api;
})(globalThis,function(){
  function summiere(buchungen){
    const eintraege=(Array.isArray(buchungen)?buchungen:[]).map(buchung=>{
      const data=buchung?.data&&typeof buchung.data==='object'?buchung.data:{};
      const gesamtpreisCent=typeof data.gesamtpreis==='number'&&Number.isFinite(data.gesamtpreis)&&data.gesamtpreis>=0
        ?Math.round(data.gesamtpreis*100):null;
      const zahlungen=Array.isArray(data.zahlungen)?data.zahlungen:[];
      const gueltigeZahlungen=zahlungen.filter(z=>Number.isSafeInteger(z?.betragCent)&&z.betragCent>0);
      const eingegangenCent=gueltigeZahlungen.reduce((summe,z)=>summe+z.betragCent,0);
      const status=String(buchung?.status||'offen');
      const abgeschlossen=['storniert','abgelehnt'].includes(status);
      const offenCent=gesamtpreisCent===null||abgeschlossen?0:Math.max(0,gesamtpreisCent-eingegangenCent);
      const gutschriftCent=Number.isSafeInteger(data.zahlungsgutschriftCent)&&data.zahlungsgutschriftCent>0
        ?data.zahlungsgutschriftCent:Math.max(0,eingegangenCent-(gesamtpreisCent??eingegangenCent));
      return {id:buchung?.id||'',status,buchungsnummer:data.buchungsnummer||buchung?.buchungsnummer||'',
        name:data.name||'Unbekannt',angebot:data.angebot||'Programm unbekannt',datum:data.datum||'',
        gesamtpreisCent,eingegangenCent,offenCent,gutschriftCent,zahlungen:gueltigeZahlungen};
    });
    return {
      eintraege,
      eingegangenCent:eintraege.reduce((summe,e)=>summe+e.eingegangenCent,0),
      offenCent:eintraege.reduce((summe,e)=>summe+e.offenCent,0),
      gutschriftCent:eintraege.reduce((summe,e)=>summe+e.gutschriftCent,0),
      zahlungseingaenge:eintraege.reduce((summe,e)=>summe+e.zahlungen.length,0)
    };
  }
  return {summiere};
});
