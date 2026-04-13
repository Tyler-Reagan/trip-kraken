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

Each location has a "Find Nearby" panel powered by the **Google Places Nearby Search API**. You can search within a configurable radius (500m–5km), filter by place type (restaurant, café, museum, park, etc.), and add results directly to the trip.

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
| External APIs   | Google Maps Geocoding API, Google Places Nearby Search API |
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
- Places API (nearby search)

### 3. Run

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
    places.ts       # Google Places Nearby Search client
    optimizer.ts    # K-means + nearest-neighbor TSP
    db.ts           # SQLite schema, queries, and transaction helpers
  types/
    index.ts        # Shared TypeScript types
db/
  dev.db            # SQLite database (gitignored)
```

---

## TODO / Planned Features

### Transit Recommendations

The current optimizer is distance-only — it has no awareness of actual travel time, public transit routes, or driving conditions. Integrating the Google Routes API (or Directions API) would allow the optimizer to factor in real travel time between stops, produce more practical daily schedules, and surface transit options (bus, metro, walking) between consecutive stops in the itinerary view.

### Itinerary Optimization Improvements

The nearest-neighbor TSP heuristic is fast but not optimal. Planned improvements:

- ~~2-opt local search post-processing — reverses route segments to eliminate crossings (~8–12% improvement over nearest-neighbor; `optimizer.ts` only, no schema changes)~~
- ~~Time-window constraints — soft penalties for visiting locations outside their opening hours; requires `openTime`/`closeTime` on `Location` and `visitDuration` to compute simulated arrival times~~
- ~~Day duration budget modeling — balance days by total visit + travel time rather than stop count; adds `visitDuration` to `Location` and a day budget input to `OptimizeModal`~~
- User-defined anchor — mark one location (e.g., a hotel) as the daily start/end point; each day's TSP runs anchor → stops → anchor instead of starting at the northernmost point
- Category balance across days — penalize k-means assignment when the same category concentrates on one day; uses existing `categories` field, no schema changes
- Multi-layer KML support — parse `<Folder>` elements from My Maps KML as named layers; store `layer` on `Location` and use it as the category source for balance optimization; group locations by layer in the sidebar
- Silhouette scoring for day count suggestion — compute k-means quality scores for k = 2…14 and surface a recommended day count in `OptimizeModal`
- Per-stop duration and notes in itinerary — show `visitDuration` and editable stop notes inline in `DayCard`; display total day time in the day header
- Single-day re-optimize — re-run TSP ordering for one day without destroying manual changes to the rest of the itinerary; adds a "Re-order this day" button to `DayCard`

### UI Overhaul

- ~~Dark mode~~
- ~~Full React component audit — reduce prop drilling, introduce context or lightweight state management~~
- ~~Layout improvements for mobile viewports~~
- ~~DOM and accessibility improvements (keyboard navigation, ARIA labels, focus management)~~
- ~~Better loading and error states throughout~~
- ~~Hide front page instructions behind button toggle~~

### Persistence Layer Improvements

- User authentication so trips are scoped to an account
- Cloud-backed storage option (e.g., Turso, PlanetScale, or Supabase) for access from multiple devices
- Proper schema migration tooling instead of `ALTER TABLE` on startup
- Trip sharing — generate a read-only shareable link for an itinerary
- Export — download itinerary as PDF or back to KML

### Places API & Recommendation System

- Use Place Details API to enrich imported locations with opening hours, phone numbers, and photos
- Smarter nearby recommendations: score results by relevance to the trip context (cuisine type, category balance per day)
- "Fill gaps" feature — automatically suggest nearby places to round out a light day
- Filter nearby results by open-now, price level, and minimum rating

#### Tabelog Integration (Japan)

[Tabelog](https://tabelog.com/en/) is the dominant restaurant discovery platform in Japan and better coverage than Google Places for Japanese dining. No official API exists — integration requires a scraper or wrapper.

- Build a Node.js/TypeScript adapter using [gurume](https://github.com/narumiruna/gurume) as a reference scraper (Python, actively maintained, rate-limiting built in)
- Add a `source` query parameter to `/api/trips/[id]/locations/[locationId]/nearby` to route between Google and Tabelog backends
- Add a data-source toggle to `NearbyDrawer` for switching between the two
- Map Tabelog fields (rating 0–5, review count, cuisine genres, budget) to the existing `NearbyPlace` type
- Respect robots.txt and use ≥2s delays between requests; Tabelog's ToS likely prohibits scraping so treat as internal-use only

### Custom Branding

- Replace placeholder name and logo with final brand identity
- Custom map style (MapLibre style spec) to match brand palette
- Favicon, og:image, and metadata

---

## License

Private / not yet licensed.