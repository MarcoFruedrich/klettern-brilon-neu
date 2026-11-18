'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const net=require('node:net');
const path=require('node:path');
const {chromium}=require('playwright');

test('Browser: Hilfetexte an den Verwaltungsbereichen, zugänglich ohne Login-Störung',async t=>{
  const probe=net.createServer();
  await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
  const port=probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),stdio:['ignore','ignore','pipe'],
    env:{...process.env,PORT:String(port),DATABASE_URL:'',RUN_SCHEMA_MIGRATIONS:'false',
      BREVO_API_KEY:'',BREVO_SENDER_EMAIL:'',SUPABASE_URL:'',SUPABASE_SECRET_KEY:''}});
  t.after(()=>child.kill());
  const base='http://127.0.0.1:'+port;
  let ready=false;
  for(let i=0;i<80;i++){
    try{const response=await fetch(base+'/admin.html');if(response.ok){ready=true;break;}}
    catch{}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.ok(ready,'Testserver konnte nicht gestartet werden');
  const browser=await chromium.launch({headless:true});
  t.after(async()=>browser.close());
  const page=await browser.newPage({viewport:{width:390,height:844},locale:'de-DE'});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/admin.html');
  await page.waitForFunction(()=>document.querySelectorAll('.admin-view > h2 .context-help-button').length>=25);
  assert.equal(await page.locator('#login button').count(),1,'Nur Login-Button im Formular');
  assert.ok(await page.locator('.admin-view > h2 .context-help-button').count()>=25);
  const selector='#admin-faq-heading .context-help-button';
  await page.locator(selector).evaluate(button=>{button.focus();button.click();});
  assert.equal(await page.locator(selector).getAttribute('aria-expanded'),'true');
  assert.equal(await page.locator('#admin-faq-heading .context-help-tip').getAttribute('hidden'),null);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator(selector).getAttribute('aria-expanded'),'false');
  assert.equal(await page.locator('#admin-faq-heading .context-help-tip').getAttribute('hidden'),'');
  assert.deepEqual(errors,[]);
  await page.close();
});
