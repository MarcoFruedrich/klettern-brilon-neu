'use strict';

const DEFAULT_SITE_URL='https://klettern-brilon-neu.onrender.com';

function escapeHtml(value){
  return String(value).replace(/[&<>"']/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[char]);
}

function siteUrlFrom(env){
  const candidate=String(env.PUBLIC_SITE_URL||env.PUBLIC_BASE_URL||DEFAULT_SITE_URL).trim().replace(/\/+$/,'');
  try{
    const url=new URL(candidate);
    return url.protocol==='https:'?url.origin:DEFAULT_SITE_URL;
  }catch{return DEFAULT_SITE_URL;}
}

function renderTextLine(line){
  const escaped=escapeHtml(line);
  return escaped.replace(/https:\/\/[^\s<]+/g,url=>{
    const href=url.replace(/&amp;/g,'&');
    return `<a href="${escapeHtml(href)}" style="color:#087b50;text-decoration:underline;">${url}</a>`;
  });
}

function renderMessage(text){
  const blocks=String(text||'').replace(/\r\n?/g,'\n').trim().split(/\n\s*\n/);
  return blocks.map(block=>{
    const lines=block.split('\n');
    const rows=lines.map(line=>line.match(/^([^:\n]{1,55}):\s*(.*)$/));
    if(lines.length>1&&rows.every(Boolean)){
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:12px 0 18px;background:#f5f8f6;border:1px solid #dce7e1;border-radius:10px;">${rows.map(row=>`<tr><td valign="top" style="padding:9px 12px;color:#60746b;font-size:14px;border-bottom:1px solid #e5ece8;width:38%;">${escapeHtml(row[1])}</td><td valign="top" style="padding:9px 12px;color:#173f35;font-size:14px;font-weight:600;border-bottom:1px solid #e5ece8;">${renderTextLine(row[2])}</td></tr>`).join('')}</table>`;
    }
    return `<p style="margin:0 0 14px;color:#40554c;font-size:15px;line-height:1.65;">${lines.map(renderTextLine).join('<br>')}</p>`;
  }).join('');
}

function createBrandedEmailHtml(text,{env=process.env}={}){
  const siteUrl=siteUrlFrom(env);
  const logoUrl=`${siteUrl}/logo-klettern-abenteuer-email.png`;
  const safeBody=renderMessage(text);
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Klettern &amp; Abenteuer</title></head>
<body style="margin:0;padding:0;background:#edf2ef;font-family:Arial,Helvetica,sans-serif;color:#173f35;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Gut Seil! Deine Nachricht von Klettern &amp; Abenteuer.</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#edf2ef;"><tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:680px;background:#ffffff;border:1px solid #dce7e1;border-radius:16px;overflow:hidden;">
      <tr><td style="background:#173f35;padding:23px 28px 24px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
          <td width="190" valign="middle" style="padding-right:20px;"><img src="${escapeHtml(logoUrl)}" width="190" alt="Klettern &amp; Abenteuer" style="display:block;width:190px;max-width:100%;height:auto;border:0;"></td>
          <td valign="middle" style="color:#ffffff;font-size:16px;line-height:1.45;font-weight:bold;">Klettern · Natur · Gemeinschaft · Abenteuer<br><span style="font-size:19px;">Hier geht’s hoch. Gemeinsam noch höher.</span></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:28px 30px 18px;">${safeBody}</td></tr>
      <tr><td style="padding:0 30px 26px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="border-top:1px solid #e4ebe7;padding-top:18px;color:#60746b;font-size:14px;line-height:1.6;">
        <strong style="color:#173f35;">Gut Seil!<br>Dein Team von Klettern &amp; Abenteuer</strong><br><br>
        Fragen? Schreib uns an <a href="mailto:info@klettern-abenteuer.de" style="color:#087b50;">info@klettern-abenteuer.de</a><br>
        <a href="${escapeHtml(siteUrl)}" style="color:#087b50;">Klettern &amp; Abenteuer online</a>
      </td></tr></table></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

module.exports={createBrandedEmailHtml};
