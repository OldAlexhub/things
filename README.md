# Things to Do server

Node 24, Express 5 and MongoDB. Developer: **Old Alex Hub**, **info@oldalexhub.com**.

## Run locally

```powershell
cd server
npm ci
npm run dev:local
```

Open `http://localhost:3000` for Content Studio. The development launcher downloads and runs a real local MongoDB binary and retains its database in `.local/db`. Its automatically generated local administrator credentials are in `.local/admin-login.json`, which is excluded from source control. This launcher is for development only. It does not substitute an in-memory catalog or fake API responses.

OpenStreetMap and scheduled synchronization are enabled by default. The first run seeds Orlando and its categories; the scheduler queues imports for published cities. No provider API keys or billing accounts are required. `--import-osm` remains available to request an immediate refresh. Overpass failures preserve existing content and retry later. The local launcher uses development cookies and localhost URLs even when `.env` contains production settings.

## Deploy with the defaults

```powershell
npm ci --omit=dev
# The release server ZIP already contains a safe default .env.
npm start
```

The release ZIP includes a non-secret `.env` generated from `.env.production.example`; the private developer environment and credentials are never included. For a source checkout, copy that example to `.env`.

The supplied production configuration uses `https://things.server.oldalexhub.com`. MongoDB defaults to `mongodb://127.0.0.1:27017/thingstodo`; change only `MONGODB_URI` if the host uses another database. Run MongoDB privately with persistent storage and backups. Route the HTTPS hostname to the server's port 3000, provide a valid certificate, and persist the `uploads` directory. `TRUST_PROXY` must match the actual reverse-proxy deployment.

These switches default to `true` in the actual environment file and both examples:

- `OSM_ENABLED`: free OpenStreetMap imports.
- `SYNC_ENABLED`: automatic recurring synchronization for published cities.
- `AUTO_SEED`: idempotent initial city, taxonomy and provider setup. Existing city publication choices and editorial content are preserved.
- `AUTO_CREATE_ADMIN`: secure first-run administrator creation. If no admin exists and `ADMIN_PASSWORD` is blank, a unique strong password is stored privately in `.secrets/initial-admin.json`. Retrieve it on the host to sign in, and keep that directory private. Existing administrators are never reset. You can instead supply `ADMIN_PASSWORD` privately.

Startup seeds automatically; a separate seed command and source enablement steps are not needed. Only Orlando is initially published. Add future cities in Content Studio and set `publicationStatus` to `published`. Within the next scheduler tick (at most about one minute while idle), the server creates its import job. The app discovers the city on refresh without an app rebuild. Draft, unpublished and archived cities stay hidden and are not imported. Existing source configuration can still be disabled in the dashboard when needed.

The API and media, `/map.html`, `/vendor`, privacy policy and Content Studio share the same public origin. `GET /api/v1/health` verifies database connectivity. SIGTERM stops the scheduler and closes HTTP connections. Secrets and request bodies are not logged. This single-server storage implementation requires shared media storage before horizontal scaling.

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

Only the free OpenStreetMap adapter is registered. Its ODbL permissions and attribution have been reviewed, and new databases enable it automatically. Existing admin choices are preserved. Unsupported provider configurations and jobs are removed by the idempotent seed. New integrations must remain free and undergo license/usage review before being added.

- **OpenStreetMap / Overpass:** no API key. ODbL data, contributor attribution and database share-alike obligations. Default weekly interval, 14-day freshness retention. Fixed official Overpass endpoint, bounded queries, User-Agent, timeout and retry. No arbitrary OSM image URLs are copied without license review. [License](https://www.openstreetmap.org/copyright), [Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API).
- **Maps:** bundled Leaflet, configurable HTTPS tile URL, visible OSM attribution, identified WebView user agent, standard HTTP caching, no prefetch or offline downloads. [Tile policy](https://operations.osmfoundation.org/policies/tiles/). Respect the public tile usage limits; the current app does not configure a paid tile service.
- Events are created and maintained through Content Studio using legitimate editorial sources. No third-party event API is integrated.
- Weather, routing, automated price/hour verification and additional providers are not enabled. Their data must not be inferred from unavailable services.

Manual sync remains available from Data sources. `SYNC_ENABLED=true` provisions recurring jobs by default. Set source `intervalMinutes` and `retentionHours` through the studio. Keep retention compatible with the provider agreement. Providers returning an empty successful response retain existing records until their ordinary expiry.

## Media, privacy and checks

Uploads require authentication, CSRF, image decoding, size/pixel limits and attribution. JPEG/PNG/WebP are re-encoded to WebP with random filenames. SVG/executable uploads are rejected. Referenced media cannot be deleted until references are removed.

`npm test` runs real ephemeral MongoDB integration tests and planner edge cases. `npm audit --omit=dev` checks server runtime dependencies. `node scripts/documents.js` synchronizes the in-app policy into hosted HTML and Markdown and refreshes store text. The policy is available at `/privacy.html` and terms at `/terms.html`; publish them at the actual HTTPS origin before store submission.

No hosted server, production MongoDB, Google consent configuration or Play listing is provisioned by merely running this code. See the mobile README for release prerequisites and test limitations.

The production hostname resolved during verification but rejected the TLS handshake. Configure a valid certificate and route HTTPS traffic to this server, then verify `/api/v1/health` returns status `ok`. Remote hosting credentials were not provided, so the host itself was not modified.
