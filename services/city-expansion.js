import mongoose from 'mongoose';
import { readFile } from 'node:fs/promises';
import { City } from '../models/index.js';
import { triggerSync } from './sync.js';

// Census Vintage 2025, SUB-IP-EST2025-ANNRNK (city proper, including Urban Honolulu).
// Coordinates/bounds: cached one-time OSM/Nominatim lookup, 1 request / 1.2 seconds.
// https://www.census.gov/data/tables/time-series/demo/popest/2020s-total-cities-and-towns.html
// https://operations.osmfoundation.org/policies/nominatim/ — no startup geocoding.
export async function expandUSCities() {
  const migrations = mongoose.connection.collection('contentMigrations');
  const key = 'us-largest-cities-and-hotels-v1';
  if (await migrations.findOne({_id:key})) return;
  const rows = JSON.parse(await readFile(new URL('../data/us-cities.json',import.meta.url),'utf8'));
  for (const {population2025, ...row} of rows) {
    // Reuse an editor's existing destination, even if its slug is different.
    const existing = await City.findOne({name:row.name,state:row.state});
    if (existing) continue;
    await City.updateOne({slug:row.slug},{$setOnInsert:{
      ...row, description:`Find your next good day in ${row.name}, ${row.state}. Explore local places, parks, culture and places to stay.`,
      publicationStatus:'published',publishedAt:new Date(),catalogReady:false,
      supportedFeatures:['events','planning','maps','nearby'],
      theme:{accent:'#12B8A6',background:'#101827'},
      homeSections:[
        {key:'discover',title:'A day worth discovering',type:'activities',visible:true,order:0},
        {key:'events',title:'Coming up in the city',type:'events',visible:true,order:1},
        {key:'outdoors',title:'Take the scenic route',type:'activities',tags:['outdoors'],visible:true,order:2},
        {key:'hotels',title:'Make yourself at home',type:'activities',tags:['hotels'],visible:true,order:3},
      ],
    }},{upsert:true});
  }
  if ((process.env.SYNC_ENABLED ?? 'true') === 'true') {
    for (const city of await City.find({publicationStatus:'published'}).select('_id').lean()) {
      try { await triggerSync('osm',String(city._id)); }
      catch(error) { if(error.status!==422) throw error; }
    }
  }
  try { await migrations.insertOne({_id:key,appliedAt:new Date()}); }
  catch(error) { if(error.code!==11000) throw error; }
}
