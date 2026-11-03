'use strict';

const BREVO_ENDPOINT='https://api.brevo.com/v3/smtp/email';
const MAX_ATTEMPTS=3;
const TIMEOUT_MS=8000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createBrevoMailer({fetchImpl=globalThis.fetch,env=process.env,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  return async function brevoMail(empfaenger,betreff,inhalt,options={}){
    if(!env.BREVO_API_KEY||!env.BREVO_SENDER_EMAIL)
      throw new Error('E-Mail-Versand ist nicht konfiguriert.');
    if(typeof fetchImpl!=='function')
      throw new Error('E-Mail-Versand ist nicht verfügbar.');
    const idempotencyKey=options?.idempotencyKey;
    if(idempotencyKey!==undefined&&(!UUID.test(idempotencyKey)))
      throw new Error('Ungültiger E-Mail-Idempotenzschlüssel.');
    const body={
      sender:{name:'Klettern & Abenteuer Brilon',email:env.BREVO_SENDER_EMAIL},
      to:[{email:empfaenger}],
      subject:betreff,
      textContent:inhalt
    };
    if(idempotencyKey)body.headers={IdempotencyKey:idempotencyKey};

    for(let attempt=1;attempt<=MAX_ATTEMPTS;attempt++){
      let antwort;
      try{
        antwort=await fetchImpl(BREVO_ENDPOINT,{
          method:'POST',
          headers:{accept:'application/json','content-type':'application/json','api-key':env.BREVO_API_KEY},
          body:JSON.stringify(body),signal:AbortSignal.timeout(TIMEOUT_MS)
        });
      }catch{
        // Without a provider key a network error may follow an accepted send.
        // Keep ordinary mail calls single-shot to avoid introducing duplicates.
        if(!idempotencyKey||attempt===MAX_ATTEMPTS){
          const error=new Error('Brevo-Verbindungsstatus ist ungeklärt.');
          error.uncertain=true;throw error;
        }
        await sleep(200*attempt);
        continue;
      }
      if(antwort.ok)return;
      const text=await antwort.text().catch(()=> '');
      if(idempotencyKey&&antwort.status===400&&/duplicate_parameter/i.test(text))return;
      const retrybar=Boolean(idempotencyKey)&&(antwort.status===408||antwort.status===429||antwort.status>=500);
      if(!retrybar)throw new Error('Brevo HTTP '+antwort.status+': '+text);
      if(attempt===MAX_ATTEMPTS){
        const error=new Error('Brevo HTTP '+antwort.status+' nach drei Versuchen.');
        error.uncertain=antwort.status===408||antwort.status>=500;throw error;
      }
      await sleep(200*attempt);
    }
  };
}

module.exports={createBrevoMailer};
