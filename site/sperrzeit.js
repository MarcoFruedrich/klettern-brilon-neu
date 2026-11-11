'use strict';

(function(root,factory){
  const sperrzeitEnthaelt=factory();
  if(typeof module==='object'&&module.exports)module.exports=sperrzeitEnthaelt;
  if(root)root.sperrzeitEnthaelt=sperrzeitEnthaelt;
})(typeof globalThis==='object'?globalThis:null,function(){
  return function sperrzeitEnthaelt(datum,bereiche){
    if(typeof datum!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(datum)||!Array.isArray(bereiche))return false;
    return bereiche.some(bereich=>{
      if(!bereich||typeof bereich.datum!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(bereich.datum))return false;
      const ende=typeof bereich.enddatum==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(bereich.enddatum)
        ?bereich.enddatum:bereich.datum;
      if(datum<bereich.datum||datum>ende)return false;
      const getMinutes=value=>{
        if(typeof value!=='string')return null;
        const match=value.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/);
        return match?Number(match[1])*60+Number(match[2]):null;
      };
      const start=getMinutes(bereich.uhrzeit),finish=getMinutes(bereich.endzeit);
      if(start!==null&&finish!==null&&finish>start){
        // A timed, single-day event occupies only its recorded interval.
        if(bereich.datum===ende)return false;
        // For a multi-day interval, any complete day between its ends is blocked.
        return datum>bereich.datum&&datum<ende;
      }
      return true;
    });
  };
});
