# Trip Kraken

A self-hosted trip itinerary planner. Import a public Google My Maps list, supply a number of days (and an optional start date), and Trip Kraken clusters your locations geographically and orders them into a day-by-day itinerary. You can then manually re-order stops, exclude locations, and discover nearby places — all persisted so you can return and iterate.

---

## How It Works

### 1. Import

Paste a public Google My Maps link. The server extracts the map ID (`mid`) from the URL and fetches the map's KML export directly from Google:

```
https://www.google.com/maps/d/kml?forcekml=1&mid={mid}
```

KML embeds exact coordinates for every placemark — no geocoding step, no web scraping. This is the most reliable path to getting clean lat/lng data into the app.

**Prerequisite:** Your My Maps map must be set to **"Anyone with the link can view"**. Private maps will return an error.

### 2. Optimization

After import, provide a number of days (and optionally a start date). The optimizer runs a two-phase algorithm:

1. **K-means clustering** — groups all locations into N clusters (one per day), using k-means++ initialization and Haversine distance to account for Earth's curvature.
2. **Nearest-neighbor TSP** — within each cluster, orders stops greedily starting from the northernmost point.

The result is a day-by-day itinerary that minimizes backtracking. You can re-run optimization at any time, which rebuilds the schedule from scratch.

### 3. Nearby Places

Each location has a "Find Nearby" panel with two backends:

- **Google Places** — search within a configurable radius (500m–5km), filter by place type (restaurant, café, museum, park, etc.), open-now status, minimum rating, and price level. Results are scored by rating quality, review depth, and category diversity relative to the current day.
- **Tabelog** — Japan's leading restaurant platform, available as an alternative source when searching near Japanese locations. Because Tabelog has no public API, results are fetched via an HTML scraper with a ≥2s rate-limiting delay. Tabelog results don't include coordinates; they are resolved to a Google place via Text Search when added to the trip so they appear on the map immediately.

Add results directly to the trip from either source. Locations without enrichment data (hours, phone, updated coordinates) can be updated in bulk using the **Enrich** button.

### 4. Manual Editing

Stops can be dragged between days and reordered within a day. Individual locations can be excluded from the itinerary without being deleted from the trip.

---

## Persistence

Trips, locations, and itineraries are stored in a **SQLite database** (`db/dev.db`) using Node's built-in `node:sqlite` module (no ORM, no external database server required).

**Caveats to be aware of:**

- **Single-file, local storage.** The database lives on the same machine as the server. There is no sync, backup, or cloud storage. If `db/dev.db` is deleted, all trips are gone.
- **No authentication.** All trips are accessible to anyone who can reach the server. This is a single-user, local-first app — not suitable for multi-user or public deployment without adding an auth layer.
- **Schema migrations are manual.** The schema is initialized on startup via `CREATE TABLE IF NOT EXISTS` statements. Columns added after a database already exists (e.g., `rating`, `reviewCount`, `categories`) are applied with `ALTER TABLE` statements on startup. If you modify the schema, you are responsible for migration.
- **Itinerary state is fully rebuilt on re-optimization.** Running the optimizer deletes existing `ItineraryDay` and `ItineraryStop` records and regenerates them. Any manual day labels you've set will survive (they're stored on the day record), but stop order is reset.

---

## Tech Stack


| Layer           | Technology                                                 |
| --------------- | ---------------------------------------------------------- |
| Framework       | Next.js 16 (App Router, Turbopack)                         |
| Language        | TypeScript                                                 |
| Styling         | Tailwind CSS                                               |
| Map rendering   | MapLibre GL + react-map-gl                                 |
| Drag-and-drop   | dnd-kit                                                    |
| Database        | SQLite via `node:sqlite` (built-in, no Prisma)             |
| KML parsing     | fast-xml-parser + adm-zip                                  |
| HTML parsing    | cheerio (Tabelog scraper)                                  |
| External APIs   | Google Maps Geocoding API, Google Places (Nearby Search, Text Search, Place Details), Tabelog (scraped) |
| Package manager | pnpm                                                       |


---

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

Create `.env.local` in the project root:

```env
GOOGLE_MAPS_API_KEY=your_key_here
```

The key needs the following APIs enabled in Google Cloud Console:

- Maps JavaScript API (map tiles)
- Geocoding API (fallback coordinate resolution)
- Places API (Nearby Search, Text Search, Place Details)

### 3. Start VROOM and OSRM

Optimization (ADR-0023) and road travel cost (ADR-0024) depend on two self-hosted services,
defined in `docker-compose.yml`. There is no hosted alternative: `docs/research/hosted-routing-alternatives.md`
found that every hosted matrix API but one forbids the server-side matrix this app builds, in
their own terms of service. This is the entire deployment story for now (ADR-0025) — nothing
here is Vercel-shaped, and that is a deliberate, recorded posture, not an oversight.

First, build the road graphs (one-time, re-run only when `scripts/osm-snapshot.env`'s pinned
snapshot moves):

```bash
pnpm build:osrm-graphs
```

This downloads a pinned Kanto extract and runs `osrm-extract`/`osrm-partition`/`osrm-customize`
for the `foot` and `car` profiles (`bicycle` was evaluated and dropped — see ADR-0024's
2026-08-09 amendment). Needs Docker, ~1 GB of disk, and a few minutes on first run.

Then bring the stack up:

```bash
docker compose up -d
```

This builds VROOM from source, pinned to `v1.15.0` — no published image exists past
`v1.14.0-rc.2`, so this is forced rather than a choice, and it's a multi-minute build the first
time. Add the three service URLs to `.env.local` (defaults shown match `docker-compose.yml`'s
published ports):

```env
VROOM_URL=http://localhost:8080
OSRM_FOOT_URL=http://localhost:5002
OSRM_CAR_URL=http://localhost:5010
```

`osrm-car` publishes on host port `5010`, not the OSRM-standard `5000` its container listens on
internally — macOS's AirPlay Receiver claims host port 5000 by default. Free it up in
**System Settings → General → AirDrop & Handoff** if you'd rather use `5000`.

Three independent names rather than one base URL, because a caller needs to say *which* service
is unreachable — "the walking graph is unreachable" is a more useful error than "OSRM is down."

Verify everything actually works, not just that the containers are running:

```bash
pnpm infra:verify
```

This checks VROOM's health endpoint, sends a real routing query to each OSRM instance, and —
the check that matters most — POSTs a fixture built to violate a time window in VROOM's plan
mode (`-c`) and confirms a violation comes back. A VROOM build without `libglpk` linked accepts
plan-mode requests and silently ignores them, which only a check like this one catches.

### 4. Run

```bash
pnpm dev
```

App is available at [http://localhost:3000](http://localhost:3000).

---

## Project Structure

```
src/
  app/              # Next.js App Router pages and API routes
    api/
      import/       # POST /api/import — My Maps KML ingestion
      trips/        # Trip CRUD, optimization, location management, nearby search
  components/       # React UI components
  lib/
    myMaps.ts       # Google My Maps KML fetch (mid extraction, document name)
    parsers/
      kml.ts        # KML/KMZ parser (no external geocoding required)
    geocoding.ts    # Google Geocoding API client (fallback only)
    places.ts       # Google Places client (Nearby Search, Text Search, Place Details enrichment)
    tabelog.ts      # Tabelog HTML scraper (prefecture-scoped, 2s rate limit, cheerio parser)
    optimizer.ts    # K-means++ + nearest-neighbor TSP + 2-opt + time-window constraints
    db.ts           # SQLite schema, queries, and transaction helpers
  types/
    index.ts        # Shared TypeScript types
db/
  dev.db            # SQLite database (gitignored)
```

---

## Roadmap

Feature tracking has moved to GitHub Issues: **[Tyler-Reagan/trip-kraken — Project Board](https://github.com/users/Tyler-Reagan/projects/2)**

Open issues cover planned work across optimization, persistence, UI, integrations, and documentation. Closed issues represent completed features with full implementation notes.

---

## License

Private / not yet licensed.