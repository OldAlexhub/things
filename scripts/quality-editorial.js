// Reviewed starter content. Re-run explicitly after reviewing official admission pages.
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import mongoose from 'mongoose';
import {connectDatabase} from '../db/connect.js';
import {City, Category, Activity} from '../models/index.js';
import {cachePhoto, qualityScore} from '../services/photography.js';
export async function importReviewed() {
  const city=await City.findOne({slug:'orlando'});
  if(!city)throw new Error('Orlando is not configured');
  const venues=JSON.parse(await fs.readFile(new URL('./orlando-reviewed.json',import.meta.url),'utf8'));
  for(const venue of venues){
    const category=await Category.findOne({slug:venue.category});
    const old=await Activity.findOne({cityId:city._id,$or:[{externalId:venue.key},{title:venue.title}]}).sort({source:1});
    const free=venue.price.adult===0;
    const record={cityId:city._id,title:venue.title,slug:venue.key,
      shortDescription:venue.short,description:venue.description,
      categories:category?[category._id]:[],
      tags:[venue.category,...(venue.environment==='outdoor'?['outdoors']:[]),...(free?['free']:[])],
      audience:['local','tourist','family'],
      location:{address:venue.address},coordinates:{type:'Point',coordinates:venue.coords},
      images:[await cachePhoto(venue.photo)],environment:venue.environment,
      estimatedDuration:{min:venue.duration[0],max:venue.duration[1]},
      priceInformation:{...venue.price,currency:'USD'},officialWebsite:venue.url,
      lastVerifiedAt:new Date('2026-11-15T00:00:00Z'),verificationStatus:'verified',publicationStatus:'published',
    };
    record.qualityScore=qualityScore(record);
    await Activity.updateOne(old?{_id:old._id}:{source:'editorial',externalId:venue.key},{$set:record,$setOnInsert:{source:'editorial',externalId:venue.key,sourceUrl:venue.url}},{upsert:true});
  }
  return venues.length;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  try{await connectDatabase();console.log('Reviewed listings:',await importReviewed());}
  finally{await mongoose.disconnect();}
}
