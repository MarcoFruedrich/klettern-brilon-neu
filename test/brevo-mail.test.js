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
  const send=createBrevoMailer({
    env:{BREVO_API_KEY:'test-key',BREVO_SENDER_EMAIL:'sender@example.test'},
    fetchImpl:async()=>({ok:false,status:429,text:async()=>'Testlimit'})
  });
  await assert.rejects(send('kunde@example.test','Test','Text'),/Brevo HTTP 429: Testlimit/);
});
