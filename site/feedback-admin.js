'use strict';
(function(){
  const find=id=>document.getElementById(id);
  const el=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;return node;};
  const average=(rows,key)=>rows.length?rows.reduce((sum,row)=>sum+Number(row.feedback[key]||0),0)/rows.length:0;
  async function load(){
    if(find('workspace')?.hidden)return;
    const status=find('feedback-admin-status'),list=find('feedback-admin-list'),summary=find('feedback-admin-summary');
    try{
      const rows=await api('/api/admin/feedback');list.replaceChildren();summary.replaceChildren();
      summary.append(el('p',`${rows.length} Rückmeldung(en) · Programm ${average(rows,'programm').toLocaleString('de-DE',{maximumFractionDigits:1})}/5 · Mitarbeiter ${average(rows,'mitarbeiter').toLocaleString('de-DE',{maximumFractionDigits:1})}/5 · Sicherheit ${average(rows,'sicherheit').toLocaleString('de-DE',{maximumFractionDigits:1})}/5`));
      if(!rows.length){list.append(el('p','Noch kein Kundenfeedback eingegangen.'));return;}
      for(const row of rows){
        const card=el('article');card.className='booking';
        const date=new Date(row.feedback.abgegebenAm);const when=Number.isNaN(date.getTime())?'Zeitpunkt unbekannt':date.toLocaleString('de-DE');
        card.append(el('strong',`${row.kundennummer||'Ohne Kundennummer'} · ${row.programm||row.feedback.programmName||'Programm'}`),
          el('p',`${row.name||'Kunde'} · ${row.email||'keine E-Mail'} · ${when}`),
          el('p',`Programm: ${row.feedback.programm}/5 · Mitarbeiter: ${row.feedback.mitarbeiter}/5 · Sicherheitsgefühl: ${row.feedback.sicherheit}/5`),
          el('p','Verbesserungsvorschläge: '+(row.feedback.vorschlaege||'—')),
          el('p','Zusätzliche Ideen: '+(row.feedback.ideen||'—')),
          el('p','Bestätigungs-E-Mail: '+({angenommen:'vom Versanddienst angenommen; Zustellung nicht bestätigt',fehlgeschlagen:'Versand fehlgeschlagen',unklar:'Versandstatus unklar',ausstehend:'noch offen'}[row.feedback.emailVersand]||'Status unbekannt')));
        list.append(card);
      }
      status.textContent='Feedback geladen.';
    }catch(error){status.textContent='Feedback konnte nicht geladen werden: '+error.message;}
  }
  const observer=new MutationObserver(()=>{if(!find('workspace')?.hidden)load();});
  if(find('workspace'))observer.observe(find('workspace'),{attributes:true,attributeFilter:['hidden']});
  find('feedback-admin-section')?.addEventListener('focusin',load);
})();
