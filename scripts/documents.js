import { readFile, writeFile, mkdir } from "node:fs/promises";
const source = await readFile("../thingstodo/src/screens/Legal.tsx", "utf8");
const escape = (s) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
for (const [key, name] of [
  ["privacyText", "privacy"],
  ["termsText", "terms"],
]) {
  const text =
    source.match(
      new RegExp("export const " + key + " = `([\\s\\S]*?)`;")
    )?.[1] ||
    source.match(new RegExp("export const " + key + "=`([\\s\\S]*?)`;"))?.[1];
  if (!text) throw new Error("Legal source not found");
  const title = name === "privacy" ? "Privacy policy" : "Terms and disclaimers";
  await writeFile(
    "public/" + name + ".html",
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | Things to Do</title><link rel="stylesheet" href="/studio.css"></head><body><article class="login"><img class="lockup" src="/brand/logo-lockup.png" alt="Things to Do"><h1>${title}</h1>${text
      .split("\n\n")
      .map((p) => "<p>" + escape(p) + "</p>")
      .join("")}</article></body></html>`
  );
  await writeFile(
    "../thingstodo/" + (name === "privacy" ? "PRIVACYPOLICY.md" : "TERMS.md"),
    "# " + title + "\n\n" + text + "\n"
  );
}
await mkdir("../thingstodo/store_assets", { recursive: true });
const files = {
  "short-description.txt":
    "Find things to do, save local experiences and plan a day around your interests.",
  "full-description.txt": `Make room for a day less ordinary.\n\nThings to Do: Day Planner helps you discover experiences and put together a day around your interests, time, group and admission budget. Start with Orlando, Florida, and explore new destinations as they become available.\n\nDISCOVER YOUR KIND OF DAY\nBrowse server-published attractions, outdoor places, food, events and curated collections. Search by category and filter by known price, duration, setting, age suitability and location. Available content varies by destination.\n\nPLAN WITH A LITTLE MORE THOUGHT\nChoose your date, starting point, group, pace and interests. Build an itinerary from listed experiences, with admission estimates, breaks and clearly labeled rough travel estimates. Replace, remove or reorder stops and recalculate your day.\n\nKEEP THE GOOD IDEAS\nSave favorites, build a bucket list and organize custom collections. Mark places as visited. Save day plans to read offline, share them or export a file. No public account is required.\n\nKNOW BEFORE YOU GO\nPrices, hours, events and availability can change. Unknown details are identified. Confirm plans with venues and ticket providers before traveling. Itineraries are suggestions, not reservations, and admission estimates exclude meals, travel, taxes and fees.\n\nFree with advertising when enabled. Internet access is required for fresh discovery, planning and maps. Personal saved content stays on your device; the app also communicates with its backend, map providers and advertising services.\n\nDiscover. Explore. Experience.\nDeveloped by Old Alex Hub\nSupport: info@oldalexhub.com`,
  "promo-text.txt":
    "Your next good day starts with a little discovery. Explore Orlando and make a plan that feels like you.",
  "release-notes.txt":
    "First release candidate: city discovery, filtered search, day planning, maps, local favorites and collections, itinerary export, privacy controls and accessible Android layouts. Validate production services before publishing.",
  "screenshot-captions.txt":
    "01 Discover a day less ordinary\n02 Follow your curiosity\n03 Your day. Your way.\n04 Know a little more before you go\n05 Find your next experience on the map\n06 Make a day of it\n07 Keep the good ideas\n08 Make yourself at home",
  "privacy-summary.txt":
    "No public account. Favorites and plans are stored locally. Discovery and planning use the backend. Optional approximate location supports nearby searches. Map and advertising providers may process device and connection data. Adult confirmation and consent gate ads. Contact info@oldalexhub.com.",
  "store-listing.md":
    "# Things to Do: Day Planner\n\nDeveloper: Old Alex Hub\n\nContact: info@oldalexhub.com\n\nCategory suggestion: Travel & Local\n\nContains ads: Yes\n\nInitial destination: Orlando, Florida. Additional cities appear when published by the server.\n\nUse app-icon-512.png. Intended privacy URL: https://things.server.oldalexhub.com/privacy.html (verify hosting and TLS before submission). Add actual emulator or device captures, content rating, target audience, countries and Data safety declarations before submission. Do not upload the QA build as production.\n",
  "feature-graphic-notes.md":
    "# Feature graphic\n\nUse a 1024 × 500 graphic featuring the original logo, midnight navy, tropical teal and sunset gold. Copy: “A day less ordinary.” Secondary: “Discover. Explore. Experience.” Avoid rankings, prices and live-data claims. Any destination photograph needs an appropriate license and attribution. This package includes actual logo and icon files; do not substitute a mockup for app screenshots.\n",
  "data-safety-notes.md":
    "# Data safety review\n\nComplete the Play form against the shipped configuration, not this checklist alone.\n\n- Backend: selected city, interests, date, budget, group ages and optional approximate starting coordinates, processed for search/planning; no public accounts or stored personal planning profiles in this implementation.\n- Local only: favorites, saved plans, visits, collections, searches and preferences, until the user shares/exports them.\n- Optional approximate location: permission requested on use; no background collection.\n- Maps: visible tile requests disclose connection data and map area to the provider.\n- Google Mobile Ads: review identifiers, coarse location, interactions, diagnostics and advertising/analytics/fraud purposes using the exact SDK configuration. Non-personalized ads still process data.\n- Configure UMP regional messages before production. Adult confirmation is not a substitute for the Play target-audience declaration.\n- Verify HTTPS, server and proxy retention, deletion contact, SDK behavior and third-party terms.\n\nPrimary references: [Google SDK disclosure](https://developers.google.com/admob/android/privacy/play-data-disclosure), [Play Data safety](https://support.google.com/googleplay/android-developer/answer/10787469), [UMP integration](https://docs.page/invertase/react-native-google-mobile-ads/european-user-consent).\n",
};
for (const [name, text] of Object.entries(files))
  await writeFile("../thingstodo/store_assets/" + name, text + "\n");
console.log("Synchronized privacy documents and store listing assets.");
