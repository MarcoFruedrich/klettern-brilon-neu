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
      return datum>=bereich.datum&&datum<=ende;
    });
  };
});
