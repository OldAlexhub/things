import {qualityScore} from "../services/photography.js";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import multer from "multer";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import {
  resources,
  AdminUser,
  AdminSession,
  AdminAuditLog,
  SyncLog,
  SyncJob,
  City,
  Category,
  Activity,
  Collection,
  MediaAsset,
} from "../models/index.js";
import {
  requireAdmin,
  adminOnly,
  verifyPassword,
  createSession,
} from "../lib/auth.js";
import { id, validateRecord, schemas } from "../lib/validation.js";
import { triggerSync } from "../services/sync.js";
export const adminRouter = Router();
const loginLimit = rateLimit({
  windowMs: 15 * 60000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
adminRouter.post("/login", loginLimit, async (req, res) => {
  const { email, password } = z
    .object({ email: z.email().max(254), password: z.string().min(1).max(256) })
    .parse(req.body);
  const user = await AdminUser.findOne({
    email: email.toLowerCase(),
    active: true,
  }).select("+passwordHash");
  if (!(await verifyPassword(password, user?.passwordHash)))
    return res
      .status(401)
      .json({ error: { message: "Email or password is incorrect" } });
  res.json({ data: await createSession(user, res) });
});
adminRouter.use(requireAdmin);
adminRouter.get("/session", (req, res) =>
  res.json({
    data: {
      email: req.admin.email,
      role: req.admin.role,
      csrf: req.adminSession.csrf,
    },
  })
);
adminRouter.post("/logout", async (req, res) => {
  await AdminSession.deleteOne({ _id: req.adminSession._id });
  res.clearCookie("ttd_session", {
    path: "/api/v1/admin",
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
  res.json({ data: { ok: true } });
});
adminRouter.get("/overview", async (_req, res) => {
  const counts = await Promise.all(
    Object.entries(resources).map(async ([name, Model]) => [
      name,
      await Model.countDocuments(),
    ])
  );
  res.json({
    data: {
      counts: Object.fromEntries(counts),
      jobs: await SyncJob.find().sort({ updatedAt: -1 }).limit(50).lean(),
      logs: await SyncLog.find().sort({ createdAt: -1 }).limit(50).lean(),
      audit: await AdminAuditLog.find()
        .sort({ createdAt: -1 })
        .limit(30)
        .lean(),
    },
  });
});
// Explicit city search only: no keystroke/autocomplete requests to Nominatim.
const cityLookupLimit = rateLimit({windowMs:1100,limit:1,standardHeaders:'draft-8',legacyHeaders:false});
adminRouter.get('/city-lookup',cityLookupLimit,async(req,res)=>{
  const q=z.string().trim().min(3).max(120).parse(req.query.q);
  const response=await fetch('https://nominatim.openstreetmap.org/search?'+new URLSearchParams({q,format:'jsonv2',addressdetails:'1',limit:'5',featuretype:'city'}),{headers:{'User-Agent':'ThingsToDo/1.1 (Old Alex Hub; info@oldalexhub.com)'},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Object.assign(new Error('City search is temporarily unavailable. Please try again.'),{status:502});
  const rows=await response.json();
  res.json({data:rows.map(row=>({name:row.name,state:row.address?.state||'',country:row.address?.country||'',latitude:Number(row.lat),longitude:Number(row.lon),geographicBounds:[Number(row.boundingbox[0]),Number(row.boundingbox[2]),Number(row.boundingbox[1]),Number(row.boundingbox[3])],label:row.display_name}))});
});
async function audit(req, action, resource, resourceId, fields = []) {
  await AdminAuditLog.create({
    userId: req.admin._id,
    action,
    resource,
    resourceId,
    changedFields: fields,
    expireAt: new Date(Date.now() + 90 * 86400000),
  });
}
adminRouter.post("/sync", adminOnly, async (req, res) => {
  const { source, cityId } = z
    .object({ source: z.literal("osm"), cityId: id })
    .parse(req.body);
  await triggerSync(source, cityId);
  await audit(req, "sync", source, cityId);
  res.status(202).json({ data: { message: "Synchronization queued" } });
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 4 },
});
adminRouter.post("/media/upload", upload.single("image"), async (req, res) => {
  if (!req.file)
    throw Object.assign(new Error("Choose a JPEG, PNG or WebP image"), {
      status: 400,
    });
  const meta = z
    .object({
      alt: z.string().min(1).max(300),
      credit: z.string().min(1).max(300),
      license: z.string().min(1).max(200),
      sourceUrl: z.url().optional(),
    })
    .parse(req.body);
  const decoder = sharp(req.file.buffer, { limitInputPixels: 40000000 });
  const source = await decoder.metadata();
  if (!["jpeg", "png", "webp"].includes(source.format))
    throw Object.assign(
      new Error("Only JPEG, PNG and WebP images are supported"),
      { status: 400 }
    );
  const dir = path.resolve(process.env.UPLOAD_DIR || "uploads");
  await mkdir(dir, { recursive: true });
  const filename = `${randomUUID()}.webp`;
  const info = await decoder
    .rotate()
    .resize({
      width: 2000,
      height: 2000,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 85 })
    .toFile(path.join(dir, filename));
  const item = await MediaAsset.create({
    ...meta,
    filename,
    url: `${
      process.env.PUBLIC_URL || "http://localhost:3000"
    }/uploads/${filename}`,
    mime: "image/webp",
    width: info.width,
    height: info.height,
  });
  await audit(req, "upload", "media", String(item._id));
  res.status(201).json({ data: item });
});
async function validateRefs(kind, data) {
  if (data.cityId && !(await City.exists({ _id: data.cityId })))
    throw Object.assign(new Error("City does not exist"), { status: 400 });
  if (data.cityId && data.operatingHours?.verified) {
    const city = await City.findById(data.cityId).select("timezone").lean();
    if (data.operatingHours.timezone !== city.timezone)
      throw Object.assign(
        new Error("Verified operating hours must use the city timezone"),
        { status: 400 }
      );
  }
  if (
    data.categories?.length &&
    (await Category.countDocuments({ _id: { $in: data.categories } })) !==
      new Set(data.categories).size
  )
    throw Object.assign(new Error("A category does not exist"), {
      status: 400,
    });
  if (
    data.activities?.length &&
    (await Activity.countDocuments({
      _id: { $in: data.activities },
      cityId: data.cityId,
    })) !== new Set(data.activities).size
  )
    throw Object.assign(
      new Error("Collection activities must belong to this city"),
      { status: 400 }
    );
  if (data.homeSections)
    for (const s of data.homeSections)
      if (s.collectionId && !(await Collection.exists({ _id: s.collectionId })))
        throw Object.assign(new Error("A homepage collection does not exist"), {
          status: 400,
        });
}
adminRouter.param("resource", (req, res, next, value) => {
  if (!resources[value])
    return res.status(404).json({ error: { message: "Unknown resource" } });
  if (["sources", "versions"].includes(value) && req.admin.role !== "admin")
    return res
      .status(403)
      .json({ error: { message: "Administrator access required" } });
  req.resourceModel = resources[value];
  next();
});
adminRouter.get("/:resource", async (req, res) => {
  const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(1000)
      .parse(req.query.page || 1),
    q = {};
  if (req.query.cityId) q.cityId = id.parse(req.query.cityId);
  const [data, total] = await Promise.all([
    req.resourceModel
      .find(q)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * 50)
      .limit(50)
      .lean(),
    req.resourceModel.countDocuments(q),
  ]);
  res.json({ data, meta: { page, total, hasMore: page * 50 < total } });
});
adminRouter.post("/:resource", async (req, res) => {
  if (req.params.resource === "media")
    return res.status(400).json({ error: { message: "Use image upload" } });
  const data = validateRecord(req.params.resource, req.body);
  await validateRefs(req.params.resource, data);
  if (["activities", "events"].includes(req.params.resource)) data.qualityScore = qualityScore(data);
  if (
    req.params.resource === "cities" &&
    data.publicationStatus === "published"
  )
    data.publishedAt = new Date();
  const item = await req.resourceModel.create(data);
  if(req.params.resource === 'cities' && data.publicationStatus === 'published') await triggerSync('osm',String(item._id)).catch(()=>{});
  await audit(
    req,
    "create",
    req.params.resource,
    String(item._id),
    Object.keys(data)
  );
  res.status(201).json({ data: item });
});
adminRouter.put("/:resource/:id", async (req, res) => {
  id.parse(req.params.id);
  if (req.params.resource === "media")
    throw Object.assign(new Error("Upload a new image to replace media"), {
      status: 400,
    });
  const data = validateRecord(req.params.resource, req.body);
  await validateRefs(req.params.resource, data);
  if (["activities", "events"].includes(req.params.resource)) data.qualityScore = qualityScore(data);
  if (
    req.params.resource === "cities" &&
    data.publicationStatus === "published"
  )
    data.publishedAt = new Date();
  const unset = Object.fromEntries(
    Object.keys(schemas[req.params.resource].shape)
      .filter((key) => !(key in data))
      .map((key) => [key, 1])
  );
  const item = await req.resourceModel.findOneAndUpdate(
    { _id: req.params.id },
    { $set: data, $unset: unset },
    { returnDocument: "after", runValidators: true }
  );
  if (!item)
    throw Object.assign(new Error("Record not found"), { status: 404 });
  await audit(
    req,
    "update",
    req.params.resource,
    req.params.id,
    Object.keys(data)
  );
  res.json({ data: item });
});
adminRouter.delete("/:resource/:id", adminOnly, async (req, res) => {
  id.parse(req.params.id);
  const resource = req.params.resource,
    item = await req.resourceModel.findById(req.params.id);
  if (!item)
    throw Object.assign(new Error("Record not found"), { status: 404 });
  if (["cities", "activities", "events", "collections"].includes(resource)) {
    item.publicationStatus = "archived";
    await item.save();
  } else if (resource === "categories") {
    item.active = false;
    await item.save();
  } else if (resource === "media") {
    const query = {
      $or: [
        { "images.url": item.url },
        { "heroImage.url": item.url },
        { "thumbnailImage.url": item.url },
        { "gallery.url": item.url },
        { "coverImage.url": item.url },
      ],
    };
    const used = await Promise.all(
      ["cities", "categories", "activities", "events", "collections"].map((k) =>
        resources[k].exists(query)
      )
    );
    if (used.some(Boolean))
      throw Object.assign(
        new Error("Remove references to this image before deleting it"),
        { status: 409 }
      );
    if (item.filename && /^[a-f0-9-]+\.webp$/.test(item.filename))
      await unlink(
        path.join(
          path.resolve(process.env.UPLOAD_DIR || "uploads"),
          item.filename
        )
      ).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
    await item.deleteOne();
  } else
    throw Object.assign(
      new Error("Disable this record instead of deleting it"),
      { status: 400 }
    );
  await audit(req, "archive-or-delete", resource, req.params.id);
  res.json({ data: { ok: true } });
});
