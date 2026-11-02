'use strict';

const BREVO_ENDPOINT='https://api.brevo.com/v3/smtp/email';

function createBrevoMailer({fetchImpl=globalThis.fetch,env=process.env}={}){
  return async function brevoMail(empfaenger,betreff,inhalt){
    if(!env.BREVO_API_KEY||!env.BREVO_SENDER_EMAIL)
      throw new Error('E-Mail-Versand ist nicht konfiguriert.');
    if(typeof fetchImpl!=='function')
      throw new Error('E-Mail-Versand ist nicht verfügbar.');

    const antwort=await fetchImpl(BREVO_ENDPOINT,{
      method:'POST',
      headers:{
        accept:'application/json',
        'content-type':'application/json',
        'api-key':env.BREVO_API_KEY
      },
      body:JSON.stringify({
        sender:{name:'Klettern & Abenteuer Brilon',email:env.BREVO_SENDER_EMAIL},
        to:[{email:empfaenger}],
        subject:betreff,
        textContent:inhalt
      })
    });

    if(!antwort.ok){
      throw new Error('Brevo HTTP '+antwort.status+': '+await antwort.text());
    }
  };
}

module.exports={createBrevoMailer};
