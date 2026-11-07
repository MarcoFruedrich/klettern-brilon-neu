'use strict';
const zone='Europe/Berlin';
const DEFAULT_CONFIRMATION_SETTINGS=Object.freeze({
  verzoegerungMinuten:120,
  ruhebeginn:'18:00',
  ruheende:'09:00'
});
function parts(ms){
  const dt=new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  return Object.fromEntries(dt.formatToParts(new Date(ms)).filter(v=>v.type!=='literal').map(v=>[v.type,Number(v.value)]));
}
function minuteOfDay(p){return p.hour*60+p.minute;}
function parseTime(value,fallback){
  const match=/^(\d{2}):(\d{2})$/.exec(String(value||''));
  if(!match)return fallback;
  const hour=Number(match[1]),minute=Number(match[2]);
  return hour<24&&minute<60?hour*60+minute:fallback;
}
function timeValue(value,fallback){
  if(typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<1440)return value;
  return parseTime(value,fallback);
}
function normalized(settings={}){
  const delay=Number(settings.verzoegerungMinuten??settings.kundenbestaetigungVerzoegerungMinuten);
  const start=timeValue(settings.ruhebeginn??settings.kundenbestaetigungRuhebeginn,parseTime(DEFAULT_CONFIRMATION_SETTINGS.ruhebeginn,0));
  const end=timeValue(settings.ruheende??settings.kundenbestaetigungRuheende,parseTime(DEFAULT_CONFIRMATION_SETTINGS.ruheende,0));
  return {
    verzoegerungMinuten:Number.isInteger(delay)&&delay>=1&&delay<=1440?delay:DEFAULT_CONFIRMATION_SETTINGS.verzoegerungMinuten,
    ruhebeginn:start,ruheende:end
  };
}
function istRuhezeit(ms,start,end){
  if(start===end)return false;
  const minute=minuteOfDay(parts(ms));
  return start<end?minute>=start&&minute<end:minute>=start||minute<end;
}
function berlinZeitpunkt(ms,minute,dayOffset=0){
  const p=parts(ms),date=new Date(Date.UTC(p.year,p.month-1,p.day+dayOffset));
  const naive=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate(),Math.floor(minute/60),minute%60);
  const offsetText=new Intl.DateTimeFormat('en',{timeZone:zone,timeZoneName:'shortOffset'})
    .formatToParts(new Date(naive)).find(x=>x.type==='timeZoneName')?.value||'GMT+1';
  const match=/GMT([+-])(\d{1,2})(?::(\d\d))?/.exec(offsetText);
  const offset=match?(match[1]==='-'?-1:1)*(Number(match[2])*60+Number(match[3]||0)):60;
  return new Date(naive-offset*60000);
}
function nextQuietEnd(ms,start,end){
  const p=parts(ms),minute=minuteOfDay(p);
  const nextDay=start>end&&minute>=start?1:0;
  return berlinZeitpunkt(ms,end,nextDay);
}
function customerConfirmationDue(now=new Date(),settings={}){
  const stamp=new Date(now).getTime();
  if(!Number.isFinite(stamp))throw Error('Ungültiges Datum.');
  const config=normalized(settings);
  if(istRuhezeit(stamp,config.ruhebeginn,config.ruheende))
    return nextQuietEnd(stamp,config.ruhebeginn,config.ruheende);
  const delayed=stamp+config.verzoegerungMinuten*60_000;
  if(istRuhezeit(delayed,config.ruhebeginn,config.ruheende))
    return nextQuietEnd(delayed,config.ruhebeginn,config.ruheende);
  return new Date(delayed);
}
function settingsFromData(data={}){
  return normalized(data);
}
function settingsForAdmin(data={}){
  const s=settingsFromData(data);
  const time=x=>String(Math.floor(x/60)).padStart(2,'0')+':'+String(x%60).padStart(2,'0');
  return {verzoegerungMinuten:s.verzoegerungMinuten,ruhebeginn:time(s.ruhebeginn),ruheende:time(s.ruheende)};
}
module.exports={customerConfirmationDue,parts,settingsFromData,settingsForAdmin,DEFAULT_CONFIRMATION_SETTINGS};
