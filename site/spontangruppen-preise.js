'use strict';
(() => {
  const prefix=document.getElementById('spontan-preis-editor')?'spontan-preis-':'';
  const $=id=>document.getElementById(prefix+id),place=$('place'),price=$('price'),partner=$('partner'),
    deductionType=$('deduction-type'),deductionValue=$('deduction-value'),status=$('status'),save=$('save');
  if(!place||!price||!partner||!deductionType||!deductionValue||!status||!save)return;
  let csrfToken=null;
  async function csrfLaden(force=false){
    if(csrfToken&&!force)return csrfToken;
    const r=await fetch('/api/admin/csrf',{credentials:'same-origin',cache:'no-store'});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||typeof d.csrfToken!=='string')throw new Error(d.error||'Admin-Sitzung oder Sicherheitstoken nicht verfügbar. Bitte erneut anmelden.');
    csrfToken=d.csrfToken;
    return csrfToken;
  }
  async function api(url,options={}){
    const method=(options.method||'GET').toUpperCase();
    const mutation=!['GET','HEAD','OPTIONS'].includes(method);
    const headers=new Headers(options.headers||{});
    if(mutation)headers.set('X-CSRF-Token',await csrfLaden());
    const request=()=>fetch(url,{...options,headers,credentials:'same-origin'});
    let r=await request();
    let d=await r.json().catch(()=>({}));
    if(mutation&&r.status===403&&d.error==='CSRF-Prüfung fehlgeschlagen. Bitte Verwaltung neu laden.'){
      headers.set('X-CSRF-Token',await csrfLaden(true));
      r=await request();
      d=await r.json().catch(()=>({}));
    }
    if(!r.ok)throw new Error(d.error||'Anfrage fehlgeschlagen.');
    return d;
  }
  function message(text,type=''){status.textContent=text;status.className=type;}
  async function loadPartners(selected=''){
    partner.replaceChildren(new Option('Partner auswählen …',''));
    if(!place.value)return;
    const list=await api('/api/spontangruppen/partner?ortId='+encodeURIComponent(place.value));
    for(const item of list)partner.append(new Option((item.unternehmen||item.ansprechpartner)+' · '+item.email,String(item.id)));
    if(selected&&[...partner.options].some(option=>option.value===selected))partner.value=selected;
  }
  async function loadSetting(){
    if(!place.value){save.disabled=true;price.value='';partner.replaceChildren(new Option('Partner auswählen …',''));return;}
    save.disabled=true;message('Einstellungen werden geladen …');
    try{
      const d=await api('/api/spontangruppen/einstellungen?ortId='+encodeURIComponent(place.value));
      price.value=d.preisProPersonCent===null?'':(d.preisProPersonCent/100).toFixed(2).replace('.',',');
      deductionType.value=d.abzugTyp||'prozent';deductionValue.value=String(d.abzugWert??'').replace('.',',');
      await loadPartners(d.netzwerkpartnerId||'');
      message('Preis, Netzwerkpartner und Partnerabzug geladen. Änderungen werden dauerhaft gespeichert.');
      save.disabled=false;
    }catch(error){message(error.message,'error');}
  }
  let initialisiert=false;
  async function init(){
    if(initialisiert)return;
    initialisiert=true;
    try{
      await csrfLaden();
      const places=await api('/api/spontangruppen/standorte');
      for(const item of places)place.append(new Option(item.name,String(item.id)));
      if(places.length===1)place.value=String(places[0].id);
      await loadSetting();
    }catch(error){initialisiert=false;message(error.message,'error');}
  }
  place.addEventListener('change',loadSetting);
  save.addEventListener('click',async()=>{
    const numeric=Number(price.value.trim().replace(',','.'));
    const cut=Number(deductionValue.value.trim().replace(',','.'));
    if(!place.value||!Number.isFinite(numeric)||numeric<=0||numeric>500||!partner.value||
      !Number.isFinite(cut)||cut<0||cut>5000||(deductionType.value==='prozent'&&cut>100)){
      message('Bitte Preis, Netzwerkpartner und gültige Abzugsvereinbarung eintragen.','error');return;
    }
    save.disabled=true;message('Einstellungen werden gespeichert …');
    try{
      const result=await api('/api/spontangruppen/einstellungen',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ortId:Number(place.value),preisProPerson:numeric,netzwerkpartnerId:partner.value,
          abzugTyp:deductionType.value,abzugWert:cut})});
      message('Dauerhaft gespeichert. Preis je Person: '+new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(result.preisProPersonCent/100));
    }catch(error){message(error.message,'error');}
    finally{save.disabled=false;}
  });
  if(prefix){
    document.querySelector('a[href="#spontangruppen-preis-section"]')?.addEventListener('click',init);
    if(location.hash==='#spontangruppen-preis-section')init();
    window.addEventListener('hashchange',()=>{if(location.hash==='#spontangruppen-preis-section')init();});
  }else init();
})();
