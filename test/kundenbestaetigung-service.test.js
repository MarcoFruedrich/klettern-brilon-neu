'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createKundenbestaetigungService}=require('../lib/kundenbestaetigung-service');

test('Terminannahme sendet Kundenbestätigung und Anzahlungsinformationen gemeinsam',async()=>{
  const mails=[],updates=[];
  let itemAvailable=true;
  const booking={buchung_id:'booking-1',buchungsstatus:'offen',data:{
    email:'kunde@example.test',name:'Max Muster',vorname:'Max',angebot:'Kistenklettern',
    datum:'2026-11-08',uhrzeit:'12:00',buchungsnummer:'MUSTER-MAX-081126',
    buchungsmodus:'gruppe',gesamtpreis:100,anzahlung:25,restbetrag:75
  }};
  const pool={
    async query(sql,params=[]){
      if(sql.includes('SELECT data FROM brilon_rechnungsdaten'))
        return {rows:[{data:{bankname:'Testbank',iban:'DE00123456780000000000'}}],rowCount:1};
      if(sql.includes("UPDATE brilon_kundenbestaetigungen SET status='gesendet'")){
        updates.push({kind:'confirmation',params});return {rows:[],rowCount:1};
      }
      if(sql.includes("UPDATE brilon_buchungen SET status='bestaetigt'")){
        updates.push({kind:'booking',params});return {rows:[],rowCount:1};
      }
      throw new Error('SQL im Test nicht erwartet: '+sql);
    },
    async connect(){
      return {
        async query(sql,params=[]){
          if(/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql))return {rows:[],rowCount:0};
          if(sql.includes('SELECT q.buchung_id,b.data,b.status AS buchungsstatus')){
            if(itemAvailable){itemAvailable=false;return {rows:[booking],rowCount:1};}
            return {rows:[],rowCount:0};
          }
          if(sql.includes('COUNT(*) FILTER (WHERE status=\'eingeteilt\')'))
            return {rows:[{offen:0,bestaetigt:1}],rowCount:1};
          if(sql.includes("UPDATE brilon_kundenbestaetigungen")&&sql.includes("status='versand_laeuft'"))
            return {rows:[],rowCount:1};
          throw new Error('SQL im Test nicht erwartet: '+sql);
        },
        release(){}
      };
    }
  };
  const service=createKundenbestaetigungService({pool,brevoMail:async(...args)=>mails.push(args)});
  await service.processQueue();
  assert.equal(mails.length,1);
  assert.equal(mails[0][0],'kunde@example.test');
  assert.match(mails[0][1],/Bestätigung eures Termins/);
  assert.match(mails[0][2],/Termin.*Kistenklettern.*2026-11-08.*12:00/s);
  assert.match(mails[0][2],/Gesamtpreis: 100,00 €/);
  assert.match(mails[0][2],/Anzahlung \(25 %\), jetzt fällig: 25,00 €/);
  assert.match(mails[0][2],/Restbetrag am Veranstaltungstag: 75,00 €/);
  assert.match(mails[0][2],/IBAN: DE00123456780000000000/);
  assert.match(mails[0][2],/Verwendungszweck: MUSTER-MAX-081126/);
  const bookingUpdate=updates.find(item=>item.kind==='booking');
  assert.ok(bookingUpdate);
  assert.equal(bookingUpdate.params[1],true,'Versand der Zahlungsinformationen wird mit der Bestätigung protokolliert.');
});
