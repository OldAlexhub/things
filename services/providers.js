import {linkedPhotos, qualityScore} from "./photography.js";
import {calendarProvider} from './calendars.js';
const UA = "ThingsToDo/1.0 (Old Alex Hub; info@oldalexhub.com)";
export async function fetchJSON(url, options = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: { "User-Agent": UA, ...options.headers },
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) {
        const error = Object.assign(
          new Error(`Provider HTTP ${response.status}`),
          { retryable: response.status === 429 || response.status >= 500 }
        );
        throw error;
      }
      return await response.json();
    } catch (error) {
      if (attempt === 2 || error.retryable === false)
        throw new Error(
          error.message.startsWith("Provider HTTP")
            ? error.message
            : "Provider request failed or timed out"
        );
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
}
const safeUrl = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === "https:" ? u.href : undefined;
  } catch {
    return undefined;
  }
};
const slug = (title, suffix) =>
  `${
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 100) || "place"
  }-${suffix}`;
export function normalizeOSM(element, city, categories) {
  const t = element.tags || {},
    lat = element.lat ?? element.center?.lat,
    lon = element.lon ?? element.center?.lon;
  if (!t.name || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const hotel = ['hotel','motel','hostel','guest_house','apartment'].includes(t.tourism);
  const category =
    hotel ? 'hotels' : t.tourism === "museum"
      ? "arts-culture-history"
      : t.amenity
      ? "food-drinks"
      : t.leisure === "park" || t.leisure === "nature_reserve"
      ? "outdoors-nature"
      : "attractions-theme-parks";
  const free = !hotel && t.fee === "no";
  return {
    kind: hotel ? 'hotel' : 'place',
    cityId: city._id,
    title: t.name,
    slug: slug(t.name, `osm-${element.type}-${element.id}`),
    shortDescription:
      t.description?.slice(0, 300) ||
      "A place to discover. See the source and official venue for current details.",
    description:
      t.description || (hotel ? 'A place to stay listed on OpenStreetMap. Check nightly rates, room availability and amenities directly with the property.' :
      "Venue details are sourced from OpenStreetMap. Confirm availability, accessibility and admission with the venue."),
    categories: categories[category] ? [categories[category]] : [],
    tags: [
      category,
      ...(free ? ["free"] : []),
      ...(category === "outdoors-nature" ? ["outdoors"] : []),
    ],
    audience: [],
    location: {
      address: [t["addr:housenumber"], t["addr:street"], t["addr:city"]]
        .filter(Boolean)
        .join(" "),
      neighborhood: t["addr:suburb"],
    },
    coordinates: { type: "Point", coordinates: [lon, lat] },
    images: [],
    priceInformation: {
      known: free,
      ...(free ? { adult: 0, child: 0 } : {}),
      currency: "USD",
      note: free
        ? "OSM records no entrance fee. Other costs may apply."
        : hotel ? 'Nightly rates vary by dates and room. Check with the property.' : "Admission price unknown",
    },
    officialWebsite: safeUrl(t.website || t["contact:website"]),
    source: "osm",
    sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    externalId: `${element.type}/${element.id}`,
    verificationStatus: "unverified",
    publicationStatus: "published",
    environment: category === "outdoors-nature" ? "outdoor" : "unknown",
  };
}
export const providers = {
  calendars: calendarProvider,
  osm: {
    model: "Activity",
    configured: () => (process.env.OSM_ENABLED ?? "true") === "true",
    async fetch(city, categories) {
      const [south, west, north, east] = city.geographicBounds || [
        city.latitude - 0.18,
        city.longitude - 0.18,
        city.latitude + 0.18,
        city.longitude + 0.18,
      ];
      // Very large municipal boundaries (e.g. Anchorage) must not cause huge queries.
      const latSpan = 50 / 111, lonSpan = 50 / (111 * Math.cos(city.latitude * Math.PI / 180));
      const box = [Math.max(south, city.latitude-latSpan), Math.max(west,city.longitude-lonSpan), Math.min(north,city.latitude+latSpan), Math.min(east,city.longitude+lonSpan)].map(Number);
      if (box.some((n) => !Number.isFinite(n)))
        throw new Error("Invalid city geographic bounds");
      const b = box.join(",");
      // Separate quotas stop restaurants from exhausting the entire city import.
      const query = `[out:json][timeout:45];nwr["tourism"~"^(museum|theme_park|zoo|gallery)$"]["name"](${b});out center tags 250;nwr["tourism"="attraction"]["name"][!"attraction"](${b});out center tags 150;nwr["leisure"~"^(park|nature_reserve)$"]["name"](${b});out center tags 200;nwr["amenity"~"^(restaurant|cafe)$"]["name"](${b});out center tags 150;nwr["tourism"~"^(hotel|motel|hostel|guest_house)$"]["name"](${b});out center tags 150;`;
      const data = await fetchJSON("https://overpass-api.de/api/interpreter", {
        method: "POST", headers: {"Content-Type": "application/x-www-form-urlencoded"},
        body: new URLSearchParams({data:query}),
      });
      if (!Array.isArray(data.elements) || data.remark) throw new Error("Incomplete OpenStreetMap response");
      const elements = [...new Map(data.elements.map(e => [`${e.type}/${e.id}`,e])).values()];
      const photos = await linkedPhotos(elements, city);
      return elements.map(e=> {
        const record = normalizeOSM(e,city,categories);
        if(!record)return null;
        const photo = photos.get(record.externalId);
        if(photo)record.images=[{...photo,alt:record.title}];
        record.qualityScore=qualityScore(record);
        return record;
      }).filter(Boolean);
    },
  },
};
