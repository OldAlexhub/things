import mongoose from "mongoose";
const { Schema } = mongoose;
const options = {
  timestamps: true,
  strict: "throw",
  toJSON: {
    virtuals: true,
    transform: (_doc, obj) => {
      delete obj.__v;
      return obj;
    },
  },
};
const ref = (name, required = false) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required,
});
const status = {
  type: String,
  enum: ["draft", "published", "unpublished", "archived"],
  default: "draft",
  index: true,
};
const image = new Schema(
  {
    url: String,
    alt: String,
    credit: String,
    license: String,
    sourceUrl: String,
  },
  { _id: false }
);
const point = new Schema(
  {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], required: true },
  },
  { _id: false }
);
const model = (name, definition, indexes = []) => {
  const s = new Schema(definition, options);
  for (const [keys, opts] of indexes) s.index(keys, opts);
  return mongoose.model(name, s);
};
export const City = model("City", {
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  state: String,
  country: String,
  timezone: { type: String, required: true },
  latitude: Number,
  longitude: Number,
  geographicBounds: [Number],
  catalogReady: { type: Boolean, default: true },
  description: String,
  heroImage: image,
  thumbnailImage: image,
  gallery: [image],
  theme: { accent: String, background: String },
  supportedFeatures: [String],
  publicationStatus: status,
  publishedAt: Date,
  homeSections: [
    {
      key: String,
      title: String,
      type: {
        type: String,
        enum: ["activities", "events", "collection", "recommendations"],
      },
      collectionId: ref("Collection"),
      tags: [String],
      visible: Boolean,
      order: Number,
    },
  ],
  planTemplates: [
    {
      key: String,
      title: String,
      description: String,
      defaults: Schema.Types.Mixed,
    },
  ],
  recommendationWeights: {
    interest: { type: Number, default: 30 },
    budget: { type: Number, default: 25 },
    distance: { type: Number, default: 20 },
    time: { type: Number, default: 15 },
    novelty: { type: Number, default: 10 },
  },
  map: {
    tileUrl: {
      type: String,
      default: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    },
    attribution: { type: String, default: "© OpenStreetMap contributors" },
  },
});
export const Category = model("Category", {
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  description: String,
  icon: String,
  coverImage: image,
  sortOrder: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
  cities: [ref("City")],
  parentId: ref("Category"),
  activityTypes: [String],
  kind: {
    type: String,
    enum: ["primary", "audience", "budget", "theme"],
    default: "primary",
  },
});
const activity = {
  kind: { type: String, enum: ['place', 'hotel'], default: 'place' },
  cityId: ref("City", true),
  title: { type: String, required: true },
  qualityScore: { type: Number, default: 0, index: true },
  slug: { type: String, required: true },
  description: String,
  shortDescription: String,
  categories: [ref("Category")],
  tags: [String],
  audience: [String],
  ageSuitability: { min: Number, max: Number },
  location: { address: String, neighborhood: String },
  coordinates: point,
  images: [image],
  estimatedDuration: { min: Number, max: Number },
  priceInformation: {
    known: { type: Boolean, default: false },
    adult: Number,
    child: Number,
    childBands: [{ _id: false, minAge: Number, maxAge: Number, amount: Number }],
    currency: { type: String, default: "USD" },
    perGroup: Boolean,
    note: String,
  },
  operatingHours: {
    verified: { type: Boolean, default: false },
    timezone: String,
    weekly: [{ day: Number, open: String, close: String }],
    validUntil: Date,
  },
  officialWebsite: String,
  bookingUrl: String,
  source: { type: String, default: "manual" },
  sourceUrl: String,
  externalId: String,
  lastSyncedAt: Date,
  lastVerifiedAt: Date,
  expiresAt: Date,
  verificationStatus: {
    type: String,
    enum: ["unverified", "verified", "needs-review"],
    default: "unverified",
  },
  publicationStatus: status,
  environment: {
    type: String,
    enum: ["indoor", "outdoor", "mixed", "unknown"],
    default: "unknown",
  },
  accessibility: String,
  parking: String,
  reservationRequired: Boolean,
  seasonalNote: String,
  weatherSuitability: [String],
};
const activityIndexes = [
  [{ cityId: 1, publicationStatus: 1 }],
  [{ cityId: 1, categories: 1 }],
  [{ coordinates: "2dsphere" }],
  [{ title: "text", description: "text", tags: "text" }],
  [
    { source: 1, externalId: 1 },
    {
      unique: true,
      partialFilterExpression: { externalId: { $type: "string" } },
    },
  ],
  [{ cityId: 1, slug: 1 }, { unique: true }],
];
export const Activity = model("Activity", activity, activityIndexes);
export const Event = model(
  "Event",
  {
    ...activity,
    venue: String,
    allDay: Boolean,
    startAt: { type: Date, required: true },
    endAt: Date,
    timezone: String,
    eventStatus: {
      type: String,
      enum: ["scheduled", "cancelled", "rescheduled", "postponed"],
      default: "scheduled",
    },
    ticketInformation: String,
  },
  [...activityIndexes, [{ cityId: 1, startAt: 1, eventStatus: 1 }]]
);
export const Collection = model("Collection", {
  cityId: ref("City", true),
  title: { type: String, required: true },
  qualityScore: { type: Number, default: 0, index: true },
  slug: String,
  description: String,
  coverImage: image,
  activities: [ref("Activity")],
  tags: [String],
  publicationStatus: status,
  sortOrder: Number,
});
export const MediaAsset = model("MediaAsset", {
  url: String,
  filename: String,
  mime: String,
  width: Number,
  height: Number,
  alt: String,
  credit: String,
  license: String,
  sourceUrl: String,
});
export const ContentSource = model("ContentSource", {
  name: { type: String, unique: true },
  enabled: { type: Boolean, default: false },
  permissionReviewed: { type: Boolean, default: false },
  license: String,
  attribution: String,
  termsUrl: String,
  retentionHours: { type: Number, default: 24 },
  intervalMinutes: { type: Number, default: 360 },
  lastSuccessfulSync: Date,
});
export const EventFeed=model('EventFeed',{
  cityId:ref('City',true),name:{type:String,required:true},url:{type:String,required:true},sourceUrl:String,
  enabled:{type:Boolean,default:true},permissionReviewed:{type:Boolean,default:false},
},[[{cityId:1,url:1},{unique:true}]]);
export const Mention=model('Mention',{
  url:{type:String,unique:true},source:String,author:String,excerpt:String,postedAt:Date,
  likes:Number,reposts:Number,lastSeenAt:Date,hidden:{type:Boolean,default:false},expireAt:Date,
},[[{expireAt:1},{expireAfterSeconds:0}]]);
export const MentionCheck=model('MentionCheck',{
  source:{type:String,unique:true},checkedAt:Date,lastSuccessAt:Date,status:String,message:String,found:Number,
});
export const SyncJob = model("SyncJob", {
  key: { type: String, unique: true },
  source: String,
  cityId: ref("City"),
  nextRunAt: Date,
  lockedUntil: Date,
  leaseToken: String,
  attempts: { type: Number, default: 0 },
  lastError: String,
});
export const SyncLog = model(
  "SyncLog",
  {
    source: String,
    cityId: ref("City"),
    startedAt: Date,
    completedAt: Date,
    status: String,
    recordsReceived: Number,
    recordsInserted: Number,
    recordsUpdated: Number,
    recordsSkipped: Number,
    errors: [String],
    lastSuccessfulSync: Date,
    expireAt: Date,
  },
  [[{ expireAt: 1 }, { expireAfterSeconds: 0 }]]
);
export const AppVersion = model("AppVersion", {
  platform: { type: String, default: "android", unique: true },
  latestVersionCode: { type: Number, default: 1 },
  minimumVersionCode: { type: Number, default: 1 },
  updatePolicy: {
    type: String,
    enum: ["optional", "recommended", "required"],
    default: "optional",
  },
  releaseNotes: [String],
  announcement: String,
  effectiveAt: Date,
  storeUrl: String,
});
export const AdminUser = model("AdminUser", {
  email: { type: String, unique: true },
  passwordHash: { type: String, select: false },
  role: { type: String, enum: ["admin", "editor"], default: "admin" },
  active: { type: Boolean, default: true },
});
export const AdminSession = model(
  "AdminSession",
  {
    tokenHash: { type: String, unique: true },
    userId: ref("AdminUser", true),
    csrf: String,
    expiresAt: Date,
  },
  [[{ expiresAt: 1 }, { expireAfterSeconds: 0 }]]
);
export const AdminAuditLog = model(
  "AdminAuditLog",
  {
    userId: ref("AdminUser"),
    action: String,
    resource: String,
    resourceId: String,
    changedFields: [String],
    expireAt: Date,
  },
  [[{ expireAt: 1 }, { expireAfterSeconds: 0 }]]
);
export const resources = {
  cities: City,
  categories: Category,
  activities: Activity,
  events: Event,
  collections: Collection,
  media: MediaAsset,
  sources: ContentSource,
  feeds: EventFeed,
  versions: AppVersion,
};
