'use strict';

const crypto=require('node:crypto');
const ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decodeBase32(secret){
  if(typeof secret!=='string')throw new TypeError('TOTP-Schlüssel muss Base32-Text sein.');
  const clean=secret.replace(/\s|=+$/g,'').toUpperCase();
  if(!clean||!/^[A-Z2-7]+$/.test(clean))throw new Error('TOTP-Schlüssel ist kein gültiger Base32-Wert.');
  let buffer=0,bits=0;
  const bytes=[];
  for(const character of clean){
    buffer=(buffer<<5)|ALPHABET.indexOf(character);
    bits+=5;
    if(bits>=8){bits-=8;bytes.push((buffer>>bits)&255);}
  }
  if(bits&&((buffer&((1<<bits)-1))!==0))throw new Error('TOTP-Schlüssel hat ungültige Base32-Füllbits.');
  const decoded=Buffer.from(bytes);
  if(decoded.length<16)throw new Error('TOTP-Schlüssel muss mindestens 128 Bit enthalten.');
  return decoded;
}

function totpCode(secret,counter){
  const key=Buffer.isBuffer(secret)?secret:decodeBase32(secret);
  if(!Number.isSafeInteger(counter)||counter<0)throw new RangeError('TOTP-Zähler ist ungültig.');
  const message=Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest=crypto.createHmac('sha1',key).update(message).digest();
  const offset=digest[digest.length-1]&0x0f;
  const binary=((digest[offset]&0x7f)<<24)|((digest[offset+1]&0xff)<<16)|
    ((digest[offset+2]&0xff)<<8)|(digest[offset+3]&0xff);
  return String(binary%1000000).padStart(6,'0');
}

function verifyTotp(secret,code,now=Date.now()){
  if(typeof code!=='string'||!/^\d{6}$/.test(code)||!Number.isFinite(now)||now<0)return null;
  const current=Math.floor(now/30000);
  const supplied=Buffer.from(code);
  let matched=null;
  for(const counter of [current-1,current,current+1]){
    if(counter<0)continue;
    const candidate=Buffer.from(totpCode(secret,counter));
    if(crypto.timingSafeEqual(candidate,supplied))matched=counter;
  }
  return matched;
}

module.exports={decodeBase32,totpCode,verifyTotp};
