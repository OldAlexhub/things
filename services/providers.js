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
  const category =
    t.tourism === "museum"
      ? "arts-culture-history"
      : t.amenity
      ? "food-drinks"
      : t.leisure === "park" || t.leisure === "nature_reserve"
      ? "outdoors-nature"
      : "attractions-theme-parks";
  const free = t.fee === "no";
  return {
    cityId: city._id,
    title: t.name,
    slug: slug(t.name, `osm-${element.type}-${element.id}`),
    shortDescription:
      t.description?.slice(0, 300) ||
      "A place to discover. See the source and official venue for current details.",
    description:
      t.description ||
      "Venue details are sourced from OpenStreetMap. Confirm availability, accessibility and admission with the venue.",
    categories: categories[category] ? [categories[category]] : [],
    tags: [
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
        : "Admission price unknown",
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
export function normalizeTicketmaster(event, city, categories) {
  if (!event.id || !event.name || !event.dates?.start?.dateTime) return null;
  const venue = event._embedded?.venues?.[0],
    lat = Number(venue?.location?.latitude),
    lon = Number(venue?.location?.longitude);
  const status = event.dates?.status?.code;
  return {
    cityId: city._id,
    title: event.name,
    slug: slug(event.name, event.id),
    description:
      event.info ||
      event.pleaseNote ||
      "See Ticketmaster for current event and ticket details.",
    shortDescription: (event.info || event.name).slice(0, 300),
    categories: categories["events-festivals"]
      ? [categories["events-festivals"]]
      : [],
    tags: ["events"],
    audience: [],
    location: {
      address: [venue?.address?.line1, venue?.city?.name]
        .filter(Boolean)
        .join(", "),
    },
    ...(Number.isFinite(lat) && Number.isFinite(lon)
      ? { coordinates: { type: "Point", coordinates: [lon, lat] } }
      : {}),
    images: (event.images || [])
      .filter((i) => safeUrl(i.url) && i.width >= 600)
      .slice(0, 3)
      .map((i) => ({
        url: i.url,
        alt: event.name,
        credit: "Ticketmaster / event provider",
        license: "Provider permission required",
        sourceUrl: event.url,
      })),
    priceInformation: {
      known: false,
      currency: "USD",
      note: "Ticket prices and fees vary. Check the ticket provider.",
    },
    bookingUrl: safeUrl(event.url),
    source: "ticketmaster",
    sourceUrl: safeUrl(event.url),
    externalId: event.id,
    verificationStatus: "unverified",
    publicationStatus: "published",
    venue: venue?.name,
    startAt: new Date(event.dates.start.dateTime),
    ...(event.dates?.end?.dateTime
      ? { endAt: new Date(event.dates.end.dateTime) }
      : {}),
    timezone: event.dates?.timezone || city.timezone,
    eventStatus:
      status === "cancelled"
        ? "cancelled"
        : status === "postponed"
        ? "postponed"
        : status === "rescheduled"
        ? "rescheduled"
        : "scheduled",
    ticketInformation: event.pleaseNote,
  };
}
export const providers = {
  osm: {
    model: "Activity",
    configured: () => process.env.OSM_ENABLED === "true",
    async fetch(city, categories) {
      const [south, west, north, east] = city.geographicBounds || [
        city.latitude - 0.18,
        city.longitude - 0.18,
        city.latitude + 0.18,
        city.longitude + 0.18,
      ];
      const box = [south, west, north, east].map(Number);
      if (box.some((n) => !Number.isFinite(n)))
        throw new Error("Invalid city geographic bounds");
      const b = box.join(",");
      const query = `[out:json][timeout:30];(nwr["tourism"~"^(attraction|museum|theme_park|zoo|gallery)$"]["name"](${b});nwr["leisure"~"^(park|nature_reserve)$"]["name"](${b});nwr["amenity"~"^(restaurant|cafe)$"]["name"](${b}););out center tags 600;`;
      const data = await fetchJSON("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: query }),
      });
      if (!Array.isArray(data.elements) || data.remark)
        throw new Error("Incomplete OpenStreetMap response");
      return data.elements
        .map((e) => normalizeOSM(e, city, categories))
        .filter(Boolean);
    },
  },
  ticketmaster: {
    model: "Event",
    configured: () =>
      process.env.TICKETMASTER_ENABLED === "true" &&
      !!process.env.TICKETMASTER_API_KEY,
    async fetch(city, categories) {
      const records = [];
      let pages = 1;
      for (let page = 0; page < Math.min(pages, 5); page++) {
        const url = new URL(
          "https://app.ticketmaster.com/discovery/v2/events.json"
        );
        url.search = new URLSearchParams({
          apikey: process.env.TICKETMASTER_API_KEY,
          latlong: `${city.latitude},${city.longitude}`,
          radius: "40",
          unit: "km",
          size: "200",
          page: String(page),
          sort: "date,asc",
        }).toString();
        const data = await fetchJSON(url);
        pages = data.page?.totalPages || 1;
        records.push(...(data._embedded?.events || []));
        if (page + 1 < Math.min(pages, 5))
          await new Promise((r) => setTimeout(r, 250));
      }
      return records
        .map((e) => normalizeTicketmaster(e, city, categories))
        .filter(Boolean);
    },
  },
};
