import https from 'node:https';
import {lookup} from 'node:dns/promises';

export function publicIPv4(address) {
  const p=address.split('.').map(Number);
  return p.length===4 && p.every(n=>Number.isInteger(n)&&n>=0&&n<=255) &&
    ![0,10,127].includes(p[0]) && p[0]<224 && !(p[0]===169&&p[1]===254) &&
    !(p[0]===172&&p[1]>=16&&p[1]<=31) && !(p[0]===192&&[0,168].includes(p[1])) &&
    !(p[0]===100&&p[1]>=64&&p[1]<=127) && !(p[0]===198&&[18,19].includes(p[1]));
}
// Admin-entered calendars must never become an internal-network proxy.
// Pin the validated DNS answer through connect; validate every redirect as well.
export async function publicText(value, redirects=0) {
  const url=new URL(value);
  if(url.protocol!=='https:' || url.username || url.password || (url.port && url.port!=='443') ||
    !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)) throw new Error('Use a public HTTPS calendar URL');
  const answers=await lookup(url.hostname,{family:4,all:true});
  if(!answers.length || answers.some(a=>!publicIPv4(a.address))) throw new Error('Calendar host must use public internet addresses');
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{family:4,headers:{'User-Agent':'ThingsToDo/1.2 (info@oldalexhub.com)','Accept':'text/calendar, application/json, text/plain'},
      lookup:(_host,options,callback)=>options.all ? callback(null,answers) : callback(null,answers[0].address,4),
    },res=>{
      if([301,302,303,307,308].includes(res.statusCode)) {
        res.resume();
        if(redirects>=3 || !res.headers.location) return reject(new Error('Too many calendar redirects'));
        resolve(publicText(new URL(res.headers.location,url).href,redirects+1)); return;
      }
      if(res.statusCode!==200){res.resume();reject(new Error(`Public source returned HTTP ${res.statusCode}`));return;}
      let bytes=0;const chunks=[];
      res.on('data',chunk=>{bytes+=chunk.length;if(bytes>2_000_000)req.destroy(new Error('Public feed exceeds 2 MB'));else chunks.push(chunk);});
      res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));res.on('error',reject);
    });
    const timer=setTimeout(()=>req.destroy(new Error('Public source timed out')),20000);
    req.on('close',()=>clearTimeout(timer)); req.on('error',reject);
  });
}
