'use strict';
(async function(){
  const summary=document.getElementById('feedback-summary');
  const form=document.getElementById('feedback-form');
  const status=document.getElementById('feedback-status');
  const average=value=>Number(value).toLocaleString('de-DE',{minimumFractionDigits:1,maximumFractionDigits:1});
  try{
    const response=await fetch('/api/feedback/statistik',{headers:{Accept:'application/json'},cache:'no-store'});
    if(!response.ok)throw new Error('Statistik nicht verfügbar');
    const data=await response.json();
    if(data.anzahl<3||!data.mittelwerte){summary.textContent='Die zusammengefasste Statistik wird angezeigt, sobald mindestens drei Rückmeldungen vorliegen.';}
    else summary.textContent=`${data.anzahl} Rückmeldungen · Programm ${average(data.mittelwerte.programm)}/5 · Mitarbeiter ${average(data.mittelwerte.mitarbeiter)}/5 · Sicherheitsgefühl ${average(data.mittelwerte.sicherheit)}/5`;
  }catch{summary.textContent='Die Feedback-Statistik ist im Moment nicht verfügbar.';}
  form?.addEventListener('submit',async event=>{
    event.preventDefault();if(!form.reportValidity())return;
    const button=form.querySelector('button[type="submit"]');button.disabled=true;status.textContent='Feedback wird sicher gespeichert …';
    const fields=new FormData(form);
    try{
      const response=await fetch('/api/feedback',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({kundennummer:fields.get('kundennummer'),programm:fields.get('programm'),
          mitarbeiter:fields.get('mitarbeiter'),sicherheit:fields.get('sicherheit'),
          vorschlaege:fields.get('vorschlaege'),ideen:fields.get('ideen')})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Feedback konnte nicht gespeichert werden.');
      status.textContent=result.message;form.reset();
    }catch(error){status.textContent=error.message;}
    finally{button.disabled=false;}
  });
})();
