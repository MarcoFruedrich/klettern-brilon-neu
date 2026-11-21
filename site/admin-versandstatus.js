'use strict';
/*
 * Statusquelle: persistierte E-Mail-Warteschlange und Buchungsversandprotokolle.
 * Die Kalenderfarbe und der Buchungsstatus sagen nichts über den E-Mail-Versand aus.
 * "Angenommen" ist keine bestätigte Zustellung beim Empfänger.
 */
(function(root){
  const fmt=value=>{
    if(!value)return '';
    const date=new Date(value);
    return Number.isFinite(date.getTime())?date.toLocaleString('de-DE'):'';
  };
  function auswerten(row,now=Date.now()){
    const data=row?.data||row||{};
    const q=row?.kundenmail||null;
    const partner=data.partnerhausAbwicklung===true;
    const empfaenger=partner?'Netzwerkpartner':'Kunde';
    const start='Nach vollständiger Mitarbeiterzusage wird die Benachrichtigung nach dem eingestellten Zeitfenster automatisch ausgelöst.';
    const geplant=fmt(q?.faellig_ab);
    const gesendet=fmt(q?.versendet_am);
    const fehler=q?.fehler?String(q.fehler):'';
    const partnerProtokoll=data.partnerhausWeiterleitung||{};
    const bestaetigungsProtokoll=data.bestaetigungsEmail||{};
    const zahlungsProtokoll=data.zahlungsinfoVersand||{};
    const zahlungGesendet=fmt(row?.zahlungsinfo_gesendet_am);
    const suffix='Vom E-Mail-Anbieter angenommen; Zustellung ins Postfach nicht nachgewiesen.';
    const base={empfaenger,automatisch:Boolean(q?.anlass_mitarbeiter_id),
      geplant,status:q?.status||'nicht_geplant',gesendet:gesendet||null,
      fehler:fehler||null,hinweis:start,detail:'',tone:'neutral'};
    if(q?.status==='geplant'){
      const ueberfaellig=Number.isFinite(new Date(q.faellig_ab).getTime())&&now-new Date(q.faellig_ab).getTime()>60_000;
      return {...base,tone:ueberfaellig?'warning':'neutral',
        hinweis:ueberfaellig?'Automatischer Versand überfällig – bitte in der Verwaltung prüfen.':
          'Automatischer Versand nach Mitarbeiterzusage geplant.',
        detail:geplant?'Vorgesehener Versand: '+geplant+'.':''};
    }
    if(q?.status==='versand_laeuft')return {...base,tone:'warning',
      hinweis:'Automatischer Versand wird verarbeitet. Falls er nicht abgeschlossen wird, Anbieterprotokoll prüfen.',
      detail:geplant?'Fällig ab: '+geplant+'.':''};
    if(q?.status==='gesendet'){
      const art=partner?'Partnerinformation':
        bestaetigungsProtokoll.status==='angenommen'?'verbindliche Buchungsbestätigung':
        (zahlungGesendet||zahlungsProtokoll.status==='angenommen')?'Zahlungsinformationen':'Kundeninformation';
      return {...base,tone:'success',
        hinweis:'Automatische '+art+' nach Mitarbeiterzusage vom Anbieter angenommen.',
        detail:(gesendet?'Annahme am '+gesendet+'. ':'')+suffix};
    }
    if(q?.status==='fehler'||q?.status==='abgebrochen'){
      return {...base,tone:'warning',
        hinweis:q.status==='fehler'?'Automatischer Versand fehlgeschlagen.':
          'Automatischer Versand gestoppt oder nicht mehr zulässig.',
        detail:(geplant?'Geplant für '+geplant+'. ':'')+(fehler?'Grund: '+fehler:'Versandstatus in der Verwaltung prüfen.')};
    }
    // Historische oder manuell versandte Nachrichten ohne Warteschlangeneintrag:
    // nie als automatischen Versand kennzeichnen.
    if(partner&&partnerProtokoll.status==='angenommen'){
      return {...base,status:'protokolliert',tone:'success',
        hinweis:'Partnerinformation vom E-Mail-Anbieter angenommen (Versandart nicht eindeutig erfasst).',
        detail:(fmt(partnerProtokoll.angenommenAm)?'Annahme am '+fmt(partnerProtokoll.angenommenAm)+'. ':'')+suffix};
    }
    if(zahlungGesendet){
      return {...base,status:'protokolliert',tone:'success',
        hinweis:'Zahlungsinformationen vom E-Mail-Anbieter angenommen (Versandart nicht eindeutig erfasst).',
        detail:'Annahme am '+zahlungGesendet+'. '+suffix};
    }
    if(bestaetigungsProtokoll.status==='angenommen'){
      return {...base,status:'protokolliert',tone:'success',
        hinweis:'Buchungsbestätigung vom E-Mail-Anbieter angenommen (Versandart nicht eindeutig erfasst).',
        detail:(fmt(bestaetigungsProtokoll.angenommenAm)?
          'Annahme am '+fmt(bestaetigungsProtokoll.angenommenAm)+'. ':'')+suffix};
    }
    return base;
  }
  const service={auswerten};
  if(typeof module==='object'&&module.exports)module.exports=service;
  if(root)root.KletternAdminVersandstatus=service;
})(typeof globalThis==='object'?globalThis:null);
