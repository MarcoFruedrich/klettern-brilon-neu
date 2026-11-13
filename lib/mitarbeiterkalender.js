'use strict';

const BERLIN=new Intl.DateTimeFormat('en-GB',{
  timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
});

function berlinParts(date){
  return Object.fromEntries(BERLIN.formatToParts(date)
    .filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)]));
}

function berlinTimeAsDate(year,month,day,hour,minute){
  const wanted=Date.UTC(year,month-1,day,hour,minute,0);
  let candidate=new Date(wanted);
  for(let attempt=0;attempt<3;attempt++){
    const p=berlinParts(candidate);
    const represented=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
    candidate=new Date(candidate.getTime()+wanted-represented);
  }
  return candidate;
}

function nextConfirmationSendAt(now=new Date()){
  const twoHoursLater=new Date(now.getTime()+2*60*60*1000);
  const parts=berlinParts(twoHoursLater);
  if(parts.hour>=18){
    const next=new Date(Date.UTC(parts.year,parts.month-1,parts.day+1));
    return berlinTimeAsDate(next.getUTCFullYear(),next.getUTCMonth()+1,next.getUTCDate(),9,0);
  }
  if(parts.hour<9)return berlinTimeAsDate(parts.year,parts.month,parts.day,9,0);
  return twoHoursLater;
}

module.exports={nextConfirmationSendAt};
