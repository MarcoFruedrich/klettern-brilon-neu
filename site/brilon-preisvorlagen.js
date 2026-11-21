/* Brilon-Preisvorlagen, vom Betreiber am 21.11.2026 vorgegeben.
   Vorschau nur; Datenbankänderung ausschließlich nach explizitem
   Speichern im bestehenden Programmformular. */
(function(){
 'use strict';
 const stufen=(items)=>items.map(([min,max,preis,dauer])=>({min,max,preis,dauer}));
 const regel=[ [5,10,165,180],[5,10,220,240],[11,15,225,180],[11,15,300,240] ];
 const presets={
  geburtstag3:{gruppe:'Kindergeburtstag',name:'Kindergeburtstag – 3 Stunden',stufen:stufen([[5,10,130,180],[11,15,160,180]])},
  geburtstag4:{gruppe:'Kindergeburtstag',name:'Kindergeburtstag – 4 Stunden',stufen:stufen([[5,10,150,240],[11,15,180,240]])},
  standard:{gruppe:'Gemeinsame Preisstaffel',name:'3 und 4 Stunden',stufen:stufen(regel)},
  fuehrerschein:{gruppe:'Sonderfall',name:'Kletterführerschein – nur 4 Stunden',stufen:stufen([[5,10,220,240],[11,15,300,240]])},
  leiter:{gruppe:'Sonderfall',name:'Strickleiter – nur 2 Stunden',stufen:stufen([[5,10,110,120],[11,15,150,120]])}
 };
 function fuerProgramm(name){
  const s=String(name||'').toLocaleLowerCase('de').replace(/[^a-z0-9äöüß]+/g,' ');
  if(/ihr abenteuer|direkt bei ihnen/.test(s))return null;
  if(/kindergeburtstag/.test(s))return /xl|4 stunden|vier stunden/.test(s)?'geburtstag4':'geburtstag3';
  if(/kletterf.hrerschein/.test(s))return 'fuehrerschein';
  if(/strickleiter|steigleiter|seilleiter/.test(s))return 'leiter';
  if(/kletter olympiade|team am seil|abseilabenteuer|klettern top rope|klettern toprope/.test(s))return 'standard';
  return null;
 }
 function get(name){
  const key=fuerProgramm(name);
  return key?{key,...presets[key],stufen:presets[key].stufen.map(v=>({...v}))}:null;
 }
 window.BrilonPreisvorlagen=Object.freeze({get,fuerProgramm,stufen,presets});
})();
