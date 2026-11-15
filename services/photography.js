import {createHash} from "node:crypto";
import {access,mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
// Place-linked and coordinate-verified photography. Never substitute an unrelated image.
const cache = new Map();
const UA = 'ThingsToDo/1.1 (Old Alex Hub; info@oldalexhub.com)';
async function request(host, params) {
  const response = await fetch(`https://${host}/w/api.php?${new URLSearchParams({format:'json', ...params})}`, {
    headers: {'User-Agent': UA}, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Photography provider unavailable');
  return response.json();
}
const plain = value => String(value || '').replace(/<[^>]*>/g, '').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').trim().slice(0,1000);
export function licensedPhoto(page) {
  if(!venueImageFile(page?.title)) return null;
  const info = page?.imageinfo?.[0], meta = info?.extmetadata;
  const license = plain(meta?.LicenseShortName?.value);
  if (!/^(CC BY(?:-SA)? (?:1\.0|2\.0|2\.5|3\.0|4\.0)|CC0(?: 1\.0)?|Public domain)$/i.test(license)) return null;
  const url = info.thumburl || info.url;
  if (!/^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(url || '') || !/\.(jpg|jpeg|png|webp)(?:$|\?)/i.test(url)) return null;
  const credit = plain(meta?.Artist?.value || meta?.Credit?.value);
  if (!credit) return null;
  return {url, credit, license, alt: plain(page.title?.replace(/^File:/,'')), sourceUrl: info.descriptionurl};
}
// Names plus coordinates are required for inferred matches. Nearby alone is never enough.
const canonical = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\([^)]*\)/g,'').replace(/^the\s+/,'').replace(/[^a-z0-9]/g,'');
export function sameVenue(element, page) {
  const points=page.coordinates?.filter(p=>p.globe==='earth' || !p.globe) || [];
  const point=points[0];
  const lat=element.lat ?? element.center?.lat, lon=element.lon ?? element.center?.lon;
  if(!point || !Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const km=Math.hypot((point.lat-lat)*111.2,(point.lon-lon)*111.2*Math.cos(lat*Math.PI/180));
  if(km>0.5 || points.some(p=>Math.hypot((p.lat-lat)*111.2,(p.lon-lon)*111.2*Math.cos(lat*Math.PI/180))>0.5))return false;
  const title=canonical(page.title);
  return ['name','name:en','official_name','alt_name','short_name'].flatMap(k=>(element.tags?.[k] || '').split(';')).some(name=>{
    const text=canonical(name);
    return text.length>=6 && (text===title || (km<0.2 && Math.min(text.length,title.length)>=12 && (text.startsWith(title)||title.startsWith(text))));
  });
}
export function entityAtVenue(element, entity) {
  const lat=element.lat ?? element.center?.lat, lon=element.lon ?? element.center?.lon;
  const points=(entity?.claims?.P625 || []).filter(c=>c.rank!=='deprecated').map(c=>c.mainsnak?.datavalue?.value).filter(p=>p && p.globe?.endsWith('/Q2'));
  if(!points.length || !Number.isFinite(lat) || !Number.isFinite(lon))return false;
  const limit=element.tags?.tourism==='theme_park' || element.tags?.leisure ? 3 : 0.75;
  return points.every(p=>Math.hypot((p.latitude-lat)*111.2,(p.longitude-lon)*111.2*Math.cos(lat*Math.PI/180))<=limit);
}
export function venueImageFile(title) {
  return /\.(jpe?g|png|webp)$/i.test(title || '') && !/(?:^|[ _-])(logo|logos|icon|map|locator|flag|portrait|diagram|seal)(?:[ _.-]|$)/i.test(title);
}
const geoCache=new Map();
async function nearbyPages(city) {
  if(!Number.isFinite(city?.latitude)||!Number.isFinite(city?.longitude))return [];
  const key=String(city._id), saved=geoCache.get(key);
  if(saved?.until>Date.now())return saved.pages;
  const centers=[[city.latitude,city.longitude]], bounds=city.geographicBounds;
  if(bounds?.length===4){
    // Four extra points cover larger cities without a separate search for every place.
    const dy=Math.min(.12,(bounds[2]-bounds[0])/3),dx=Math.min(.14,(bounds[3]-bounds[1])/3);
    for(const y of [-dy,dy])for(const x of [-dx,dx])centers.push([city.latitude+y,city.longitude+x]);
  }
  const pages=new Map();
  for(const [lat,lon] of centers){
    try {
      const data=await request('en.wikipedia.org',{action:'query',generator:'geosearch',ggscoord:`${lat}|${lon}`,ggsradius:'10000',ggslimit:'50',prop:'pageimages|coordinates',piprop:'name',pilicense:'free',pilimit:'50',colimit:'max'});
      for(const page of Object.values(data.query?.pages || {}))if(page.pageimage)pages.set(page.pageid,page);
    } catch { /* Linked place photos remain available during an encyclopedia outage. */ }
  }
  const result=[...pages.values()];
  if(geoCache.size>100)geoCache.clear();
  if(result.length)geoCache.set(key,{pages:result,until:Date.now()+86400000});
  return result;
}
export async function linkedPhotos(elements, city) {
  const files=new Map(), entities=new Map(), articles=new Map(), categories=new Map();
  const add=(key,title)=>{
    title=title.replaceAll('_',' ');
    if(!venueImageFile(title))return;
    const list=files.get(key)||[];if(!list.includes(title))list.push(title);files.set(key,list);
  };
  for(const e of elements){
    const t=e.tags||{}, key=`${e.type}/${e.id}`;
    if(/^File:/i.test(t.wikimedia_commons||''))add(key,t.wikimedia_commons);
    else if(/^Category:/i.test(t.wikimedia_commons||''))categories.set(key,t.wikimedia_commons);
    if(/^Q\d+$/.test(t.wikidata||''))entities.set(key,t.wikidata);
    if(/^en:/.test(t.wikipedia||''))articles.set(key,t.wikipedia.slice(3));
    // A Commons file URL explicitly attached to this OSM place is another exact link.
    const file=String(t.image||'').match(/^https:\/\/commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/);
    if(file){try{add(key,decodeURIComponent(file[1]));}catch{}}
  }
  const ids=[...new Set(entities.values())].slice(0,500);
  for(let i=0;i<ids.length;i+=50){
    try{
      const data=await request('www.wikidata.org',{action:'wbgetentities',ids:ids.slice(i,i+50).join('|'),props:'claims'});
      for(const [key,id] of entities){
        const file=data.entities?.[id]?.claims?.P18?.find(c=>c.rank!=='deprecated')?.mainsnak?.datavalue?.value;
        const element=elements.find(e=>`${e.type}/${e.id}`===key);
        if(file && entityAtVenue(element,data.entities[id]))add(key,'File:'+file);
      }
    }catch{}
  }
  const articleTitles=[...new Set(articles.values())].slice(0,200);
  for(let i=0;i<articleTitles.length;i+=50){
    try{
      const data=await request('en.wikipedia.org',{action:'query',titles:articleTitles.slice(i,i+50).join('|'),redirects:'1',prop:'pageimages|coordinates',piprop:'name',pilicense:'free',pilimit:'50',colimit:'max'});
      for(const e of elements){const key=`${e.type}/${e.id}`;if(!articles.has(key))continue;
        const page=Object.values(data.query?.pages||{}).find(p=>sameVenue(e,p));
        if(page?.pageimage)add(key,'File:'+page.pageimage);
      }
    }catch{}
  }
  const nearby=await nearbyPages(city);
  for(const e of elements){
    const key=`${e.type}/${e.id}`;
    if(files.has(key))continue;
    const matches=nearby.filter(p=>sameVenue(e,p));
    if(matches.length===1)add(key,'File:'+matches[0].pageimage);
  }
  // Only categories explicitly linked by the place, never broad image-search results.
  for(const [key,title] of [...categories].slice(0,15)){
    if(files.has(key))continue;
    try{
      const data=await request('commons.wikimedia.org',{action:'query',list:'categorymembers',cmtitle:title,cmtype:'file',cmlimit:'5'});
      for(const member of data.query?.categorymembers||[])add(key,member.title);
    }catch{}
  }
  const titles=[...new Set([...files.values()].flat())].filter(t=>!cache.has(t)||cache.get(t).until<Date.now());
  for(let i=0;i<titles.length;i+=40){
    try{
      const data=await request('commons.wikimedia.org',{action:'query',titles:titles.slice(i,i+40).join('|'),prop:'imageinfo',iiprop:'url|extmetadata',iiurlwidth:'800'});
      for(const page of Object.values(data.query?.pages||{}))cache.set(page.title,{photo:licensedPhoto(page),until:Date.now()+86400000});
    }catch{}
  }
  if(cache.size>3000)cache.clear();
  return new Map([...files].map(([key,candidates])=>[key,candidates.map(title=>cache.get(title)?.photo).find(Boolean)]).filter(([,photo])=>photo));
}
export function qualityScore(record) {
  return (record.images?.length ? 40 : 0) + (record.priceInformation?.known ? 20 : 0) +
    (record.officialWebsite ? 10 : 0) + (record.estimatedDuration ? 5 : 0) +
    (record.verificationStatus === 'verified' ? 25 : 0);
}

export async function cachePhoto(photo) {
  if(!/^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(photo.url))return photo;
  const filename=createHash('sha256').update(photo.url.split('?')[0]).digest('hex').slice(0,32)+'.webp';
  const directory=path.resolve(process.env.UPLOAD_DIR || 'uploads');
  const target=path.join(directory,filename);
  try { await access(target); } catch {
    try {
      const response=await fetch(photo.url,{headers:{'User-Agent':UA},signal:AbortSignal.timeout(15000)});
      if(!response.ok || !/^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(response.url))return photo;
      const chunks=[];let total=0;
      for await(const chunk of response.body){total+=chunk.length;if(total>8*1024*1024)throw new Error('Photo too large');chunks.push(chunk);}
      const data=await sharp(Buffer.concat(chunks),{limitInputPixels:40000000}).resize({width:1000,withoutEnlargement:true}).webp({quality:82}).toBuffer();
      await mkdir(directory,{recursive:true});await writeFile(target,data);
    }catch{return photo;}
  }
  return {...photo,url:'/uploads/'+filename};
}
