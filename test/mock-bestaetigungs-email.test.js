'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createBuchungsbestaetigungsMailer}=require('../lib/buchungsbestaetigungs-email');
const {Pool}=require('../test-support/mocks/pg');

test('PostgreSQL-Double reserviert und protokolliert Buchungsbestätigungen wie die Live-Datenbank',async()=>{
  const previous=process.env.MOCK_PG;
  process.env.MOCK_PG='1';
  try{
    const pool=new Pool(),id=crypto.randomUUID();
    pool.bookings.push({id,status:'bestaetigt',data:{email:'kunde@example.test'}});
    let sent=0;
    const send=createBuchungsbestaetigungsMailer({pool,sendEmail:async()=>{sent++;}});
    const a=await send({buchungId:id,email:'kunde@example.test',betreff:'Test',text:'Test'});
    assert.equal(a.status,'angenommen');
    assert.equal(pool.bookings[0].data.bestaetigungsEmail.status,'angenommen');
    assert.equal(pool.bookings[0].data.bestaetigungsEmail.versuch,a.versuch);
    const b=await send({buchungId:id,email:'kunde@example.test',betreff:'Test',text:'Test'});
    assert.equal(b.status,'bereits_angenommen');
    assert.equal(sent,1,'Angenommene E-Mail darf nicht erneut versandt werden');
  }finally{
    if(previous===undefined)delete process.env.MOCK_PG;
    else process.env.MOCK_PG=previous;
  }
});

test('PostgreSQL-Double blockiert parallelen Kundenmailversand',async()=>{
  const previous=process.env.MOCK_PG;
  process.env.MOCK_PG='1';
  try{
    const pool=new Pool(),id=crypto.randomUUID();
    pool.bookings.push({id,status:'bestaetigt',data:{}});
    let release,started;
    const pending=new Promise(resolve=>release=resolve);
    const begun=new Promise(resolve=>started=resolve);
    let sent=0;
    const send=createBuchungsbestaetigungsMailer({pool,sendEmail:async()=>{sent++;started();await pending;}});
    const first=send({buchungId:id,email:'kunde@example.test',betreff:'Test',text:'Test'});
    await begun;
    const second=await send({buchungId:id,email:'kunde@example.test',betreff:'Test',text:'Test'});
    assert.equal(second.blockiert,true);
    assert.equal(sent,1);
    release();
    assert.equal((await first).status,'angenommen');
  }finally{
    if(previous===undefined)delete process.env.MOCK_PG;
    else process.env.MOCK_PG=previous;
  }
});
