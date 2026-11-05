'use strict';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MINIJOB_2026_CENT=60300;
const STATUS=['beworben','eingeteilt','bestaetigt','abgelehnt','abgeschlossen'];
function minutes(data){
  const duration=Number(data?.dauer);
  if(Number.isInteger(duration)&&duration>0&&duration<=1440)return duration;
  const a=String(data?.uhrzeit||''),b=String(data?.endzeit||'');
  if(/^\d\d:\d\d$/.test(a)&&/^\d\d:\d\d$/.test(b)){
    const toMinutes=x=>Number(x.slice(0,2))*60+Number(x.slice(3,5));
    const diff=toMinutes(b)-toMinutes(a);
    if(diff>0&&diff<=1440)return diff;
  }
  return null;
}
function weekBounds(day){
  const d=new Date(day+'T12:00:00Z');
  if(Number.isNaN(d.getTime()))throw Error('Ungültiges Datum.');
  const weekday=(d.getUTCDay()+6)%7;
  d.setUTCDate(d.getUTCDate()-weekday);
  const monday=d.toISOString().slice(0,10);
  d.setUTCDate(d.getUTCDate()+7);
  return [monday,d.toISOString().slice(0,10)];
}
function moneyLimit(contract,year){
  if(contract.minijob_grenze_cent!=null)return Number(contract.minijob_grenze_cent);
  return year===2026?MINIJOB_2026_CENT:null; // Neue Jahre erfordern gepflegte gesetzliche Grenzen.
}
function durationFor(e){
  if(e.status==='abgeschlossen')return Number(e.ist_minuten??e.arbeitsminuten??0);
  return ['eingeteilt','bestaetigt'].includes(e.status)?Number(e.arbeitsminuten||0):0;
}
function calculateLoad(entries,day,excludeBooking){
  const [weekStart,weekEnd]=weekBounds(day);
  let week=0,month=0,year=0,weekWorked=0,monthWorked=0;
  for(const e of entries){
    if(excludeBooking&&e.buchung_id===excludeBooking)continue;
    const date=e.datum;
    const m=durationFor(e);
    if(!date||!m)continue;
    if(date>=weekStart&&date<weekEnd){week+=m;if(e.status==='abgeschlossen')weekWorked+=m;}
    if(date.slice(0,7)===day.slice(0,7)){month+=m;if(e.status==='abgeschlossen')monthWorked+=m;}
    if(date.slice(0,4)===day.slice(0,4))year+=m;
  }
  return {weekMin:week,monthMin:month,yearMin:year,weekWorkedMin:weekWorked,monthWorkedMin:monthWorked};
}
function checkLimits(contract,load,newMinutes,date){
  const problems=[];
  if(!contract||contract.art==='nicht_hinterlegt')problems.push('Beschäftigungsart und Vertragsdaten fehlen.');
  else if(contract.art==='minijob'){
    const rate=Number(contract.stundenlohn_cent||0),limit=moneyLimit(contract,Number(date.slice(0,4)));
    if(!rate)problems.push('Stundenlohn für Minijob fehlt.');
    if(limit==null)problems.push('Minijob-Grenze für dieses Kalenderjahr fehlt.');
    if(rate>0&&limit!=null&&Math.round((load.monthMin+newMinutes)*rate/60)>limit)
      problems.push('Regelmäßige Minijob-Verdienstgrenze für diesen Monat überschritten.');
    if(rate>0&&limit!=null&&Math.round((load.yearMin+newMinutes)*rate/60)>limit*12)
      problems.push('Regelmäßige Minijob-Jahresgrenze überschritten.');
  }else if(['teilzeit','vollzeit'].includes(contract.art)){
    if(!Number(contract.wochenstunden)&&!Number(contract.monatsstunden))
      problems.push('Vertragliche Wochen- oder Monatsstunden fehlen.');
    if(Number(contract.wochenstunden)&&load.weekMin+newMinutes>Number(contract.wochenstunden)*60)
      problems.push('Vereinbarte Wochenstunden werden überschritten.');
    if(Number(contract.monatsstunden)&&load.monthMin+newMinutes>Number(contract.monatsstunden)*60)
      problems.push('Vereinbarte Monatsstunden werden überschritten.');
  }
  return problems;
}
module.exports={UUID,STATUS,minutes,weekBounds,moneyLimit,durationFor,calculateLoad,checkLimits};
