'use strict';
(function(root,factory){
  const generator=typeof module==='object'&&module.exports
    ?require('./vendor/qrcode-generator')
    :root.qrcode;
  const api=factory(generator);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.GPSQrEtiketten=api;
})(globalThis,function(qrcode){
  function svg(text,size=240){
    if(typeof qrcode!=='function')throw new Error('QR-Code-Bibliothek ist nicht geladen.');
    if(typeof text!=='string'||!text.trim()||text.length>2000)throw new RangeError('QR-Code-Inhalt ist ungültig.');
    const code=qrcode(0,'M');
    code.addData(text,'Byte');
    code.make();
    const count=code.getModuleCount(),quiet=4,view=count+quiet*2;
    let path='';
    for(let y=0;y<count;y++)for(let x=0;x<count;x++)if(code.isDark(y,x))
      path+=`M${x+quiet} ${y+quiet}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${view} ${view}" role="img" aria-label="QR-Code" shape-rendering="crispEdges"><rect width="${view}" height="${view}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  }

  function dataUri(text,size=240){
    return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg(text,size));
  }

  return {svg,dataUri};
});
