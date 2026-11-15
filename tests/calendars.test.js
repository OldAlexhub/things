import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calendarRecords} from '../services/calendars.js';
import {publicIPv4,publicText} from '../services/public-fetch.js';
const feed={_id:'feed1',name:'Public calendar',sourceUrl:'https://example.org/events'};
const city={_id:'city1',timezone:'America/New_York'};
const calendar=body=>`BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR`;
test('floating times use city time; recurrence excludes cancelled and exception dates',async()=>{
  const data=calendar('BEGIN:VEVENT\r\nUID:weekly\r\nSUMMARY:City walk\r\nDTSTART:20261115T100000\r\nDTEND:20261115T110000\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEXDATE:20261116T100000\r\nEND:VEVENT');
  const rows=await calendarRecords(data,feed,city,{},new Date('2026-11-15T00:00:00Z'));
  assert.equal(rows.length,2); assert.equal(rows[0].startAt.toISOString(),'2026-11-15T15:00:00.000Z');
  assert.equal(rows[1].startAt.toISOString(),'2026-11-17T15:00:00.000Z');
  assert.equal(rows[0].priceInformation.known,false);assert.deepEqual(rows[0].images,[]);
});
test('private and online events are excluded; cancellations are retained as cancelled',async()=>{
  const body=['PRIVATE','PUBLIC'].map((access,i)=>`BEGIN:VEVENT\r\nUID:e${i}\r\nSUMMARY:Meeting\r\nCLASS:${access}\r\nSTATUS:CANCELLED\r\nDTSTART:20261117T100000Z\r\nDTEND:20261117T110000Z\r\nEND:VEVENT`).join('\r\n');
  const rows=await calendarRecords(calendar(body),feed,city,{},new Date('2026-11-15T00:00:00Z'));
  assert.equal(rows.length,1);assert.equal(rows[0].eventStatus,'cancelled');
});
test('calendar fetching refuses loopback, private networks and non-HTTPS',async()=>{
  for(const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','0.0.0.0','224.0.0.1'])assert.equal(publicIPv4(ip),false);
  assert.equal(publicIPv4('8.8.8.8'),true);
  await assert.rejects(publicText('http://example.org/calendar.ics'));
  await assert.rejects(publicText('https://127.0.0.1/calendar.ics'));
  await assert.rejects(publicText('https://user:password@example.org/feed'));
});
