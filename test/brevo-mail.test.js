'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createBrevoMailer}=require('../lib/brevo-mail');

test('E-Mail-Versand baut den erwarteten Textversand und Empfänger auf einem Fetch-Test-Double',async()=>{
  const calls=[];
  const send=createBrevoMailer({
    env:{BREVO_API_KEY:'test-key-never-a-real-secret',BREVO_SENDER_EMAIL:'sender@example.test'},
    fetchImpl:async(...args)=>{calls.push(args);return {ok:true,status:201};}
  });
  await send('kunde@example.test','Buchung bestätigt','Hallo Max');
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'https://api.brevo.com/v3/smtp/email');
  assert.equal(calls[0][1].method,'POST');
  assert.equal(calls[0][1].headers['api-key'],'test-key-never-a-real-secret');
  const message=JSON.parse(calls[0][1].body);
  assert.deepEqual(message.sender,{name:'Klettern & Abenteuer Brilon',email:'sender@example.test'});
  assert.deepEqual(message.to,[{email:'kunde@example.test'}]);
  assert.equal(message.subject,'Buchung bestätigt');
  assert.equal(message.textContent,'Hallo Max');
});

test('Ohne Mailkonfiguration wird kein Netzwerkaufruf gestartet',async()=>{
  let calls=0;
  const send=createBrevoMailer({env:{BREVO_API_KEY:'',BREVO_SENDER_EMAIL:''},fetchImpl:async()=>{calls++;}});
  await assert.rejects(send('kunde@example.test','Test','Text'),/nicht konfiguriert/);
  assert.equal(calls,0);
});

test('Unvollständige Mailkonfiguration wird vor dem Netzwerkaufruf zurückgewiesen',async()=>{
  let calls=0;
  const send=createBrevoMailer({env:{BREVO_API_KEY:'test-key',BREVO_SENDER_EMAIL:''},fetchImpl:async()=>{calls++;}});
  await assert.rejects(send('kunde@example.test','Test','Text'),/nicht konfiguriert/);
  assert.equal(calls,0);
});

test('Ablehnung des Maildienstes wird an den Aufrufer zurückgegeben',async()=>{
  const key='550e8400-e29b-41d4-a716-446655440011';
  let calls=0;
  const send=createBrevoMailer({
    env:{BREVO_API_KEY:'test-key',BREVO_SENDER_EMAIL:'sender@example.test'},
    sleep:async()=>{},
    fetchImpl:async()=>{calls++;return {ok:false,status:429,text:async()=>'Testlimit'};}
  });
  await assert.rejects(send('kunde@example.test','Test','Text',{idempotencyKey:key}),error=>{
    assert.match(error.message,/Brevo HTTP 429 nach drei Versuchen/);
    assert.equal(error.uncertain,false);
    return true;
  });
  assert.equal(calls,3);
});

test('Wiederholungen verwenden denselben Brevo-Idempotenzschlüssel',async()=>{
  const key='550e8400-e29b-41d4-a716-446655440011';
  const calls=[];
  const send=createBrevoMailer({
    env:{BREVO_API_KEY:'test-key',BREVO_SENDER_EMAIL:'sender@example.test'},
    sleep:async()=>{},
    fetchImpl:async(url,options)=>{
      calls.push({url,options});
      return calls.length<3
        ?{ok:false,status:503,text:async()=>'vorübergehend'}
        :{ok:true,status:201};
    }
  });
  await send('sicherheit@example.test','Mangel','Bericht',{idempotencyKey:key});
  assert.equal(calls.length,3);
  for(const call of calls){
    assert.equal(JSON.parse(call.options.body).headers.IdempotencyKey,key);
    assert.equal(call.options.signal instanceof AbortSignal,true);
  }
  assert.equal(calls[0].options.body,calls[1].options.body);
  assert.equal(calls[1].options.body,calls[2].options.body);
});

test('Doppelte Anbieteranfrage mit gleichem Idempotenzschlüssel gilt als bereits angenommen',async()=>{
  const send=createBrevoMailer({
    env:{BREVO_API_KEY:'test-key',BREVO_SENDER_EMAIL:'sender@example.test'},
    fetchImpl:async()=>({ok:false,status:400,text:async()=>'duplicate_parameter'})
  });
  await assert.doesNotReject(send('sicherheit@example.test','Mangel','Bericht',{
    idempotencyKey:'550e8400-e29b-41d4-a716-446655440011'
  }));
});

test('Unklare Netzwerkantwort ohne Idempotenzschlüssel wird nicht automatisch wiederholt',async()=>{
  let calls=0;
  const send=createBrevoMailer({
    env:{BREVO_API_KEY:'test-key',BREVO_SENDER_EMAIL:'sender@example.test'},
    sleep:async()=>{},fetchImpl:async()=>{calls++;throw Error('socket reset');}
  });
  await assert.rejects(send('kunde@example.test','Test','Text'),error=>{
    assert.equal(error.uncertain,true);
    return true;
  });
  assert.equal(calls,1);
});

test('Ungültiger Idempotenzschlüssel wird vor dem Netzwerkaufruf abgelehnt',async()=>{
  let calls=0;
  const send=createBrevoMailer({
    env:{BREVO_API_KEY:'test-key',BREVO_SENDER_EMAIL:'sender@example.test'},
    fetchImpl:async()=>{calls++;return {ok:true};}
  });
  await assert.rejects(send('kunde@example.test','Test','Text',{idempotencyKey:'not-a-uuid'}),/Idempotenzschlüssel/);
  assert.equal(calls,0);
});
