'use strict';
(() => {
  const $=id=>document.getElementById(id),place=$('place'),price=$('price'),status=$('status'),save=$('save');
  async function api(url,options){const r=await fetch(url,options);const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Anfrage fehlgeschlagen.');return d;}
  function message(text,type=''){status.textContent=text;status.className=type;}
  async function loadSetting(){
    if(!place.value){save.disabled=true;price.value='';return;}
    save.disabled=true;message('Preiseinstellung wird geladen …');
    try{
      const d=await api('/api/spontangruppen/einstellungen?ortId='+encodeURIComponent(place.value));
      price.value=d.preisProPersonCent===null?'':(d.preisProPersonCent/100).toFixed(2).replace('.',',');
      message(d.preisProPersonCent===null?'Für diesen Standort ist noch kein Preis hinterlegt.':'Aktueller Preis: '+new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(d.preisProPersonCent/100));
      save.disabled=false;
    }catch(error){message(error.message,'error');}
  }
  async function init(){
    try{
      const places=await api('/api/spontangruppen/standorte');
      for(const item of places)place.append(new Option(item.name,String(item.id)));
      if(places.length===1)place.value=String(places[0].id);
      await loadSetting();
    }catch(error){message(error.message,'error');}
  }
  place.addEventListener('change',loadSetting);
  save.addEventListener('click',async()=>{
    const numeric=Number(price.value.trim().replace(',','.'));
    if(!place.value||!Number.isFinite(numeric)||numeric<0||numeric>500){message('Bitte einen gültigen Preis von 0 bis 500 Euro eintragen.','error');return;}
    save.disabled=true;message('Preis wird gespeichert …');
    try{
      const result=await api('/api/spontangruppen/einstellungen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ortId:Number(place.value),preisProPerson:numeric})});
      message('Preis je Person dauerhaft gespeichert: '+new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(result.preisProPersonCent/100));
    }catch(error){message(error.message,'error');}
    finally{save.disabled=false;}
  });
  init();
})();