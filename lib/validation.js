import { z } from "zod";
export const id = z.string().regex(/^[a-f\d]{24}$/i, "Invalid identifier");
const text = z.string().trim().max(2000);
const title = z.string().trim().min(1).max(160);
const url = z
  .string()
  .url()
  .max(2000)
  .refine(
    (v) =>
      v.startsWith("https://") ||
      (process.env.NODE_ENV !== "production" &&
        /^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(v)),
    "Use an HTTPS URL"
  );
const imageUrl = z.union([
  url,
  z.string().regex(/^\/(?:uploads|city)\/[a-zA-Z0-9._-]+$/),
]);
const image = z
  .object({
    url: imageUrl,
    alt: text,
    credit: text,
    license: text,
    sourceUrl: url.optional(),
  })
  .strict();
const status = z.enum(["draft", "published", "unpublished", "archived"]);
const point = z.object({
  type: z.literal("Point"),
  coordinates: z.tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
  ]),
});
const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(180);
const timezone = z.string().refine((v) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: v });
    return true;
  } catch {
    return false;
  }
}, "Invalid IANA timezone");
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const date = z.iso.datetime();
const money = z.number().min(0).max(1000000);
const activity = z
  .object({
    cityId: id,
    title,
    slug,
    description: text.optional(),
    shortDescription: z.string().max(300).optional(),
    categories: z.array(id).max(20).default([]),
    tags: z.array(title).max(30).default([]),
    audience: z.array(title).max(20).default([]),
    ageSuitability: z
      .object({
        min: z.number().min(0).max(120).optional(),
        max: z.number().min(0).max(120).optional(),
      })
      .optional(),
    location: z
      .object({ address: text.optional(), neighborhood: title.optional() })
      .optional(),
    coordinates: point.optional(),
    images: z.array(image).max(15).default([]),
    estimatedDuration: z
      .object({
        min: z.number().int().min(5).max(1440),
        max: z.number().int().min(5).max(1440),
      })
      .optional(),
    priceInformation: z
      .object({
        known: z.boolean(),
        adult: money.optional(),
        child: money.optional(),
        currency: z.literal("USD").default("USD"),
        perGroup: z.boolean().default(false),
        note: text.optional(),
      })
      .default({ known: false, currency: "USD", perGroup: false }),
    operatingHours: z
      .object({
        verified: z.boolean(),
        timezone,
        weekly: z
          .array(
            z.object({
              day: z.number().int().min(0).max(6),
              open: clock,
              close: clock,
            })
          )
          .max(28),
        validUntil: date,
      })
      .optional(),
    officialWebsite: url.optional(),
    bookingUrl: url.optional(),
    source: title.default("manual"),
    sourceUrl: url.optional(),
    externalId: title.optional(),
    lastVerifiedAt: date.optional(),
    verificationStatus: z
      .enum(["unverified", "verified", "needs-review"])
      .default("unverified"),
    publicationStatus: status.default("draft"),
    environment: z
      .enum(["indoor", "outdoor", "mixed", "unknown"])
      .default("unknown"),
    accessibility: text.optional(),
    parking: text.optional(),
    reservationRequired: z.boolean().optional(),
    seasonalNote: text.optional(),
    weatherSuitability: z.array(title).max(10).default([]),
  })
  .strict();
export const schemas = {
  cities: z
    .object({
      name: title,
      slug,
      state: title,
      country: title,
      timezone,
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      geographicBounds: z
        .tuple([z.number(), z.number(), z.number(), z.number()])
        .optional(),
      description: text,
      heroImage: image.optional(),
      thumbnailImage: image.optional(),
      gallery: z.array(image).max(15).default([]),
      publicationStatus: status.default("draft"),
      theme: z
        .object({
          accent: z.string().regex(/^#[a-f\d]{6}$/i),
          background: z.string().regex(/^#[a-f\d]{6}$/i),
        })
        .optional(),
      supportedFeatures: z
        .array(z.enum(["events", "planning", "maps", "nearby"]))
        .default([]),
      homeSections: z
        .array(
          z.object({
            key: slug,
            title,
            type: z.enum([
              "activities",
              "events",
              "collection",
              "recommendations",
            ]),
            collectionId: id.optional(),
            tags: z.array(title).max(20).default([]),
            visible: z.boolean(),
            order: z.number().int(),
          })
        )
        .max(30)
        .default([]),
      planTemplates: z
        .array(
          z
            .object({
              key: slug,
              title,
              description: text.optional(),
              defaults: z
                .object({
                  startTime: clock.optional(),
                  endTime: clock.optional(),
                  budget: money.optional(),
                  strictBudget: z.boolean().optional(),
                  transport: z
                    .enum(["walking", "cycling", "driving", "transit"])
                    .optional(),
                  environment: z.enum(["any", "indoor", "outdoor"]).optional(),
                  weather: z
                    .enum(["any", "dry", "rain", "heat", "cold"])
                    .optional(),
                  pace: z.enum(["relaxed", "balanced", "active"]).optional(),
                  meals: z.boolean().optional(),
                  radiusKm: z.number().min(1).max(200).optional(),
                  interests: z.array(id).max(20).optional(),
                })
                .strict(),
            })
            .strict()
        )
        .max(20)
        .default([]),
      recommendationWeights: z
        .object({
          interest: z.number().min(0).max(100),
          budget: z.number().min(0).max(100),
          distance: z.number().min(0).max(100),
          time: z.number().min(0).max(100),
          novelty: z.number().min(0).max(100),
        })
        .optional(),
      map: z
        .object({
          tileUrl: z
            .string()
            .max(500)
            .refine(
              (v) =>
                v.startsWith("https://") &&
                v.includes("{z}") &&
                v.includes("{x}") &&
                v.includes("{y}")
            ),
          attribution: title,
        })
        .optional(),
    })
    .strict(),
  categories: z
    .object({
      name: title,
      slug,
      description: text.optional(),
      icon: title.default("Compass"),
      coverImage: image.optional(),
      sortOrder: z.number().int().default(0),
      active: z.boolean().default(true),
      cities: z.array(id).max(500).default([]),
      parentId: id.optional(),
      activityTypes: z.array(title).default([]),
      kind: z
        .enum(["primary", "audience", "budget", "theme"])
        .default("primary"),
    })
    .strict(),
  activities: activity,
  events: activity.extend({
    venue: title.optional(),
    startAt: date,
    endAt: date.optional(),
    timezone,
    eventStatus: z
      .enum(["scheduled", "cancelled", "rescheduled", "postponed"])
      .default("scheduled"),
    ticketInformation: text.optional(),
  }),
  collections: z
    .object({
      cityId: id,
      title,
      slug,
      description: text.optional(),
      coverImage: image.optional(),
      activities: z.array(id).max(200).default([]),
      tags: z.array(title).max(30).default([]),
      publicationStatus: status.default("draft"),
      sortOrder: z.number().int().default(0),
    })
    .strict(),
  sources: z
    .object({
      name: z.literal("osm"),
      enabled: z.boolean(),
      permissionReviewed: z.boolean(),
      license: title,
      attribution: title,
      termsUrl: url,
      retentionHours: z.number().int().min(1).max(8760),
      intervalMinutes: z.number().int().min(60).max(43200),
    })
    .strict(),
  versions: z
    .object({
      platform: z.literal("android"),
      latestVersionCode: z.number().int().min(1),
      minimumVersionCode: z.number().int().min(1),
      updatePolicy: z.enum(["optional", "recommended", "required"]),
      releaseNotes: z.array(title).max(20),
      announcement: text.optional(),
      effectiveAt: date.optional(),
      storeUrl: z
        .string()
        .refine(
          (v) =>
            v ===
            "https://play.google.com/store/apps/details?id=com.oldalexhub.thingstodo"
        )
        .optional(),
    })
    .strict(),
};
export const planning = z
  .object({
    cityId: id,
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (v) =>
          !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v
      ),
    startTime: clock.default("09:00"),
    endTime: clock.default("18:00"),
    budget: money.default(100),
    strictBudget: z.boolean().default(true),
    adults: z.number().int().min(1).max(30).default(1),
    childAges: z.array(z.number().int().min(0).max(17)).max(20).default([]),
    start: z
      .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
      .optional(),
    transport: z
      .enum(["walking", "cycling", "driving", "transit"])
      .default("driving"),
    interests: z.array(id).max(20).default([]),
    environment: z.enum(["any", "indoor", "outdoor"]).default("any"),
    pace: z.enum(["relaxed", "balanced", "active"]).default("balanced"),
    meals: z.boolean().default(true),
    radiusKm: z.number().min(1).max(200).default(30),
    mode: z.enum(["local", "tourist"]).default("tourist"),
    weather: z.enum(["any", "dry", "rain", "heat", "cold"]).default("any"),
    visited: z.array(id).max(500).default([]),
    exclude: z.array(id).max(200).default([]),
    stopIds: z.array(id).max(15).optional(),
  })
  .strict();
export function validateRecord(kind, input) {
  const data = schemas[kind].parse(input);
  if (data.ageSuitability?.min > data.ageSuitability?.max)
    throw Object.assign(new Error("Minimum age exceeds maximum age"), {
      status: 400,
    });
  if (data.estimatedDuration?.min > data.estimatedDuration?.max)
    throw Object.assign(
      new Error("Minimum duration exceeds maximum duration"),
      { status: 400 }
    );
  if (data.priceInformation?.known && data.priceInformation.adult == null)
    throw Object.assign(
      new Error("A known price requires an adult or group price"),
      { status: 400 }
    );
  if (data.endAt && data.endAt <= data.startAt)
    throw Object.assign(new Error("Event end must be after its start"), {
      status: 400,
    });
  if (kind === "versions" && data.minimumVersionCode > data.latestVersionCode)
    throw Object.assign(new Error("Minimum version exceeds latest version"), {
      status: 400,
    });
  if (kind === "sources" && data.enabled && !data.permissionReviewed)
    throw Object.assign(
      new Error("Review provider permissions before enabling"),
      { status: 400 }
    );
  return data;
}
