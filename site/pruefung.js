'use strict';
const $=id=>document.getElementById(id);
const text=(tag,content)=>{const node=document.createElement(tag);node.textContent=content;return node;};
async function request(url,options={}){
  const r=await fetch(url,{credentials:'same-origin',...options});
  const data=await r.json();
  if(!r.ok)throw Error(data.error||'Die Anfrage konnte nicht verarbeitet werden.');
  return data;
}
function notice(message){$('pruefung-status').textContent=message;}
function hideForm(){ $('station-inspection').hidden=true; }
async function loadOwnReports(){
  const status=$('staff-reports-status'),target=$('staff-reports-list');
  if(!status||!target)return;
  status.textContent='Verlauf wird geladen …';
  try{
    const reports=await request('/api/pruefung/berichte');
    target.replaceChildren();
    if(!reports.length){status.textContent='Für dieses Konto sind noch keine Prüfprotokolle gespeichert.';return;}
    for(const report of reports){
      const article=text('article','');article.className='booking';
      const date=new Date(report.erstellt_am);
      const dateText=Number.isNaN(date.valueOf())?'Zeitpunkt nicht verfügbar':date.toLocaleString('de-DE');
      article.append(text('h3',report.programm+' · '+dateText));
      const statusText=report.hat_mangel?'Sicherheitsmangel gemeldet – betroffene Station gesperrt':
        report.hat_hinweis?'Hinweis zur Nachprüfung gemeldet':'Kein Mangel gemeldet';
      article.append(text('p','Geplanter Beginn: '+report.beginn+' · '+statusText));
      const list=text('ul','');
      for(const item of report.pruefungen||[]){
        const result=item.zustand==='mangel'?'Sicherheitsmangel':
          item.zustand==='hinweis'?'Hinweis – Nachprüfung vorgemerkt':'In Ordnung';
        const detail=item.beschreibung?' – '+item.beschreibung:'';
        list.append(text('li',(item.station||'Station')+': '+result+detail));
      }
      article.append(list);target.append(article);
    }
    status.textContent='Es werden '+reports.length+' persönliche Prüfprotokolle angezeigt.';
  }catch(error){
    target.replaceChildren();status.textContent='Verlauf konnte nicht geladen werden: '+error.message;
  }
}
const brilonCheckpoints={
 'kletterwand':[['Wandstruktur','Wand auf sichtbare Schäden, Risse und lose Teile prüfen.'],['Griffe und Tritte','Auf lockere, beschädigte oder fehlende Elemente achten.'],['Sicherungspunkte','Vorgesehene Sicherungs- und Umlenkpunkte auf Auffälligkeiten prüfen.'],['Sicherungsmaterial','Seile, Gurte, Karabiner und Sicherungsgeräte nach Vorgaben prüfen.'],['Fallbereich','Fall- und Bewegungsbereich freihalten.']],
 'strickleiter':[['Seile und Sprossen','Auf Abrieb, Risse, Schäden und lose Sprossen prüfen.'],['Befestigungen','Aufhängung und Verbindungspunkte auf sichtbare Schäden prüfen.'],['Sicherungssystem','Sicherungsweg und Ausrüstung nach Vorgaben prüfen.'],['Ein- und Ausstieg','Zugangs- und Bodenbereich freihalten.']],
 'abseilplattform':[['Plattform und Zugang','Trittflächen, Kanten und Zugänge auf Schäden und Rutschgefahr prüfen.'],['Anschlagpunkte','Vorgesehene Anschlag- und Abseilpunkte kontrollieren.'],['Abseilsystem','Seil, Abseilgerät, Karabiner und Gurt prüfen.'],['Zweitsicherung','Zusätzliche unabhängige Sicherung auf korrekte Einrichtung prüfen.'],['Landezone','Abseilweg und Landeplatz freihalten.']],
 'prusikstation':[['Aufhängung','Anschlagpunkte und Befestigungen kontrollieren.'],['Seil und Schlingen','Hauptseil und Prusikschlingen auf Verschleiß prüfen.'],['Knoten und Verbindungen','Knoten und Karabiner auf korrekten Aufbau prüfen.'],['Zusätzliche Sicherung','Vorgesehenes Sicherungssystem prüfen.'],['Bewegungsbereich','Boden- und Bewegungsbereich freihalten.']]
};
function brilonPoints(name){
 const normalized=String(name||'').toLowerCase().replace(/ü/g,'u').replace(/[^a-z]/g,'');
 return Object.entries(brilonCheckpoints).find(([key])=>normalized.includes(key))?.[1]||null;
}
function stationControl(station){
  const fieldset=text('fieldset');
  fieldset.className='booking pruefung-station';fieldset.dataset.id=station.id;
  const legend=text('legend',station.name);fieldset.append(legend);
  if(station.ort||station.qualifikation)
    fieldset.append(text('p','Standort: '+(station.ort||'unbekannt')+
      ' · Qualifikation: '+(station.qualifikation||'nicht angegeben')));
  if(station.gesperrt_am){
    const warning=text('p','STATION GESPERRT – NICHT BENUTZEN. '+
      (station.sperrgrund||'Nachprüfung und schriftliche Freigabe erforderlich.'));
    warning.className='pruefung-gefahr';warning.setAttribute('role','alert');
    fieldset.append(warning);
  }
  const label=text('label');label.className='check';
  const check=document.createElement('input');check.type='checkbox';check.className='pruefung-aktiv';
  label.append(check,text('span','Station wird verwendet'));fieldset.append(label);
  const group=text('div');group.hidden=true;
  const resultLabel=text('label','Prüfergebnis');
  const state=document.createElement('select');state.className='pruefung-zustand';
  state.append(Object.assign(text('option','In Ordnung'),{value:'ok'}),
    Object.assign(text('option','Hinweis / kleiner Mangel – prüfen lassen, keine automatische Sperre'),{value:'hinweis'}),
    Object.assign(text('option','Sicherheitsmangel – Station sofort sperren'),{value:'mangel'}));
  resultLabel.append(state);group.append(resultLabel);
  const classification=text('p','Bei unsicherer Sicherheitseinschätzung immer „Sicherheitsmangel“ wählen. Hinweise dürfen nur nicht sicherheitsrelevante Auffälligkeiten betreffen.');
  classification.className='hint';group.append(classification);
  const defectLabel=text('label','Beschreibung des Hinweises oder Mangels (mindestens zehn Zeichen)');
  const description=document.createElement('textarea');
  description.className='pruefung-beschreibung';
  description.maxLength=2000;description.rows=3;description.hidden=true;
  defectLabel.append(description);group.append(defectLabel);
  const fotoLabel=text('label','Optionales Mängelfoto (Kamera oder Galerie)');
  const foto=document.createElement('input');
  foto.type='file';foto.accept='image/*';foto.className='pruefung-foto';
  foto.setAttribute('capture','environment');
  fotoLabel.append(foto);fotoLabel.hidden=true;group.append(fotoLabel);
  const checkpoints=brilonPoints(station.name);
  if(checkpoints){
    const list=text('div','');list.className='brilon-pruefpunkte';
    list.append(text('h4','Prüfpunkte – Kletterhalle Brilon'));
    for(const [title,instruction] of checkpoints){
      const label=text('label','');label.className='check';
      const select=document.createElement('select');select.className='brilon-pruefpunkt';select.dataset.title=title;select.required=true;
      for(const [value,caption] of [['','Bitte bewerten'],['ok','In Ordnung'],['hinweis','Hinweis / kleiner Mangel'],['mangel','Sicherheitsmangel']]){
        const option=text('option',caption);option.value=value;select.append(option);
      }
      label.append(text('span',title+' – '+instruction),select);list.append(label);
    }
    list.append(text('p','Jeden Prüfpunkt einzeln bewerten. Hinweise und Sicherheitsmängel zusätzlich im Stationsbefund beschreiben.'));
    group.prepend(list);
  }
  fieldset.append(group);
  check.addEventListener('change',()=>{group.hidden=!check.checked;});
  state.addEventListener('change',()=>{
    const defect=state.value!=='ok';
    description.hidden=!defect;description.required=defect;
    fotoLabel.hidden=!defect;
    if(!defect){description.value='';foto.value='';}
  });
  return fieldset;
}
async function fotoAlsJPEG(file){
  if(!file)return null;
  const objectUrl=URL.createObjectURL(file);
  try{
    const picture=new Image();
    await new Promise((resolve,reject)=>{
      picture.onload=resolve;picture.onerror=()=>reject(Error('Bild kann nicht gelesen werden.'));
      picture.src=objectUrl;
    });
    const canvas=document.createElement('canvas');
    const scale=Math.min(1,640/Math.max(picture.naturalWidth,picture.naturalHeight));
    canvas.width=Math.max(1,Math.round(picture.naturalWidth*scale));
    canvas.height=Math.max(1,Math.round(picture.naturalHeight*scale));
    const context=canvas.getContext('2d');
    if(!context)throw Error('Bildverarbeitung ist nicht verfügbar.');
    context.drawImage(picture,0,0,canvas.width,canvas.height);
    const data=canvas.toDataURL('image/jpeg',0.55);
    if(data.length>115000)throw Error('Das Foto ist trotz Verkleinerung zu groß (maximal 80 KB).');
    return data;
  }finally{URL.revokeObjectURL(objectUrl);}
}

async function loadStations(){
  const data=await request('/api/pruefung/stationen');
  $('pruefung-person').textContent=data.mitarbeiter;
  const target=$('pruefung-stationen');target.replaceChildren();
  data.stationen.forEach(s=>target.append(stationControl(s)));
  if(!data.stationen.length)notice('Für deinen Zugang sind noch keine passenden Standorte und Qualifikationen freigegeben. Bitte die Verwaltung informieren.');
  if(data.entsperrtBis&&new Date(data.entsperrtBis)>new Date()){
    $('onsite-unlock').hidden=true;$('station-inspection').hidden=false;
  }
}
async function signedIn(){
  $('staff-login').hidden=true;$('pruefung-workspace').hidden=false;
  await loadOwnReports();
  await loadStations();
}
$('staff-login').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget;
  const submit=form.querySelector('button');submit.disabled=true;
  try{
    await request('/api/pruefung/login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(Object.fromEntries(new FormData(form)))});
    form.reset();await signedIn();notice('Angemeldet. Bitte Vor-Ort-Code vom Tablet eingeben.');
  }catch(e){notice('Anmeldung fehlgeschlagen: '+e.message);}finally{submit.disabled=false;}
});
$('request-tablet-code')?.addEventListener('click',async()=>{
  const button=$('request-tablet-code');button.disabled=true;
  try{
    await request('/api/pruefung/code-anfordern',{method:'POST'});
    notice('Der sechsstellige Code wird für zwei Minuten auf dem gekoppelten Tablet angezeigt.');
  }catch(error){notice('Tablet-Code konnte nicht angezeigt werden: '+error.message);}
  finally{button.disabled=false;}
});
$('onsite-unlock').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget;
  try{
    await request('/api/pruefung/freischalten',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(Object.fromEntries(new FormData(form)))});
    form.reset();form.hidden=true;
    // Aktuelle Sperrungen nochmals abrufen, bevor die Fachkraft Stationen auswählt.
    await loadStations();
    $('station-inspection').hidden=false;
    notice('Prüfformular für diese Programmkontrolle freigeschaltet. Gesperrte Stationen nicht verwenden.');
  }catch(e){notice('Freigabe fehlgeschlagen: '+e.message);}
});
$('station-inspection').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget;
  const selected=Array.from(form.querySelectorAll('.pruefung-station')).filter(e=>
    e.querySelector('.pruefung-aktiv').checked);
  if(!selected.length){notice('Bitte mindestens eine verwendete Station auswählen.');return;}
  for(const station of selected){const points=Array.from(station.querySelectorAll('.brilon-pruefpunkt'));if(points.some(point=>!point.value)){notice('Bitte alle Prüfpunkte der verwendeten Station '+station.querySelector('legend').textContent+' bestätigen.');return;}}
  const submit=form.querySelector('button[type=submit]');submit.disabled=true;
  try{
    if(selected.filter(e=>e.querySelector('.pruefung-foto').files.length).length>3)
      throw Error('Maximal drei Fotos pro Prüfprotokoll möglich.');
    const pruefungen=await Promise.all(selected.map(async e=>({
      stationId:e.dataset.id,zustand:e.querySelector('.pruefung-zustand').value,
      pruefpunkte:Array.from(e.querySelectorAll('.brilon-pruefpunkt')).map(p=>({name:p.dataset.title,zustand:p.value})),
      beschreibung:e.querySelector('.pruefung-beschreibung').value,
      foto:e.querySelector('.pruefung-zustand').value!=='ok'?
        await fotoAlsJPEG(e.querySelector('.pruefung-foto').files[0]):null
    })));
    const data=await request('/api/pruefung/berichte',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({programm:form.elements.programm.value,
        beginn:form.elements.beginn.value,pruefungen})});
    form.reset();hideForm();$('onsite-unlock').hidden=false;
    const gesperrt=(data.gesperrteStationen||[]).map(x=>x.name).join(', ');
    const status=data.hatMangel?'SICHERHEITSMANGEL ERFASST – betroffene Station nicht benutzen.':
      gesperrt?'Prüfung gespeichert, aber weiterhin GESPERRT: '+gesperrt+'.':
      data.hatHinweis?'HINWEIS ERFASST – zur Nachprüfung an die Verwaltung vorgemerkt; keine neue Sperre.':
      'Prüfung ohne gemeldeten Mangel gespeichert.';
    const mail=data.benachrichtigung==='gesendet'?' Mail-Anbieter hat Mängelmeldung angenommen (Zustellung nicht bestätigt).':
      data.benachrichtigung==='fehlgeschlagen'?' ACHTUNG: Mängel-E-Mail fehlgeschlagen! Verantwortliche direkt informieren.':
      data.benachrichtigung==='nicht_konfiguriert'?' ACHTUNG: Mängelpostfach nicht eingerichtet! Verantwortliche direkt informieren.':
      data.benachrichtigung==='versand_ungeklaert'?' ACHTUNG: Versandstatus ungeklärt! Verantwortliche direkt informieren und Verwaltung benachrichtigen.':'';
    notice(status+' Prüfnummer: '+data.id+'.'+mail);
    await loadOwnReports();
  }catch(e){notice('Bericht nicht gespeichert: '+e.message);}
  finally{submit.disabled=false;}
});
$('staff-logout').addEventListener('click',async()=>{
  try{await request('/api/pruefung/abmelden',{method:'POST'});}
  catch(e){notice('Abmeldung fehlgeschlagen: '+e.message);return;}
  $('pruefung-workspace').hidden=true;$('staff-login').hidden=false;
  hideForm();$('onsite-unlock').hidden=false;notice('Abgemeldet.');
});
 $('staff-reports-refresh')?.addEventListener('click',loadOwnReports);
request('/api/pruefung/stationen').then(async data=>{
  $('staff-login').hidden=true;$('pruefung-workspace').hidden=false;
  $('pruefung-person').textContent=data.mitarbeiter;
  await loadOwnReports();
  const target=$('pruefung-stationen');target.replaceChildren();
  data.stationen.forEach(s=>target.append(stationControl(s)));
  if(data.entsperrtBis&&new Date(data.entsperrtBis)>new Date()){
    $('onsite-unlock').hidden=true;$('station-inspection').hidden=false;
  }
}).catch(()=>{});
