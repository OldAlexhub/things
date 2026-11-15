import {qualityScore, cachePhoto} from "./photography.js";
import { randomUUID } from "node:crypto";
import {
  Activity,
  Event,
  City,
  Category,
  ContentSource,
  SyncJob,
  SyncLog,
} from "../models/index.js";
import { providers } from "./providers.js";
export async function triggerSync(source, cityId) {
  const config = await ContentSource.findOne({
    name: source,
    enabled: true,
    permissionReviewed: true,
  }).lean();
  if (!config || !providers[source]?.configured())
    throw Object.assign(
      new Error(
        "Provider is disabled or its credentials and permissions have not been configured"
      ),
      { status: 422 }
    );
  if (!(await City.exists({ _id: cityId, publicationStatus: "published" })))
    throw Object.assign(new Error("Publish this city before synchronizing"), {
      status: 422,
    });
  await SyncJob.updateOne(
    { key: `${source}:${cityId}` },
    {
      $set: { source, cityId, nextRunAt: new Date() },
      $setOnInsert: { lockedUntil: new Date(0) },
    },
    { upsert: true }
  );
}
export async function runSyncJob(job, providerOverride) {
  const now = new Date(),
    leaseToken = randomUUID();
  const locked = await SyncJob.findOneAndUpdate(
    {
      _id: job._id,
      $or: [
        { lockedUntil: { $lte: now } },
        { lockedUntil: { $exists: false } },
      ],
    },
    {
      $set: { lockedUntil: new Date(Date.now() + 10 * 60000), leaseToken },
      $inc: { attempts: 1 },
    },
    { returnDocument: "after" }
  ).lean();
  if (!locked) return false;
  const log = await SyncLog.create({
    source: job.source,
    cityId: job.cityId,
    startedAt: now,
    status: "running",
    recordsReceived: 0,
    recordsInserted: 0,
    recordsUpdated: 0,
    recordsSkipped: 0,
    errors: [],
    expireAt: new Date(Date.now() + 30 * 86400000),
  });
  let config;
  try {
    config = await ContentSource.findOne({
      name: job.source,
      enabled: true,
      permissionReviewed: true,
    }).lean();
    const provider = providerOverride || providers[job.source];
    if (!config || !provider?.configured())
      throw new Error("Provider disabled or credentials missing");
    const city = await City.findOne({
      _id: job.cityId,
      publicationStatus: "published",
    }).lean();
    if (!city) throw new Error("City is not published");
    const categories = Object.fromEntries(
      (await Category.find({ active: true }).lean()).map((c) => [c.slug, c._id])
    );
    const records = await provider.fetch(city, categories);
    log.recordsReceived = records.length;
    const Model = provider.model === "Event" ? Event : Activity;
    for (const record of records) {
      if (
        !(await SyncJob.exists({
          _id: job._id,
          leaseToken,
          lockedUntil: { $gt: new Date() },
        }))
      )
        throw new Error("Synchronization lease expired");
      if (!record.externalId || !record.title) {
        log.recordsSkipped++;
        continue;
      }
      const existing = await Model.findOne({
        source: job.source,
        externalId: record.externalId,
      })
        .select("publicationStatus images priceInformation verificationStatus lastVerifiedAt description shortDescription estimatedDuration operatingHours tags environment officialWebsite")
        .lean();
      // Keep an editor's archive/unpublish decision across refreshes.
      if (existing && existing.publicationStatus !== "published")
        record.publicationStatus = existing.publicationStatus;
      if(existing?.images?.length && !record.images?.length) record.images=existing.images;
      if(existing?.verificationStatus === "verified") {
        for(const field of ['images','priceInformation','verificationStatus','lastVerifiedAt','description','shortDescription','estimatedDuration','operatingHours','tags','environment','officialWebsite']) {
          if(existing[field] !== undefined) record[field]=existing[field];
        }
      }
      if(record.images?.length) record.images = await Promise.all(record.images.map(cachePhoto));
      record.qualityScore=qualityScore(record);
      const result = await Model.updateOne(
        { source: job.source, externalId: record.externalId },
        {
          $set: {
            ...record,
            lastSyncedAt: new Date(),
            expiresAt: new Date(Date.now() + config.retentionHours * 3600000),
          },
        },
        { upsert: true, runValidators: true }
      );
      if (result.upsertedCount) log.recordsInserted++;
      else log.recordsUpdated++;
    }
    const hero=records.find(record=>record.images?.length)?.images?.[0];
    if(job.source === 'osm' && records.length) await City.updateOne({_id:job.cityId},{$set:{catalogReady:true}});
    if(hero)await City.updateOne({_id:job.cityId,'heroImage.url':{$exists:false}},{$set:{heroImage:hero}});
    log.status = "success";
    log.lastSuccessfulSync = new Date();
    await ContentSource.updateOne(
      { _id: config._id },
      { $set: { lastSuccessfulSync: log.lastSuccessfulSync } }
    );
    await SyncJob.updateOne(
      { _id: job._id, leaseToken },
      {
        $set: {
          nextRunAt: new Date(Date.now() + config.intervalMinutes * 60000),
          lastError: "",
          attempts: 0,
        },
      }
    );
  } catch (e) {
    log.status = "failed";
    log.errors = [e.message];
    await SyncJob.updateOne(
      { _id: job._id, leaseToken },
      {
        $set: {
          nextRunAt: new Date(
            Date.now() +
              Math.min(360, 5 * 2 ** Math.min(locked.attempts, 6)) * 60000
          ),
          lastError: e.message,
        },
      }
    );
  } finally {
    log.completedAt = new Date();
    await log.save();
    await SyncJob.updateOne(
      { _id: job._id, leaseToken },
      { $set: { lockedUntil: new Date(0) } }
    );
  }
  return log;
}
export async function queuePublishedCitySyncs() {
  if ((process.env.SYNC_ENABLED ?? "true") !== "true") return;
  const [sources, cities] = await Promise.all([
    ContentSource.find({
      name: { $in: Object.keys(providers) },
      enabled: true,
      permissionReviewed: true,
    }).lean(),
    City.find({ publicationStatus: "published" }).select("_id").lean(),
  ]);
  for (const source of sources) {
    if (!providers[source.name].configured()) continue;
    for (const city of cities)
      await SyncJob.updateOne(
        { key: `${source.name}:${city._id}` },
        {
          $setOnInsert: {
            source: source.name,
            cityId: city._id,
            nextRunAt: new Date(),
            lockedUntil: new Date(0),
          },
        },
        { upsert: true }
      );
  }
}

export function startScheduler() {
  let running = false,
    stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      // Retention runs even when imports are disabled. Expired records are also excluded by every public query.
      await Promise.all([
        Activity.deleteMany({
          source: { $ne: "manual" },
          expiresAt: { $lte: new Date() },
        }),
        Event.deleteMany({
          source: { $ne: "manual" },
          expiresAt: { $lte: new Date() },
        }),
      ]);
      await queuePublishedCitySyncs();
      const jobs = await SyncJob.find({
        source: { $in: Object.keys(providers) },
        nextRunAt: { $lte: new Date() },
        lockedUntil: { $lte: new Date() },
      })
        .sort({nextRunAt:1})
        .limit(4)
        .lean();
      for (const job of jobs) {
        if (stopped) break;
        await runSyncJob(job);
      }
    } catch {
      console.error(JSON.stringify({ event: "scheduler_error" }));
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, 60000);
  timer.unref();
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
