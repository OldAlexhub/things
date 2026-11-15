# Things to Do server

Node 24, Express 5 and MongoDB. Developer: **Old Alex Hub**, **info@oldalexhub.com**.

## Run locally

```powershell
cd server
npm ci
npm run dev:local
```

Open `http://localhost:3000` for Content Studio. The development launcher downloads and runs a real local MongoDB binary and retains its database in `.local/db`. Its automatically generated local administrator credentials are in `.local/admin-login.json`, which is excluded from source control. This launcher is for development only. It does not substitute an in-memory catalog or fake API responses.

For a one-time import of real OpenStreetMap places into the local database:

```powershell
npm run dev:local -- --import-osm
```

This explicit option enables the OSM source for the local database, records the reviewed ODbL permission and queues an import. Imported venue details remain **unverified**. Unknown hours and admission prices remain unknown. Overpass may be unavailable or rate limited; failed syncs preserve the existing dataset. Do not run two local launchers against the same `.local/db` directory.

## Persistent deployment

1. Install production dependencies using `npm ci --omit=dev`.
2. For the selected production host `https://things.server.oldalexhub.com`, use `.env.production.example` as the starting configuration. For development, use `.env.example`. Configure `MONGODB_URI`, `PUBLIC_URL` and `CORS_ORIGINS`. Keep the database private and authenticated. Use a managed or independently operated MongoDB deployment with backups.
3. Set a unique bootstrap `ADMIN_PASSWORD` with at least 14 characters and `ADMIN_EMAIL=info@oldalexhub.com`; run `npm run seed`. Remove the bootstrap password afterward. Existing accounts and content are preserved by seeding.
4. Run `npm start` behind HTTPS. Set `TRUST_PROXY` to the actual trusted proxy hop count, not an arbitrary permissive value. Serve the API, studio, `/map.html`, `/vendor` and uploaded media from the same public origin.
5. Mount durable storage at `UPLOAD_DIR`. Back up it and MongoDB. Horizontal deployments need a shared media backend before scaling; the current storage adapter uses local disk.
6. Set the release app's `TTD_API_URL` to this HTTPS origin. No API credentials belong in the Android app.

Production startup fails clearly if MongoDB is absent. Health is `GET /api/v1/health`. SIGTERM stops new scheduler work and closes HTTP connections. Database connection errors are sanitized. Secrets and request bodies are not logged. Review the reverse proxy's own logging and retention.

## Content Studio and adding a city

Sign in at `/`. Authentication uses scrypt password hashes and 8-hour MongoDB-backed opaque sessions. Cookies are HttpOnly, SameSite Strict and Secure in production. Mutations require a session CSRF token, and browser origins are checked. Login and API rate limits are enabled. Editors cannot alter provider policies, version policies or delete content; the initial account is an administrator.

1. Destinations → Create new: set a unique slug, IANA timezone, center, bounds `[south, west, north, east]`, description, supported features and draft status. Structured fields use JSON in the editor.
2. Upload licensed images to Media library. Include alt text, author credit, license and original source URL. Copy the image URL into a complete image object: `{ "url": "https://…", "alt": "…", "credit": "…", "license": "…", "sourceUrl": "https://…" }`.
3. Add applicable categories, experiences and future events. Copy the city's ID into `cityId`; categories and collection membership use actual record IDs. Prices are USD admission estimates; set `known:false` unless costs are known. When children are included, unknown child admission makes group admission unknown. Do not claim hours are verified without a current `validUntil` and a complete weekly schedule in the city timezone.
4. Create collections that reference existing experience IDs. Do not duplicate activity records.
5. Configure `homeSections` in the city editor. Supported `type` values are `activities`, `events`, `collection`, `recommendations`; sections have `key`, `title`, `order`, `visible`, optional `tags` and `collectionId`. The public API ignores hidden sections and unpublished collections. Change section order or visibility by editing these fields.
6. Optional `planTemplates` define reusable planning defaults: `[{"key":"morning","title":"A slower morning","description":"A shorter local day","defaults":{"startTime":"09:00","endTime":"13:00","pace":"relaxed","radiusKm":10}}]`. Supported defaults include time, budget/strict budget, transport, environment, weather preference, pace, meals, radius and interest IDs. The planner renders these presets directly from city data. Only allowlisted data fields are accepted; templates cannot deliver executable code.
7. Preview the outgoing record in the editor, save, and set the city to `published`. The app discovers it on refresh without a new APK. Archive/unpublish removes it from public queries. Saved mobile snapshots explain when content is unavailable.

The initial seed publishes Orlando and a 16-category taxonomy, but it never invents an activity catalog, events, prices or operating hours. Only Orlando is automatically published. City hero/gallery media is editable entirely on the server. The Orlando seed includes a redistributable CC BY 4.0 city photo, served from `/city/orlando-lake-eola.jpg`; credit and the original source travel with the API record. See `public/city/ATTRIBUTION.txt`.

An optional, real editorial listing can be imported with `node scripts/editorial-seed.js` after configuring MongoDB. It adds Lake Eola Park using checked City of Orlando facts and Library of Congress coordinates, preserving unknown prices, hours and durations. It never replaces existing editor changes. This is independent of automated imports. The development database used for QA contains 600 real OSM places plus this one editorial record; no test fixtures are seeded there.

## API

Public endpoints use `/api/v1` and `{data,meta?}` responses. Errors use `{error:{message,fields?,requestId}}`.

| Resource | Operations |
|---|---|
| `/cities`, `/cities/:id`, `/cities/:id/home` | Published destinations and ordered homepage sections |
| `/categories?cityId=…` | Dynamic taxonomy |
| `/activities`, `/events` | Search, category, price, duration, environment, family, age, date and location filters; `page`, `limit` |
| `/activities/:id`, `/events/:id` | Published, permitted, unexpired details |
| `/collections`, `/collections/:id` | Published curated groups |
| `/recommendations` | POST validated planning inputs; eligibility then deterministic weighted ranking |
| `/itineraries/generate`, `/itineraries/recalculate` | POST generate or validate an explicit ordered `stopIds` array |
| `/app/version?currentVersionCode=1` | Latest/minimum Android policy; no assumption that Play has an installable update |
| `/admin/…` | Authenticated editing, media upload, synchronization, audit and version management |

Search is a MongoDB text index, not in-memory string matching. Geographic queries use 2dsphere indexes. Results paginate to a maximum 40 per page. Distance sort requires a location and cannot be combined with text relevance. Open-now filters include only current verified same-day intervals; unknown and ambiguous overnight intervals are not advertised as open now. Planning handles overnight intervals separately.

Planning uses at most 400 geographically bounded candidates. It enforces required ages, strict admission budgets, geography, known hours, time windows and duration. Scoring weights are configurable on the city. Missing duration uses a disclosed 90-minute allowance. Travel uses disclosed straight-line distance adjusted by 1.35 and assumed mode speeds, **not live routing**. Meal breaks reserve time but do not claim a restaurant booking or known food price. Infeasible reordered plans return 422 instead of silently dropping stops. Local/tourist preference contributes to the novelty component when content has matching audience or discovery tags. Recommendation sections use the mobile preferences through the recommendation endpoint. User-selected weather conditions influence scoring only where a venue has explicitly listed matching `weatherSuitability` data (`dry`, `rain`, `heat`, `cold`). Unknown suitability stays unknown. This is a preference, not a forecast. No generative AI model or live weather provider is configured.

## Providers and synchronization

`ContentSource`, `SyncJob`, and `SyncLog` retain configuration, leases and outcomes. Each source/city job acquires an atomic 10-minute lease, retries on later ticks with bounded backoff, records counts, and upserts by provider/external ID. An editor's archive/unpublish decision survives refresh. Empty/error responses never trigger a full dataset deletion. Retention cleanup is independent of imports; public filters hide expired records even before physical cleanup. Logs default to 30 days; audit history to 90 days.

Providers start disabled. Enable only after checking the actual agreement, setting `permissionReviewed`, recording license and attribution, choosing retention and setting the relevant environment switches.

- **OpenStreetMap / Overpass:** no API key. ODbL data, contributor attribution and database share-alike obligations. Default weekly interval, 14-day freshness retention. Fixed official Overpass endpoint, bounded queries, User-Agent, timeout and retry. No arbitrary OSM image URLs are copied without license review. [License](https://www.openstreetmap.org/copyright), [Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API).
- **Ticketmaster Discovery v2:** requires `TICKETMASTER_API_KEY`, environment and admin enablement, and agreement review. Default 6-hour interval and conservative 24-hour cache retention, not a representation that every contract permits this. Requests stay below documented default rate/deep-pagination limits. Cancellation and rescheduling status is preserved. Missing explicit event time is skipped; prices remain unknown because advertised ranges do not establish group totals including fees. [API](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/), [terms](https://developer.ticketmaster.com/support/terms-of-use/).
- **Maps:** bundled Leaflet, configurable HTTPS tile URL, visible OSM attribution, identified WebView user agent, standard HTTP caching, no prefetch or offline downloads. [Tile policy](https://operations.osmfoundation.org/policies/tiles/). Switch to a suitable commercial tile service if traffic requires it.
- Weather, routing, automated price/hour verification and additional providers are not enabled. Their data must not be inferred from unavailable services.

Manual sync runs from Data sources even with automatic scheduling disabled. `SYNC_ENABLED=true` provisions recurring jobs. Set source `intervalMinutes` and `retentionHours` through the studio. Keep retention compatible with the provider agreement. Providers returning an empty successful response retain existing records until their ordinary expiry.

## Media, privacy and checks

Uploads require authentication, CSRF, image decoding, size/pixel limits and attribution. JPEG/PNG/WebP are re-encoded to WebP with random filenames. SVG/executable uploads are rejected. Referenced media cannot be deleted until references are removed.

`npm test` runs real ephemeral MongoDB integration tests and planner edge cases. `npm audit --omit=dev` checks server runtime dependencies. `node scripts/documents.js` synchronizes the in-app policy into hosted HTML and Markdown and refreshes store text. The policy is available at `/privacy.html` and terms at `/terms.html`; publish them at the actual HTTPS origin before store submission.

No hosted server, production MongoDB, Ticketmaster account, Google consent configuration or Play listing is provisioned by merely running this code. See the mobile README for release prerequisites and test limitations.

The production hostname resolved during verification but rejected the TLS handshake. Configure a valid certificate and route HTTPS traffic to this server, then verify `/api/v1/health` returns status `ok`. Remote hosting credentials were not provided, so the host itself was not modified.
