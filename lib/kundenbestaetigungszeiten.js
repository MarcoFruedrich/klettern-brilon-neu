'use strict';
const zone='Europe/Berlin';
function parts(ms){
  const dt=new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  return Object.fromEntries(dt.formatToParts(new Date(ms)).filter(v=>v.type!=='literal').map(v=>[v.type,Number(v.value)]));
}
function nextMorningNine(ms){
  const p=parts(ms),day=new Date(Date.UTC(p.year,p.month-1,p.day+1));
  const estimate=Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate(),9);
  const tz=new Intl.DateTimeFormat('en',{timeZone:zone,timeZoneName:'shortOffset'})
    .formatToParts(new Date(estimate)).find(x=>x.type==='timeZoneName')?.value||'GMT+1';
  const match=/GMT([+-])(\d{1,2})(?::(\d\d))?/.exec(tz);
  const offset=match?(match[1]==='-'?-1:1)*(Number(match[2])*60+Number(match[3]||0)):60;
  return new Date(estimate-offset*60000);
}
function customerConfirmationDue(now=new Date()){
  const stamp=new Date(now).getTime();
  if(!Number.isFinite(stamp))throw Error('Ungültiges Datum.');
  const p=parts(stamp);
  if(p.hour>=18||p.hour<8)return nextMorningNine(stamp);
  const twoHours=stamp+2*60*60*1000;
  const later=parts(twoHours);
  if(later.hour>=18||later.hour<9)return nextMorningNine(stamp);
  return new Date(twoHours);
}
module.exports={customerConfirmationDue,parts};
