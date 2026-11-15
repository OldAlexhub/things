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
import { runSyncJob } from "../services/sync.js";
import { normalizeOSM, normalizeTicketmaster } from "../services/providers.js";
process.env.NODE_ENV = "test";
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
  const login = await agent
    .post("/api/v1/admin/login")
    .send({
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
test("provider normalization never invents price, hours or event time", () => {
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
  assert.equal(
    normalizeTicketmaster({ id: "x", name: "No time", dates: {} }, city, {}),
    null
  );
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
