import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { connectDatabase } from "../db/connect.js";
import { createApp } from "../app.js";
import { seed } from "../scripts/seed.js";
import {
  City,
  Activity,
  Event,
  Category,
  ContentSource,
  SyncJob,
  AdminUser,
  AppVersion,
} from "../models/index.js";
import { runSyncJob, queuePublishedCitySyncs } from "../services/sync.js";
import { normalizeOSM, providers } from "../services/providers.js";
import {checkMentions} from '../services/mentions.js';
process.env.NODE_ENV = "test";
test('hotel discovery keeps room rates separate from admission and day plans', async () => {
  const normalized=normalizeOSM({type:'node',id:980001,lat:city.latitude,lon:city.longitude,tags:{name:'Test lodging',tourism:'hotel',fee:'no'}},city,{});
  assert.equal(normalized.kind,'hotel'); assert.equal(normalized.priceInformation.known,false);
  assert.ok(normalized.tags.includes('hotels'));
  const hotel=await Activity.create(normalized);
  const list=await request(app).get(`/api/v1/hotels?cityId=${city._id}`);
  assert.equal(list.status,200); assert.ok(list.body.data.some(a=>a._id===String(hotel._id)));
  const places=await request(app).get(`/api/v1/activities?cityId=${city._id}&kind=place`);
  assert.ok(!places.body.data.some(a=>a._id===String(hotel._id)));
  const {eligible}=await import('../services/planner.js');
  assert.equal(eligible(normalized,{}),false);
  await Activity.deleteOne({_id:hotel._id});
});
process.env.ADMIN_PASSWORD = "test-only-password-never-production";
let mongo, app, city, category, free, agent, csrf;
before(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDatabase(mongo.getUri());
  city = await seed();
  category = await Category.findOne({ slug: "outdoors-nature" });
  await Promise.all([
    Activity.init(),
    Event.init(),
    City.init(),
    SyncJob.init(),
  ]);
  free = await Activity.create({
    cityId: city._id,
    title: "Test free park",
    slug: "test-free-park",
    description: "A searchable test fixture, never seeded into production.",
    categories: [category._id],
    publicationStatus: "published",
    coordinates: {
      type: "Point",
      coordinates: [city.longitude, city.latitude],
    },
    priceInformation: { known: true, adult: 0, child: 0, currency: "USD" },
    estimatedDuration: { min: 60, max: 90 },
  });
  app = createApp();
  agent = request.agent(app);
  const login = await agent.post("/api/v1/admin/login").send({
    email: "info@oldalexhub.com",
    password: process.env.ADMIN_PASSWORD,
  });
  assert.equal(login.status, 200);
  csrf = login.body.data.csrf;
});
after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
test("health and public city publication", async () => {
  await City.create({
    name: "Draft city",
    slug: "draft-city",
    timezone: "UTC",
    publicationStatus: "draft",
  });
  const r = await request(app).get("/api/v1/cities");
  assert.equal(r.status, 200);
  assert.equal(r.body.data.length, 1);
  assert.equal((await request(app).get("/api/v1/health")).status, 200);
});
test("indexed search, category and zero-price filter", async () => {
  const r = await request(app).get(
    `/api/v1/activities?cityId=${city._id}&q=searchable&category=${category._id}&budget=0`
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.data.length, 1);
  assert.equal(r.body.meta.total, 1);
});
test("distance pagination uses geospatial records", async () => {
  const r = await request(app).get(
    `/api/v1/activities?cityId=${city._id}&lat=${city.latitude}&lon=${city.longitude}&sort=distance`
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.data[0]._id, String(free._id));
});
test("expired provider records and events are hidden", async () => {
  await Activity.create({
    cityId: city._id,
    title: "Expired",
    slug: "expired",
    publicationStatus: "published",
    expiresAt: new Date(Date.now() - 1000),
  });
  await Event.create({
    cityId: city._id,
    title: "Past",
    slug: "past",
    startAt: new Date(Date.now() - 86400000),
    publicationStatus: "published",
  });
  const r = await request(app).get(`/api/v1/events?cityId=${city._id}`);
  assert.equal(r.body.data.length, 0);
  const places = await request(app).get(
    `/api/v1/activities?cityId=${city._id}`
  );
  assert.equal(places.body.data.length, 1);
});
test("unpublished cities never leak activities", async () => {
  const c = await City.findOne({ slug: "draft-city" });
  await Activity.create({
    cityId: c._id,
    title: "Hidden",
    slug: "hidden",
    publicationStatus: "published",
  });
  assert.equal(
    (await request(app).get(`/api/v1/activities?cityId=${c._id}`)).status,
    404
  );
});
test("invalid identifiers and query operators are rejected", async () => {
  assert.equal(
    (await request(app).get("/api/v1/activities/not-an-id")).status,
    400
  );
  assert.equal(
    (await request(app).get("/api/v1/activities?cityId[$ne]=x")).status,
    400
  );
});
test("admin requires authenticated session and csrf for writes", async () => {
  assert.equal((await request(app).get("/api/v1/admin/cities")).status, 401);
  assert.equal(
    (await agent.post("/api/v1/admin/categories").send({ name: "Test" }))
      .status,
    403
  );
  const r = await agent
    .post("/api/v1/admin/categories")
    .set("X-CSRF-Token", csrf)
    .send({ name: "A test category", slug: "test-category", icon: "Compass" });
  assert.equal(r.status, 201);
});
test("disallowed browser origin cannot mutate records", async () =>
  assert.equal(
    (
      await agent
        .post("/api/v1/admin/categories")
        .set("Origin", "https://untrusted.example")
        .set("X-CSRF-Token", csrf)
        .send({ name: "Blocked", slug: "blocked" })
    ).status,
    403
  ));
test("safe itinerary generation and strict zero budget", async () => {
  const r = await request(app)
    .post("/api/v1/itineraries/generate")
    .send({
      cityId: String(city._id),
      date: "2026-11-14",
      budget: 0,
      adults: 1,
      childAges: [4, 8],
      meals: false,
    });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.stops.length, 1);
  assert.equal(r.body.data.knownAdmissionTotal, 0);
});
test("server version policy distinguishes minimum and latest", async () => {
  await AppVersion.updateOne(
    { platform: "android" },
    {
      $set: {
        latestVersionCode: 3,
        minimumVersionCode: 2,
        updatePolicy: "required",
      },
    }
  );
  const r = await request(app).get("/api/v1/app/version?currentVersionCode=1");
  assert.equal(r.body.data.updateRequired, true);
  assert.equal(
    (await request(app).get("/api/v1/app/version?currentVersionCode=3")).body
      .data.updateAvailable,
    false
  );
});
test("provider errors preserve existing content and release the lease", async () => {
  await ContentSource.updateOne(
    { name: "osm" },
    { $set: { enabled: true, permissionReviewed: true } }
  );
  const job = await SyncJob.create({
    key: "osm:test-failure",
    source: "osm",
    cityId: city._id,
    lockedUntil: new Date(0),
  });
  const beforeCount = await Activity.countDocuments();
  const log = await runSyncJob(job, {
    model: "Activity",
    configured: () => true,
    fetch: async () => {
      throw new Error("Provider HTTP 429");
    },
  });
  assert.equal(log.status, "failed");
  assert.equal(await Activity.countDocuments(), beforeCount);
  assert.ok((await SyncJob.findById(job._id)).lockedUntil <= new Date());
});
test("sync upserts deduplicate and preserve editor archive", async () => {
  const job = await SyncJob.create({
    key: "osm:test-success",
    source: "osm",
    cityId: city._id,
    lockedUntil: new Date(0),
  });
  const provider = {
    model: "Activity",
    configured: () => true,
    fetch: async () => [
      {
        cityId: city._id,
        title: "Imported fixture",
        slug: "imported-fixture",
        externalId: "node/test-only",
        source: "osm",
        publicationStatus: "published",
      },
    ],
  };
  assert.equal((await runSyncJob(job, provider)).recordsInserted, 1);
  assert.equal((await runSyncJob(job, provider)).recordsUpdated, 1);
  await Activity.updateOne(
    { externalId: "node/test-only" },
    { $set: { publicationStatus: "archived" } }
  );
  await runSyncJob(job, provider);
  assert.equal(
    (await Activity.findOne({ externalId: "node/test-only" }))
      .publicationStatus,
    "archived"
  );
});
test("active lease prevents overlapping jobs", async () => {
  const job = await SyncJob.create({
    key: "locked",
    source: "osm",
    cityId: city._id,
    lockedUntil: new Date(Date.now() + 60000),
  });
  assert.equal(await runSyncJob(job), false);
});

test('overlapping cities keep separate venue records and editor decisions', async () => {
  const other = await City.create({name:'Neighbor',slug:'neighbor',country:'US',state:'FL',latitude:28.6,longitude:-81.3,timezone:'America/New_York',publicationStatus:'published'});
  const original = await Activity.create({cityId:city._id,title:'Shared venue',slug:'shared-venue',source:'osm',externalId:'node/overlap',publicationStatus:'archived'});
  const job = await SyncJob.create({key:'osm:overlap',source:'osm',cityId:other._id,lockedUntil:new Date(0)});
  const provider = {model:'Activity',configured:()=>true,fetch:async()=>[{cityId:other._id,title:'Shared venue',slug:'shared-venue',source:'osm',externalId:'node/overlap',publicationStatus:'published'}]};
  assert.equal((await runSyncJob(job,provider)).recordsInserted,1);
  assert.equal((await runSyncJob(job,provider)).recordsUpdated,1);
  const preserved = await Activity.findById(original._id);
  assert.equal(String(preserved.cityId),String(city._id));
  assert.equal(preserved.publicationStatus,'archived');
  assert.equal(await Activity.countDocuments({source:'osm',externalId:{$in:['node/overlap',`${other._id}:node/overlap`]}}),2);
  await Activity.deleteMany({_id:{$ne:original._id},cityId:other._id});
  await Activity.deleteOne({_id:original._id}); await SyncJob.deleteOne({_id:job._id}); await City.deleteOne({_id:other._id});
});
test("provider normalization never invents price or hours", () => {
  const a = normalizeOSM(
    {
      id: 42,
      type: "node",
      lat: 28,
      lon: -81,
      tags: { name: "Fixture museum", tourism: "museum" },
    },
    city,
    {}
  );
  assert.equal(a.priceInformation.known, false);
  assert.equal(a.operatingHours, undefined);
  assert.deepEqual(Object.keys(providers).sort(), ['calendars', 'osm']);
});

test("editor can clear optional fields and cannot reference a missing city", async () => {
  const record = {
    cityId: String(city._id),
    title: "Editable test fixture",
    slug: "editable-test-fixture",
    coordinates: { type: "Point", coordinates: [-81.3, 28.5] },
    bookingUrl: "https://example.com/tickets",
  };
  const created = await agent
    .post("/api/v1/admin/activities")
    .set("X-CSRF-Token", csrf)
    .send(record);
  assert.equal(created.status, 201);
  delete record.coordinates;
  delete record.bookingUrl;
  const updated = await agent
    .put("/api/v1/admin/activities/" + created.body.data._id)
    .set("X-CSRF-Token", csrf)
    .send(record);
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.coordinates, undefined);
  assert.equal(updated.body.data.bookingUrl, undefined);
  const invalid = await agent
    .post("/api/v1/admin/activities")
    .set("X-CSRF-Token", csrf)
    .send({
      ...record,
      slug: "bad-city-fixture",
      cityId: "000000000000000000000001",
    });
  assert.equal(invalid.status, 400);
});
test("verified hours must match the planning city timezone", async () => {
  const r = await agent
    .post("/api/v1/admin/activities")
    .set("X-CSRF-Token", csrf)
    .send({
      cityId: String(city._id),
      title: "Timezone test fixture",
      slug: "timezone-test",
      operatingHours: {
        verified: true,
        timezone: "Europe/London",
        weekly: [],
        validUntil: "2027-01-01T00:00:00Z",
      },
    });
  assert.equal(r.status, 400);
});

test("publishing a city on the server enables discovery and queues its free provider sync", async () => {
  process.env.OSM_ENABLED = "true";
  process.env.SYNC_ENABLED = "true";
  const destination = await City.create({
    name: "Publication test city",
    slug: "publication-test-city",
    state: "FL",
    country: "USA",
    timezone: "America/New_York",
    latitude: 28,
    longitude: -81,
    description: "Isolated test fixture",
    publicationStatus: "draft",
  });
  await queuePublishedCitySyncs();
  assert.equal(await SyncJob.exists({ key: `osm:${destination._id}` }), null);
  const fields = {
    name: destination.name,
    slug: destination.slug,
    state: destination.state,
    country: destination.country,
    timezone: destination.timezone,
    latitude: destination.latitude,
    longitude: destination.longitude,
    description: destination.description,
    publicationStatus: "published",
  };
  const published = await agent
    .put(`/api/v1/admin/cities/${destination._id}`)
    .set("X-CSRF-Token", csrf)
    .send(fields);
  assert.equal(published.status, 200);
  await queuePublishedCitySyncs();
  assert.ok(await SyncJob.exists({ key: `osm:${destination._id}` }));
  assert.ok(
    (await request(app).get("/api/v1/cities")).body.data.some(
      (c) => c._id === String(destination._id)
    )
  );
  await queuePublishedCitySyncs();
  assert.equal(
    await SyncJob.countDocuments({ key: `osm:${destination._id}` }),
    1
  );
  fields.publicationStatus = "unpublished";
  await agent
    .put(`/api/v1/admin/cities/${destination._id}`)
    .set("X-CSRF-Token", csrf)
    .send(fields);
  assert.equal(
    (await request(app).get(`/api/v1/cities/${destination._id}`)).status,
    404
  );
});
test("only the free configured provider can be requested for synchronization", async () => {
  const r = await agent
    .post("/api/v1/admin/sync")
    .set("X-CSRF-Token", csrf)
    .send({ source: "unsupported-provider", cityId: String(city._id) });
  assert.equal(r.status, 400);
});
test('campaign dashboard is private and distinguishes successful empty checks from failures',async()=>{
  assert.equal((await request(app).get('/api/v1/admin/campaign')).status,401);
  await checkMentions({fetcher:async url=>url.includes('bsky')?{ok:true,json:async()=>({posts:[]})}:{ok:false,status:503}});
  const result=await agent.get('/api/v1/admin/campaign');
  assert.equal(result.status,200);assert.equal(result.body.data.hashtag,'#old_alex_hub');
  assert.equal(result.body.data.checks.find(c=>c.source==='Bluesky').status,'ok');
  assert.equal(result.body.data.checks.find(c=>c.source==='Mastodon').status,'unavailable');
  assert.equal(result.body.data.mentions.length,0);
  assert.equal((await agent.post('/api/v1/admin/campaign/mentions').send({url:'https://example.org/post'})).status,403);
  const created=await agent.post('/api/v1/admin/campaign/mentions').set('X-CSRF-Token',csrf).send({url:'https://example.org/post',excerpt:'A test link'});
  assert.equal(created.status,201);
  const repeat=await agent.post('/api/v1/admin/campaign/mentions').set('X-CSRF-Token',csrf).send({url:'https://example.org/post'});
  assert.equal(repeat.body.data._id,created.body.data._id);
  await agent.delete('/api/v1/admin/campaign/mentions/'+created.body.data._id).set('X-CSRF-Token',csrf);
  assert.equal((await agent.get('/api/v1/admin/campaign')).body.data.mentions.length,0);
});
