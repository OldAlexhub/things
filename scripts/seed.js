import "dotenv/config";
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";
import { connectDatabase } from "../db/connect.js";
import {
  City,
  Category,
  AdminUser,
  ContentSource,
  AppVersion,
  SyncJob,
  EventFeed,
} from "../models/index.js";
import { hashPassword } from "../lib/auth.js";
export async function seed() {
  // Remove obsolete provider configuration, without changing saved editorial content.
  await ContentSource.deleteMany({ name: { $nin: ["osm","calendars"] } });
  await SyncJob.deleteMany({ source: { $nin: ["osm","calendars"] } });
  const city = await City.findOneAndUpdate(
    { slug: "orlando" },
    {
      $setOnInsert: {
        name: "Orlando",
        slug: "orlando",
        state: "Florida",
        country: "USA",
        timezone: "America/New_York",
        latitude: 28.5383,
        longitude: -81.3792,
        geographicBounds: [28.34, -81.62, 28.7, -81.2],
        description:
          "Make room for a different kind of day. Explore the parks, neighborhoods, culture and experiences around Orlando.",
        publicationStatus: "published",
        publishedAt: new Date(),
        theme: { accent: "#12B8A6", background: "#101827" },
        supportedFeatures: ["events", "planning", "maps", "nearby"],
        planTemplates: [
          {
            key: "slow-morning",
            title: "A slower morning",
            description:
              "A relaxed four-hour plan, with known admission prices and a smaller travel radius.",
            defaults: {
              startTime: "09:00",
              endTime: "13:00",
              pace: "relaxed",
              meals: false,
              radiusKm: 10,
              strictBudget: true,
            },
          },
        ],
        homeSections: [
          {
            key: "featured",
            title: "A day worth discovering",
            type: "activities",
            visible: true,
            order: 0,
          },
          {
            key: "happening",
            title: "Coming up in the city",
            type: "events",
            visible: true,
            order: 1,
          },
          {
            key: "outdoors",
            title: "Take the scenic route",
            type: "activities",
            tags: ["outdoors"],
            visible: true,
            order: 2,
          },
          {
            key: "free",
            title: "Good days. Small budgets.",
            type: "activities",
            tags: ["free"],
            visible: true,
            order: 3,
          },
        ],
      },
    },
    { upsert: true, returnDocument: "after" }
  );
  if (!city.heroImage?.url)
    await City.updateOne(
      { _id: city._id },
      {
        $set: {
          heroImage: {
            url: "/city/orlando-lake-eola.jpg",
            alt: "Lake Eola and the Orlando skyline, photographed in 2024",
            credit: "JER3L1337; cropped for display",
            license: "CC BY 4.0",
            sourceUrl:
              "https://commons.wikimedia.org/wiki/File:Lake_Eola_and_Orlando_Skyline_seen_in_2024.jpg",
          },
        },
      }
    );
  const categories = [
    ['Hotels & Places to Stay','hotels','Bed','primary'],
    [
      "Attractions & Theme Parks",
      "attractions-theme-parks",
      "Sparkles",
      "primary",
    ],
    ["Food & Drinks", "food-drinks", "Utensils", "primary"],
    ["Events & Festivals", "events-festivals", "Ticket", "primary"],
    ["Outdoors & Nature", "outdoors-nature", "Trees", "primary"],
    ["Kids & Family", "kids-family", "Users", "audience"],
    ["Date Night & Romance", "date-night-romance", "Heart", "theme"],
    [
      "Nightlife & Entertainment",
      "nightlife-entertainment",
      "Music",
      "primary",
    ],
    ["Arts, Culture & History", "arts-culture-history", "Landmark", "primary"],
    ["Shopping & Markets", "shopping-markets", "ShoppingBag", "primary"],
    ["Sports & Adventure", "sports-adventure", "Bike", "primary"],
    ["Wellness & Relaxation", "wellness-relaxation", "Sun", "primary"],
    [
      "Hidden Gems & Local Favorites",
      "hidden-gems-local-favorites",
      "Gem",
      "theme",
    ],
    ["Resorts & Staycations", "resorts-staycations", "Bed", "primary"],
    ["Classes & Workshops", "classes-workshops", "Palette", "primary"],
    ["Day Trips & Getaways", "day-trips-getaways", "Route", "theme"],
    ["Free & Budget-Friendly", "free-budget-friendly", "Wallet", "budget"],
  ];
  for (const [i, [name, slug, icon, kind]] of categories.entries())
    await Category.updateOne(
      { slug },
      {
        $setOnInsert: {
          name,
          slug,
          icon,
          kind,
          sortOrder: i,
          active: true,
          cities: [],
        },
      },
      { upsert: true }
    );
  for (const source of [
    {name:'calendars',license:'Public calendar facts; organizer retains original content',attribution:'Event organizers — see each event source',termsUrl:'https://events.ucf.edu/',intervalMinutes:360,retentionHours:48},
    {
      name: "osm",
      license: "ODbL 1.0",
      attribution: "© OpenStreetMap contributors",
      termsUrl: "https://www.openstreetmap.org/copyright",
      intervalMinutes: 10080,
      retentionHours: 336,
    },
  ])
    await ContentSource.updateOne(
      { name: source.name },
      {
        $setOnInsert: {
          ...source,
          enabled: (process.env[source.name==='osm'?'OSM_ENABLED':'EVENTS_ENABLED'] ?? "true") === "true",
          permissionReviewed: true,
        },
      },
      { upsert: true }
    );
  await EventFeed.updateOne({cityId:city._id,url:'https://events.ucf.edu/calendar/1/ucf-events/upcoming/feed.ics'},{$setOnInsert:{
    cityId:city._id,name:'University of Central Florida events',url:'https://events.ucf.edu/calendar/1/ucf-events/upcoming/feed.ics',
    sourceUrl:'https://events.ucf.edu/calendar/1/ucf-events/upcoming/',enabled:true,permissionReviewed:true,
  }},{upsert:true});
  await AppVersion.updateOne(
    { platform: "android" },
    {
      $setOnInsert: {
        platform: "android",
        latestVersionCode: 1,
        minimumVersionCode: 1,
        updatePolicy: "optional",
        releaseNotes: [],
      },
    },
    { upsert: true }
  );
  const password = process.env.ADMIN_PASSWORD,
    email = (process.env.ADMIN_EMAIL || "info@oldalexhub.com").toLowerCase();
  if (password) {
    if (password.length < 8)
      throw new Error("ADMIN_PASSWORD must have at least 8 characters");
    if (!(await AdminUser.exists({ email })))
      await AdminUser.create({
        email,
        passwordHash: await hashPassword(password),
        role: "admin",
        active: true,
      });
  }
  return city;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await connectDatabase();
    await seed();
    console.log(
      "Orlando and category taxonomy seeded. Existing content and passwords preserved."
    );
  } finally {
    await mongoose.disconnect();
  }
}
