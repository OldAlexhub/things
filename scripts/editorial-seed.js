// A real, source-checked editorial listing. No invented prices, hours or events.
// This optional import is independent of the scheduled provider adapters.
import "dotenv/config";
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";
import { connectDatabase } from "../db/connect.js";
import { City, Category, Activity } from "../models/index.js";
export async function importEditorial() {
  const city = await City.findOne({ slug: "orlando" });
  if (!city) throw new Error("Run the city seed first.");
  const category = await Category.findOne({ slug: "outdoors-nature" });
  await Activity.updateOne(
    { source: "editorial", externalId: "orlando-lake-eola-park" },
    {
      $setOnInsert: {
        cityId: city._id,
        title: "Lake Eola Park",
        slug: "lake-eola-park",
        shortDescription:
          "A lakeside walk and a different perspective on downtown Orlando.",
        description:
          "Walk the 0.9-mile loop around Lake Eola and take in the downtown skyline. The park offers a place to stroll beside the water. Check the City of Orlando website for current park information, activities and any closures. Prices for rentals, special events and other services are not included or verified.",
        categories: category ? [category._id] : [],
        tags: ["outdoors", "sightseeing"],
        audience: [],
        location: {
          address: "512 East Washington Street, Orlando, FL 32801",
          neighborhood: "Downtown Orlando",
        },
        coordinates: { type: "Point", coordinates: [-81.373042, 28.543944] },
        images: [
          {
            url: "/city/orlando-lake-eola.jpg",
            alt: "Lake Eola and downtown Orlando in 2024",
            credit: "JER3L1337; resized and cropped for display",
            license: "CC BY 4.0",
            sourceUrl:
              "https://commons.wikimedia.org/wiki/File:Lake_Eola_and_Orlando_Skyline_seen_in_2024.jpg",
          },
        ],
        environment: "outdoor",
        priceInformation: {
          known: false,
          currency: "USD",
          note: "Admission, rentals and event prices are not verified. Check the official website.",
        },
        officialWebsite:
          "https://www.orlando.gov/Parks-the-Environment/Directory/Lake-Eola-Park",
        source: "editorial",
        sourceUrl:
          "https://www.orlando.gov/Parks-the-Environment/Directory/Lake-Eola-Park",
        externalId: "orlando-lake-eola-park",
        lastVerifiedAt: new Date("2026-11-14T00:00:00Z"),
        verificationStatus: "needs-review",
        publicationStatus: "published",
      },
    },
    { upsert: true }
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await connectDatabase();
    await importEditorial();
    console.log(
      "Real Lake Eola listing imported. Existing editorial changes preserved."
    );
  } finally {
    await mongoose.disconnect();
  }
}
