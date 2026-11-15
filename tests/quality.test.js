import test from 'node:test';
import assert from 'node:assert/strict';
import {groupCost, generatePlan} from '../services/planner.js';
import {licensedPhoto, sameVenue, venueImageFile, entityAtVenue} from '../services/photography.js';
import {normalizeOSM} from '../services/providers.js';
import {validateRecord} from '../lib/validation.js';

test('age-specific admission includes free toddlers and rejects uncovered ages',()=>{
  const activity={priceInformation:{known:true,adult:15,currency:'USD',childBands:[{minAge:0,maxAge:3,amount:0},{minAge:4,maxAge:17,amount:10}]}};
  assert.equal(groupCost(activity,{adults:2,childAges:[2,4,17]}),50);
  activity.priceInformation.childBands.pop();
  assert.equal(groupCost(activity,{adults:2,childAges:[8]}),null);
  activity.priceInformation.child=7;
  assert.equal(groupCost(activity,{adults:2,childAges:[2,8]}),37);
});
test('unknown provider admission is not invented, explicit free is retained',()=>{
  const element={type:'node',id:1,lat:28,lon:-81,tags:{name:'Park',leisure:'park'}};
  const a=normalizeOSM(element,{_id:'city'},{});
  assert.equal(a.priceInformation.known,false);
  assert.deepEqual(a.images,[]);
  element.tags.fee='no';
  assert.equal(normalizeOSM(element,{_id:'city'},{}).priceInformation.adult,0);
});
test('licensed Wikimedia thumbnail host works; unrelated files and unlicensed photos fail closed',()=>{
  const page={title:'File:Garden.jpg',imageinfo:[{thumburl:'https://thumb.wikimedia.org/wikipedia/commons/1/Garden.jpg',descriptionurl:'https://commons.wikimedia.org/wiki/File:Garden.jpg',extmetadata:{LicenseShortName:{value:'CC BY-SA 3.0'},Artist:{value:'<a>Artist</a>'}}}]};
  assert.equal(licensedPhoto(page).credit,'Artist');
  assert.equal(licensedPhoto({...page,title:'File:Book.pdf'}),null);
  page.imageinfo[0].extmetadata.LicenseShortName.value='All rights reserved';
  assert.equal(licensedPhoto(page),null);
});
test('overlapping age prices are rejected by the editor validation',()=>{
  assert.throws(()=>validateRecord('activities',{title:'A',cityId:'507f1f77bcf86cd799439011',slug:'a',priceInformation:{known:true,adult:10,childBands:[{minAge:0,maxAge:7,amount:0},{minAge:7,maxAge:17,amount:5}]}}));
});
test('automatic photo matching requires the venue name and nearby coordinates',()=>{
  const place={lat:28.54,lon:-81.37,tags:{name:'Orlando Science Center and Dr Phillips Cinedome'}};
  const article={title:'Orlando Science Center',coordinates:[{lat:28.5401,lon:-81.3701,globe:'earth'}]};
  assert.equal(sameVenue(place,article),true);
  assert.equal(sameVenue(place,{...article,title:'Another Museum'}),false);
  assert.equal(sameVenue(place,{...article,coordinates:[{lat:40.7,lon:-74}]}),false);
  assert.equal(sameVenue(place,{...article,coordinates:[]}),false);
  assert.equal(venueImageFile('File:Orlando Museum logo.png'),false);
  assert.equal(venueImageFile('File:Orlando Museum exterior.jpg'),true);
});
test('family plan stays within budget and excludes unknown admission',()=>{
  const input={date:'2026-11-15',startTime:'10:00',endTime:'16:00',adults:2,childAges:[2,8],budget:40,strictBudget:true,start:[-81.37,28.54],radiusKm:16,exclude:[],visited:[],interests:[],environment:'any',transport:'driving',meals:false,pace:'balanced'};
  const common={categories:[],coordinates:{coordinates:[-81.37,28.54]},estimatedDuration:{max:60},verificationStatus:'verified'};
  const plan=generatePlan([{...common,_id:'1',title:'Garden',priceInformation:{known:true,adult:15,currency:'USD',childBands:[{minAge:0,maxAge:3,amount:0},{minAge:4,maxAge:17,amount:10}]}},{...common,_id:'2',title:'Unknown',priceInformation:{known:false}},{...common,_id:'3',title:'Free',priceInformation:{known:true,adult:0,child:0,currency:'USD'}}],input);
  assert.equal(plan.stops.length,2);
  assert.equal(plan.knownAdmissionTotal,40);
  assert.equal(plan.unknownCostCount,0);
  assert.ok(plan.stops.every(s=>s.endTime<='16:00'));
});

test('global attraction entities cannot donate photos to a different branch',()=>{
  const place={lat:28.5,lon:-81.4,tags:{tourism:'attraction'}};
  const claim=(lat,lon)=>({mainsnak:{datavalue:{value:{latitude:lat,longitude:lon,globe:'http://www.wikidata.org/entity/Q2'}}}});
  assert.equal(entityAtVenue(place,{claims:{P625:[claim(28.5,-81.4)]}}),true);
  assert.equal(entityAtVenue(place,{claims:{P625:[claim(34.1,-118.3)]}}),false);
  assert.equal(entityAtVenue(place,{claims:{P625:[claim(28.5,-81.4),claim(34.1,-118.3)]}}),false);
  assert.equal(entityAtVenue(place,{claims:{}}),false);
});
