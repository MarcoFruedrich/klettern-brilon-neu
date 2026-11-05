'use strict';
const form=document.getElementById('customer-feedback-form');
const status=document.getElementById('customer-feedback-status');
form.addEventListener('submit',async event=>{
  event.preventDefault();const button=form.querySelector('button[type="submit"]');button.disabled=true;
  status.textContent='Feedback wird übermittelt …';
  try{
    const response=await fetch('/api/kundenfeedback',{method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({
        buchungsnummer:form.elements.buchungsnummer.value,
        programmBewertung:form.elements.programmBewertung.value,
        mitarbeiterBewertung:form.elements.mitarbeiterBewertung.value,
        sicherheitsBewertung:form.elements.sicherheitsBewertung.value,
        veraenderungen:form.elements.veraenderungen.value,ideen:form.elements.ideen.value,
        datenschutz:form.elements.datenschutz.checked})});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Feedback konnte nicht gespeichert werden.');
    form.hidden=true;
    status.textContent=result.emailVersand==='gesendet'?
      'Danke für dein Feedback. Eine Kopie wurde an die E-Mail-Adresse deiner Buchung gesendet.':
      'Danke für dein Feedback. Es wurde gespeichert, aber die Bestätigungs-E-Mail konnte gerade nicht versandt werden. Bitte wende dich an info@klettern-abenteuer.de.';
  }catch(error){status.textContent='Feedback konnte nicht gesendet werden: '+error.message;}
  finally{button.disabled=false;}
});
