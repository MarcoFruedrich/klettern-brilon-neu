'use strict';

// Nur verwendete Medien-Adressen, keine Benutzer- oder Gruppenprofildaten.
function bilderDerBesuchergruppen(rows){
  const urls=new Set();
  for(const row of Array.isArray(rows)?rows:[]){
    if(!Array.isArray(row?.daten))continue;
    for(const gruppe of row.daten){
      if(typeof gruppe?.bild==='string'&&gruppe.bild)urls.add(gruppe.bild);
      if(typeof gruppe?.iconBild==='string'&&gruppe.iconBild)urls.add(gruppe.iconBild);
    }
  }
  return urls;
}
module.exports={bilderDerBesuchergruppen};
