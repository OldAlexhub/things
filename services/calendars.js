import ical from 'node-ical';
import {createHash} from 'node:crypto';
import {EventFeed} from '../models/index.js';
import {publicText} from './public-fetch.js';
const text=value=>String(value?.val ?? value ?? '').replace(/<[^>]*>/g,'').trim();
const httpsUrl=value=>{try{const u=new URL(text(value));return u.protocol==='https:'?u.href:undefined;}catch{return undefined;}};
export async function calendarRecords(raw,feed,city,categories={},now=new Date()) {
  if(!raw.includes('BEGIN:VCALENDAR'))throw new Error('The URL did not return an iCalendar feed');
  // Floating calendar times are in the destination's zone, never the server's zone.
  let inEvent=false;
  const zoned=raw.replace(/\r\n[ \t]/g,'').split(/\r?\n/).map(line=>{
    if(line==='BEGIN:VEVENT')inEvent=true;
    if(line==='END:VEVENT')inEvent=false;
    if(inEvent && /^(DTSTART|DTEND|RECURRENCE-ID|EXDATE):\d{8}T\d{6}(,\d{8}T\d{6})*$/.test(line)) return line.replace(':',`;TZID=${city.timezone}:`);
    return line;
  }).join('\r\n');
  const parsed=await ical.async.parseICS(zoned), records=[];
  const until=new Date(+now+90*86400000);
  for(const event of Object.values(parsed)) {
    if(event.type!=='VEVENT' || text(event.class).toUpperCase()==='PRIVATE' || text(event.class).toUpperCase()==='CONFIDENTIAL') continue;
    const instances=ical.expandRecurringEvent(event,{from:now,to:until,expandOngoing:true,maxIterations:10000});
    for(const instance of instances) {
      const e=instance.event, title=text(instance.summary).slice(0,160), location=text(e.location);
      if(!title || !instance.start || /\b(virtual|online|zoom|webinar)\b/i.test(location))continue;
      const sourceUrl=httpsUrl(e.url)||httpsUrl(feed.sourceUrl), key=createHash('sha256').update(`${feed._id}:${event.uid}:${instance.start.toISOString()}`).digest('hex').slice(0,24);
      if(!sourceUrl)continue;
      const coords=e.geo && [Number(e.geo.lon),Number(e.geo.lat)];
      records.push({
        cityId:city._id,title,slug:`calendar-${key}`,source:'calendars',externalId:`${feed._id}:${key}`,
        sourceUrl,officialWebsite:sourceUrl,venue:location.slice(0,160),location:{address:location.slice(0,500)},
        ...(coords?.every(Number.isFinite)&&Math.abs(coords[0])<=180&&Math.abs(coords[1])<=90?{coordinates:{type:'Point',coordinates:coords}}:{}),
        shortDescription:`From ${feed.name}. Check the organizer for entry requirements and current details.`,
        description:`Listed in ${feed.name}. Confirm admission, eligibility, registration and any changes on the organizer's event page.`,
        categories:categories['events-festivals']?[categories['events-festivals']]:[],tags:['events'],images:[],audience:[],
        startAt:instance.start,endAt:instance.end,allDay:instance.isFullDay,timezone:city.timezone,
        eventStatus:text(e.status).toUpperCase()==='CANCELLED'?'cancelled':'scheduled',
        priceInformation:{known:false,currency:'USD',note:'See the organizer for prices and registration.'},
        publicationStatus:'published',verificationStatus:'unverified',
      });
      if(records.length>=300)return records;
    }
  }
  return records;
}
export const calendarProvider={
  model:'Event',configured:()=>(process.env.EVENTS_ENABLED??'true')==='true',
  async available(city){return !!await EventFeed.exists({cityId:city._id,enabled:true,permissionReviewed:true});},
  async fetch(city,categories){
    const feeds=await EventFeed.find({cityId:city._id,enabled:true,permissionReviewed:true}).limit(10).lean();
    const records=[];
    for(const feed of feeds)records.push(...await calendarRecords(await publicText(feed.url),feed,city,categories));
    return records;
  },
};
