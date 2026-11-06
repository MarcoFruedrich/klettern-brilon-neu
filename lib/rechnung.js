'use strict';

function escapeHtmlPdf(value){
  const map={'€':0x80,'‚':0x82,'ƒ':0x83,'„':0x84,'…':0x85,'†':0x86,'‡':0x87,'ˆ':0x88,'‰':0x89,'Š':0x8a,'‹':0x8b,'Œ':0x8c,'Ž':0x8e,'‘':0x91,'’':0x92,'“':0x93,'”':0x94,'•':0x95,'–':0x96,'—':0x97,'˜':0x98,'™':0x99,'š':0x9a,'›':0x9b,'œ':0x9c,'ž':0x9e,'Ÿ':0x9f};
  return Array.from(String(value??'')).map(ch=>{
    const code=map[ch]??ch.codePointAt(0);
    return code<=255?code.toString(16).padStart(2,'0').toUpperCase():'3F';
  }).join('');
}
function euro(cents){return (Number(cents||0)/100).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';}
function invoiceLines(invoice){
  const issuer=invoice.aussteller||{},customer=invoice.kunde||{},booking=invoice.buchung||{};
  const lines=[];
  const add=(text,x=48,y=0,size=10,color='0 0 0')=>lines.push({text:String(text??''),x,y,size,color});
  const wrap=(text,max=92)=>{
    const out=[];let line='';
    for(const word of String(text||'').split(/\s+/)){
      if(line&&line.length+word.length+1>max){out.push(line);line=word;}else line+=(line?' ':'')+word;
    }
    if(line)out.push(line);return out;
  };
  add(issuer.firma||'Klettern & Abenteuer',48,790,18,'0.05 0.29 0.20');
  add(issuer.name,48,772,10);add(issuer.strasse,48,758,10);add(`${issuer.plz||''} ${issuer.ort||''}`.trim(),48,744,10);
  add([issuer.email,issuer.telefon].filter(Boolean).join(' · '),48,730,9);
  add([issuer.steuernummer&&`Steuernummer: ${issuer.steuernummer}`,issuer.ustIdNr&&`USt-IdNr.: ${issuer.ustIdNr}`].filter(Boolean).join(' · '),48,716,9);
  add('RECHNUNG',420,790,16,'0.05 0.29 0.20');
  add(`Rechnungsnummer: ${invoice.nummer}`,350,766,9);add(`Rechnungsdatum: ${invoice.rechnungsdatum}`,350,752,9);
  add(`Leistungsdatum: ${booking.datum||'—'}`,350,738,9);add(`Buchungsnummer: ${booking.buchungsnummer||'—'}`,350,724,9);
  add('RECHNUNG AN',48,681,9,'0.05 0.29 0.20');
  add(customer.firma||customer.name,48,663,11);
  let customerLine=647;
  if(customer.firma&&customer.name){add(customer.name,48,customerLine,10);customerLine-=14;}
  if(customer.strasse||customer.plz||customer.ort){
    add(customer.strasse,48,customerLine,10);
    add(`${customer.plz||''} ${customer.ort||''}`.trim(),48,customerLine-14,10);
  }else{
    if(customer.email)add(`E-Mail: ${customer.email}`,48,customerLine,9);
    if(customer.telefon)add(`Telefon: ${customer.telefon}`,48,customerLine-14,9);
  }
  add('Vielen Dank für Ihre Buchung. Wir berechnen Ihnen folgende Leistung:',48,596,10);
  add('LEISTUNG',48,562,9,'0.05 0.29 0.20');add('MENGE',350,562,9,'0.05 0.29 0.20');add('EINZELPREIS',405,562,9,'0.05 0.29 0.20');add('BETRAG',500,562,9,'0.05 0.29 0.20');
  const quantity=Number(booking.teilnehmer||1), total=Number(invoice.betragCent||0);
  const grundpreis=Number(invoice.grundpreisCent??total);
  const rabattCent=Math.max(0,Number(invoice.rabattCent)||Number(invoice.empfehlungRabattCent)||0);
  add(booking.angebot||'Programm',48,542,10);add(String(quantity),360,542,10);add(euro(quantity?Math.round(grundpreis/quantity):grundpreis),405,542,10);add(euro(grundpreis),500,542,10);
  add(`Standort: ${booking.veranstaltungsort||'—'}`,48,523,9);add(`Termin: ${booking.datum||'—'} · ${booking.uhrzeit||''} Uhr · ${quantity} Teilnehmende`,48,508,9);
  if(rabattCent){
    add(invoice.rabattBezeichnung||'Rabatt',337,489,8,'0.05 0.29 0.20');
    add(`- ${euro(rabattCent)}`,500,489,9,'0.05 0.29 0.20');
  }
  add('GESAMTBETRAG',390,468,11,'0.05 0.29 0.20');add(euro(total),500,468,11,'0.05 0.29 0.20');
  add('ZAHLUNG ERFASST',48,426,11,'0.05 0.29 0.20');add('Vollständig bezahlt',390,426,11,'0.05 0.29 0.20');
  add(`Zahlungsart: ${invoice.zahlungsarten||'—'}`,48,402,9);add(`Zahlungseingang: ${invoice.zahlungseingang||'—'}`,48,386,9);add('Offener Betrag: 0,00 €',48,370,9);
  let y=334;
  for(const text of wrap(`Steuerangabe: ${issuer.steuerhinweis||''}`,100)){add(text,48,y,9);y-=13;}
  y-=5;
  for(const text of wrap(issuer.rechnungshinweis||'',100)){add(text,48,y,9);y-=13;}
  add('KONTAKT / BANKVERBINDUNG',48,247,9,'0.05 0.29 0.20');
  add(issuer.email,48,230,9);add(issuer.telefon,48,216,9);add(issuer.bankname,48,195,9);add(issuer.iban&&`IBAN: ${issuer.iban}`,48,180,9);add(issuer.bic&&`BIC: ${issuer.bic}`,48,165,9);
  if(invoice.empfehlungsWerbetext){
    add('FREUNDE WERBEN FREUNDE',350,380,9,'0.05 0.29 0.20');
    wrap(invoice.empfehlungsWerbetext,42).slice(0,7).forEach((line,index)=>add(line,350,363-index*12,8));
  }
  add('Rechnung wurde automatisch nach Erfassung des vollständigen Zahlungseingangs erstellt.',48,97,8,'0.35 0.38 0.40');
  add('Klettern & Abenteuer',48,48,8,'0.35 0.38 0.40');add(`Rechnung ${invoice.nummer} · Seite 1 von 1`,395,48,8,'0.35 0.38 0.40');
  return lines;
}
function createPdf(invoice){
  const lines=invoiceLines(invoice);
  const commands=['0.88 0.92 0.90 RG 48 700 m 547 700 l S','0.88 0.92 0.90 RG 48 575 m 547 575 l S','0.88 0.92 0.90 RG 48 480 m 547 480 l S'];
  for(const l of lines)commands.push(`${l.color} rg BT /F1 ${l.size} Tf ${l.x} ${l.y} Td <${escapeHtmlPdf(l.text)}> Tj ET`);
  const stream=commands.join('\n');
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(stream,'ascii')} >>\nstream\n${stream}\nendstream`
  ];
  let pdf='%PDF-1.4\n%âãÏÓ\n',offsets=[0];
  objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(pdf,'binary'));pdf+=`${i+1} 0 obj\n${obj}\nendobj\n`;});
  const xref=Buffer.byteLength(pdf,'binary');pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(const off of offsets.slice(1))pdf+=`${String(off).padStart(10,'0')} 00000 n \n`;
  pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf,'binary');
}
function formatDate(value){
  if(!value)return '—';
  const match=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  return match?`${match[3]}.${match[2]}.${match[1]}`:String(value);
}
module.exports={createPdf,formatDate};
