'use strict';

const brevoEndpoint='https://api.brevo.com/v3/smtp/email';

if(process.env.MOCK_BREVO_EMAILS==='1'){
  globalThis.fetch=async(url,options={})=>{
    if(url!==brevoEndpoint)throw new Error('Testmodus blockierte einen externen Netzwerkaufruf.');
    if(typeof process.send!=='function')throw new Error('Mail-Test-Double benötigt einen IPC-Kanal.');
    process.send({type:'mock-brevo-email',message:JSON.parse(options.body||'{}')});
    return {ok:true,status:202,text:async()=>''};
  };
}
