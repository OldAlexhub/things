import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import {
  City,
  Category,
  Activity,
  Event,
  Collection,
  AppVersion,
} from "../models/index.js";
import { id, planning } from "../lib/validation.js";
import {
  generatePlan,
  rankActivities,
  hoursStatus,
} from "../services/planner.js";
export const publicRouter = Router();
export const visible = () => ({
  publicationStatus: "published",
  $or: [
    { expiresAt: { $exists: false } },
    { expiresAt: null },
    { expiresAt: { $gt: new Date() } },
  ],
});
export const upcoming = () => ({
  eventStatus: { $in: ["scheduled", "rescheduled"] },
  $and: [
    {
      $or: [
        { endAt: { $gt: new Date() } },
        { endAt: { $exists: false }, startAt: { $gt: new Date() } },
      ],
    },
  ],
});
export async function cityOr404(cityId) {
  id.parse(cityId);
  const city = await City.findOne({
    _id: cityId,
    publicationStatus: "published",
  }).lean();
  if (!city)
    throw Object.assign(new Error("This city is not available"), {
      status: 404,
    });
  return city;
}
const send = (res, data, meta) => res.json({ data, ...(meta ? { meta } : {}) });
publicRouter.get("/health", (_req, res) =>
  res
    .status(mongoose.connection.readyState === 1 ? 200 : 503)
    .json({
      data: {
        status:
          mongoose.connection.readyState === 1 ? "ok" : "database-unavailable",
      },
    })
);
publicRouter.get("/cities", async (_req, res) =>
  send(
    res,
    await City.find({ publicationStatus: "published", catalogReady: {$ne:false} })
      .sort({ name: 1 })
      .limit(200)
      .lean()
  )
);
publicRouter.get("/cities/:cityId", async (req, res) =>
  send(res, await cityOr404(req.params.cityId))
);
publicRouter.get("/categories", async (req, res) => {
  const q = { active: true };
  if (req.query.cityId) {
    await cityOr404(req.query.cityId);
    q.$or = [{ cities: req.query.cityId }, { cities: { $size: 0 } }];
  }
  send(res, await Category.find(q).sort({ sortOrder: 1, name: 1 }).lean());
});
const listQuery = z.object({
  cityId: id,
  q: z.string().max(160).optional(),
  category: id.optional(),
  kind: z.enum(['place','hotel']).optional(),
  tags: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(40).default(20),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().min(1).max(200).default(30),
  budget: z.coerce.number().min(0).max(100000).optional(),
  duration: z.coerce.number().min(5).max(1440).optional(),
  environment: z.enum(["indoor", "outdoor", "mixed"]).optional(),
  family: z.enum(["true", "false"]).optional(),
  age: z.coerce.number().min(0).max(120).optional(),
  sort: z
    .enum(["relevance", "distance", "title", "price"])
    .default("relevance"),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  openNow: z.enum(["true", "false"]).optional(),
});
export function activityFilter(p) {
  const q = { ...visible(), cityId: p.cityId };
  if (p.q) q.$text = { $search: p.q };
  if (p.category) q.categories = p.category;
  if (p.tags) q.tags = p.tags;
  if (p.kind) q.kind = p.kind === 'hotel' ? 'hotel' : {$ne:'hotel'};
  if (p.budget !== undefined) {
    q["priceInformation.known"] = true;
    q["priceInformation.adult"] = { $lte: p.budget };
  }
  if (p.duration) q["estimatedDuration.max"] = { $lte: p.duration };
  if (p.environment) q.environment = { $in: [p.environment, "mixed"] };
  if (p.family === "true") q.audience = "family";
  if (p.age !== undefined)
    q.$and = [
      {
        $or: [
          { "ageSuitability.min": { $exists: false } },
          { "ageSuitability.min": { $lte: p.age } },
        ],
      },
      {
        $or: [
          { "ageSuitability.max": { $exists: false } },
          { "ageSuitability.max": { $gte: p.age } },
        ],
      },
    ];
  if ((p.lat === undefined) !== (p.lon === undefined))
    throw Object.assign(new Error("Supply both latitude and longitude"), {
      status: 400,
    });
  if (p.lat !== undefined)
    q.coordinates = {
      $geoWithin: { $centerSphere: [[p.lon, p.lat], p.radiusKm / 6371] },
    };
  if (p.sort === "distance" && p.lat === undefined)
    throw Object.assign(
      new Error("A starting location is needed to sort by distance"),
      { status: 400 }
    );
  return q;
}
for (const [path, Model] of [
  ["activities", Activity],
  ["hotels", Activity],
  ["events", Event],
]) {
  publicRouter.get(`/${path}`, async (req, res) => {
    const p = listQuery.parse(req.query);
    const city = await cityOr404(p.cityId);
    const q = activityFilter(p);
    if (path === 'hotels') q.kind = 'hotel';
    if (path === "events") {
      q.eventStatus = upcoming().eventStatus;
      q.$and = [...(q.$and || []), ...upcoming().$and];
      if (p.from || p.to)
        q.startAt = {
          ...(p.from ? { $gte: new Date(p.from) } : {}),
          ...(p.to ? { $lte: new Date(p.to) } : {}),
        };
    }
    if (p.openNow === "true") {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: city.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date());
      const get = (t) => parts.find((v) => v.type === t).value;
      const day = new Date(
          `${get("year")}-${get("month")}-${get("day")}T12:00:00Z`
        ).getUTCDay(),
        time = `${get("hour")}:${get("minute")}`;
      q["operatingHours.verified"] = true;
      q["operatingHours.validUntil"] = { $gt: new Date() };
      q["operatingHours.timezone"] = city.timezone;
      // Only same-day intervals are advertised as open now; overnight uncertainty stays excluded.
      q["operatingHours.weekly"] = {
        $elemMatch: { day, open: { $lte: time }, close: { $gt: time } },
      };
    }
    const skip = (p.page - 1) * p.limit;
    let data, total;
    if (p.sort === "distance") {
      if (p.q)
        throw Object.assign(
          new Error(
            "Distance sort and text relevance cannot be combined. Clear the search or use relevance."
          ),
          { status: 400 }
        );
      delete q.coordinates;
      const aggregate = await Model.aggregate([
        {
          $geoNear: {
            near: { type: "Point", coordinates: [p.lon, p.lat] },
            distanceField: "distanceMeters",
            maxDistance: p.radiusKm * 1000,
            spherical: true,
            query: {
              ...q,
              cityId: new mongoose.Types.ObjectId(p.cityId),
              ...(p.category
                ? { categories: new mongoose.Types.ObjectId(p.category) }
                : {}),
            },
          },
        },
        {
          $facet: {
            data: [{ $skip: skip }, { $limit: p.limit }],
            count: [{ $count: "total" }],
          },
        },
      ]);
      data = aggregate[0].data;
      total = aggregate[0].count[0]?.total || 0;
    } else {
      const sort =
        p.sort === "title"
          ? { title: 1, _id: 1 }
          : p.sort === "price"
          ? { "priceInformation.adult": 1, _id: 1 }
          : p.q
          ? { score: { $meta: "textScore" }, _id: 1 }
          : path === "events"
          ? { startAt: 1, _id: 1 }
          : { qualityScore: -1, updatedAt: -1, _id: 1 };
      [data, total] = await Promise.all([
        Model.find(q, p.q ? { score: { $meta: "textScore" } } : {})
          .sort(sort)
          .skip(skip)
          .limit(p.limit)
          .lean(),
        Model.countDocuments(q),
      ]);
    }
    send(res, data, {
      page: p.page,
      limit: p.limit,
      total,
      hasMore: skip + data.length < total,
    });
  });
  publicRouter.get(`/${path}/:id`, async (req, res) => {
    id.parse(req.params.id);
    const data = await Model.findOne({
      _id: req.params.id,
      ...visible(),
      ...(path === "events" ? upcoming() : {}),
    }).lean();
    if (!data)
      throw Object.assign(new Error("This experience is no longer available"), {
        status: 404,
      });
    await cityOr404(String(data.cityId));
    send(res, data);
  });
}
publicRouter.get("/collections", async (req, res) => {
  await cityOr404(req.query.cityId);
  send(
    res,
    await Collection.find({
      cityId: req.query.cityId,
      publicationStatus: "published",
    })
      .sort({ sortOrder: 1 })
      .limit(100)
      .lean()
  );
});
publicRouter.get("/collections/:id", async (req, res) => {
  id.parse(req.params.id);
  const collection = await Collection.findOne({
    _id: req.params.id,
    publicationStatus: "published",
  }).lean();
  if (!collection)
    throw Object.assign(new Error("Collection unavailable"), { status: 404 });
  await cityOr404(String(collection.cityId));
  send(res, {
    ...collection,
    items: await Activity.find({
      _id: { $in: collection.activities },
      cityId: collection.cityId,
      ...visible(),
    })
      .limit(200)
      .lean(),
  });
});
publicRouter.get("/cities/:cityId/home", async (req, res) => {
  const city = await cityOr404(req.params.cityId);
  const sections = await Promise.all(
    (city.homeSections || [])
      .filter((s) => s.visible)
      .sort((a, b) => a.order - b.order)
      .map(async (s) => {
        let items = [];
        if (s.type === "events")
          items = await Event.find({
            cityId: city._id,
            ...visible(),
            ...upcoming(),
          })
            .sort({ startAt: 1 })
            .limit(8)
            .lean();
        else if (s.type === "collection") {
          const c = await Collection.findOne({
            _id: s.collectionId,
            cityId: city._id,
            publicationStatus: "published",
          }).lean();
          if (c)
            items = await Activity.find({
              cityId: city._id,
              _id: { $in: c.activities },
              ...visible(),
            })
              .limit(12)
              .lean();
        } else if (s.type !== "recommendations")
          items = await Activity.find({
            cityId: city._id,
            ...visible(),
            ...(s.tags?.length ? { tags: { $in: s.tags } } : {}),
            ...(!s.tags?.includes('hotels') ? {kind:{$ne:'hotel'}} : {}),
          })
            .sort({ qualityScore: -1, updatedAt: -1 })
            .limit(8)
            .lean();
        return { ...s, items };
      })
  );
  send(res, { city, sections });
});
async function candidates(input) {
  const city = await cityOr404(input.cityId);
  input.start ??= [city.longitude, city.latitude];
  const query = {
    cityId: city._id,
    kind: {$ne:'hotel'},
    ...visible(),
    coordinates: {
      $geoWithin: { $centerSphere: [input.start, input.radiusKm / 6371] },
    },
    ...(input.stopIds ? { _id: { $in: input.stopIds } } : {}),
  };
  const activities = await Activity.find(query)
    .sort({ lastVerifiedAt: -1, _id: 1 })
    .limit(400)
    .lean();
  return { city, activities };
}
publicRouter.post("/recommendations", async (req, res) => {
  const input = planning.parse(req.body);
  const { city, activities } = await candidates(input);
  const matches = rankActivities(
    activities,
    input,
    city.recommendationWeights
  ).filter(
    (r) =>
      hoursStatus(
        r.activity,
        input.date,
        Number(input.startTime.slice(0, 2)) * 60 +
          Number(input.startTime.slice(3)),
        r.activity.estimatedDuration?.max ?? 90
      ) !== "closed"
  );
  send(res, matches.slice(0, 20));
});
for (const mode of ["generate", "recalculate"])
  publicRouter.post(`/itineraries/${mode}`, async (req, res) => {
    const input = planning.parse(req.body);
    if (mode === "recalculate" && !input.stopIds)
      throw Object.assign(new Error("Stop identifiers are required"), {
        status: 400,
      });
    const { city, activities } = await candidates(input);
    send(res, {
      ...generatePlan(
        activities,
        input,
        city.recommendationWeights,
        mode === "recalculate"
      ),
      timezone: city.timezone,
      cityName: city.name,
    });
  });
publicRouter.get("/app/version", async (req, res) => {
  const current = z.coerce
    .number()
    .int()
    .min(1)
    .parse(req.query.currentVersionCode || 1);
  const v = (await AppVersion.findOne({
    platform: "android",
    $or: [
      { effectiveAt: { $exists: false } },
      { effectiveAt: { $lte: new Date() } },
    ],
  }).lean()) || {
    platform: "android",
    latestVersionCode: 1,
    minimumVersionCode: 1,
    updatePolicy: "optional",
    releaseNotes: [],
    storeUrl: null,
  };
  send(res, {
    ...v,
    updateAvailable: v.latestVersionCode > current,
    updateRequired: current < v.minimumVersionCode,
  });
});
