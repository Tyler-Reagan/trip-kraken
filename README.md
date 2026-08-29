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

Trips, locations, and itineraries are stored via **Drizzle ORM** (`src/lib/db/`) over a SQLite-family
database. Locally that's a single file, `db/dev.db`, opened directly — no server, no account
needed. Set `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` (see **Hosting** below) to point the same code
at a hosted Turso/libSQL database instead — the schema is identical either way.

**Caveats to be aware of:**

- **Local dev storage is still single-file.** Without `TURSO_DATABASE_URL` set, the database lives
  on the same machine as the server, with no sync or backup. If `db/dev.db` is deleted, all local
  trips are gone. A hosted Turso database doesn't have this caveat.
- **Authentication is a shared password, not accounts.** ADR-0037 gates every route behind a single `SITE_PASSWORD` checked in `src/proxy.ts` — sized for a couple of trusted people, not a real user base. There's no per-user identity, no rate limiting, and no audit trail.
- **Schema migrations are real, but still your responsibility to generate.** `db/migrations/`
  holds versioned SQL migrations (`drizzle-kit generate`), applied automatically on startup by
  `src/lib/db/client.ts`. If you change `schema.ts`, you're responsible for generating the
  migration — there's no drift detection.
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
| Database        | Drizzle ORM over `@libsql/client` — a local file in dev, Turso in production (ADR-0037) |
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

Copy `.env.example` to `.env.local` and fill in real values as you go through the steps below —
it's the checked-in source of truth for every variable this app reads, kept in sync with what's
actually configured on Vercel (see [docs/ci-cd-and-environments.md](docs/ci-cd-and-environments.md)
for how local, Preview, and Production env vars relate, and the runbook for changing a hosted one).

```bash
cp .env.example .env.local
```

At minimum:

```env
GOOGLE_MAPS_API_KEY=your_key_here
```

The key needs the following APIs enabled in Google Cloud Console:

- Maps JavaScript API (map tiles)
- Geocoding API (fallback coordinate resolution)
- Places API (Nearby Search, Text Search, Place Details)

The basemap (Stadia Maps, see ADR-0027) needs no key on `localhost` — it's subject to a strict but
unpublished rate limit instead. If that limit is ever hit, or the app is deployed off `localhost`,
add a free Stadia account's key:

```env
NEXT_PUBLIC_STADIA_API_KEY=your_key_here
```

### 3. Start VROOM and OSRM

Optimization (ADR-0023) and road travel cost (ADR-0024) depend on two self-hosted services,
defined in `docker-compose.yml`. There is no hosted alternative: `docs/research/hosted-routing-alternatives.md`
found that every hosted matrix API but one forbids the server-side matrix this app builds, in
their own terms of service. `docker-compose.yml` remains the local dev story; for a hosted
deployment, see **Hosting** below (ADR-0037) — the app itself is Vercel-shaped now, VROOM and OSRM
still aren't (and per ADR-0025/ADR-0037, don't need to be).

**Before the first build**, raise Docker Desktop's memory allocation to at least 12 GB
(Settings → Resources). This is a prerequisite, not a troubleshooting step: the default (7.75 GB
measured on a 16 GB host) is self-imposed, not a hardware ceiling, and the merged Extract below
needs headroom past it. Requires `osmium` on PATH too (`brew install osmium-tool` /
`apt install osmium-tool`) — same tool `ingest-transit-graph.sh` already depends on.

Then build the road graphs (one-time, re-run only when `scripts/osm-snapshot.env`'s pinned
snapshot moves):

```bash
pnpm build:osrm-graphs
```

This downloads three pinned Geofabrik regions — Kantō, Kansai and Chūbu (Tokyo, Kyoto/Osaka,
Nagoya) — merges them with `osmium merge` into one ~1.2 GB Extract, and runs
`osrm-extract`/`osrm-partition`/`osrm-customize` for the `foot` and `car` profiles against it
(`bicycle` was evaluated and dropped — see ADR-0024's 2026-08-09 amendment). A location outside
these three regions is not an error: the road provider declines it and travel cost falls back to
a straight line (ADR-0024, amended 2026-08-10 — hosted OpenRouteService was evaluated as a global
fallback for this gap and dropped; coverage grows by widening `OSM_ROAD_REGIONS`, not by adding a
weaker provider). Needs Docker, ~15 GB of disk once built (pruned of build-only intermediates —
the peak during a build is higher), and tens of minutes on first run.

**Building elsewhere and moving the result** is a legitimate alternative to raising this
machine's Docker memory — the build is dev-time and gitignored, so nothing requires it to run
here. On a machine with more headroom: `pnpm build:osrm-graphs`, then
`pnpm transfer:osrm-graphs pack`, then copy the resulting `osrm-graphs-*.tar.zst` over (scp,
rsync, a shared bucket) and run `pnpm transfer:osrm-graphs unpack <file>` on this machine.

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

### 4. Set a site password

The app is gated behind a single shared password (ADR-0037) — there are no user accounts. Add to
`.env.local`:

```env
SITE_PASSWORD=choose_something_not_guessable
```

Anyone without the password is redirected to `/login`; entering it sets a cookie that persists
until the password changes. This is sized for a couple of trusted people, not a public launch —
see ADR-0037 for the scope this deliberately doesn't cover (no rate limiting, no per-user
accounts).

### 5. Run

```bash
pnpm dev
```

App is available at [http://localhost:3000](http://localhost:3000).

---

## Hosting

ADR-0037 covers the whole hosting posture for a small, private deployment (1-2 trusted people,
not a public launch): the app on Vercel, the database on Turso, VROOM/OSRM on Fly.io.

**VROOM + OSRM on Fly.io.** `deploy/fly/` holds one `fly.toml` per service
(`vroom.toml`, `osrm-car.toml`, `osrm-foot.toml`), each configured for scale-to-zero
(`auto_stop_machines`/`auto_start_machines`, `min_machines_running = 0`) so the apps only cost
compute while actually handling a request, not for sitting idle. OSRM's two apps deploy straight
from the published `ghcr.io/project-osrm/osrm-backend` image — no build step — with a Fly Volume
mounted at `/data` for the graph files `pnpm build:osrm-graphs` produces locally. VROOM has no
published image (same reason as the local Docker build: nothing exists past `v1.14.0-rc.2`), so
it's deployed via `scripts/deploy-vroom-fly.sh`, which clones `VROOM-Project/vroom-docker` at the
pinned tag and deploys from that clone — Fly's Docker Compose import support for a service whose
build context is itself a remote git URL is unconfirmed, and cloning first sidesteps the question
entirely.

To (re)deploy:

```bash
./scripts/deploy-vroom-fly.sh
fly deploy --config deploy/fly/osrm-car.toml
fly deploy --config deploy/fly/osrm-foot.toml
```

The OSRM volumes need seeding once (or after rebuilding the graphs) — create the volume, run a
placeholder machine attached to it, and `fly sftp put -R` (or a loop over individual files) the
contents of `db/osrm/car`/`db/osrm/foot` before the real `osrm-routed` deploy, since `osrm-routed`
expects `/data/road.osrm*` to already exist. This is the same `db/osrm/` output
`transfer-osrm-graphs.sh` already knows how to move between machines — only the destination
(a Fly Volume, over SFTP) differs from moving it to a second laptop.

**Database on Turso.** See `src/lib/db/client.ts` — set `TURSO_DATABASE_URL` and
`TURSO_AUTH_TOKEN` (from `turso db show <name> --url` / `turso db tokens create <name>`, or
`scripts/setup-hosting-accounts.sh`) wherever the app runs. Unset, it falls back to a local
`db/dev.db` file, so local dev needs no Turso account.

**The app on Vercel.** Set `VROOM_URL`, `OSRM_FOOT_URL`, `OSRM_CAR_URL` to the three Fly `.fly.dev`
hostnames, plus `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` and `SITE_PASSWORD`, as Vercel environment
variables — everything `.env.local` already documents above, just pointed at hosted services
instead of `localhost`.

**Deploys are automatic** — Vercel's GitHub integration builds a Preview URL for every PR and
deploys straight to Production on every merge to `main`; there's no separate deploy workflow to
run by hand. See [docs/ci-cd-and-environments.md](docs/ci-cd-and-environments.md) for the full
pipeline, how to change a hosted env var (it needs a redeploy to take effect — easy to miss), how
to roll back a bad deploy, and the deliberate risk that Preview and Production currently share the
same database and VROOM/OSRM services. Cost factors for this whole setup are in
[docs/hosting-and-costs.md](docs/hosting-and-costs.md).

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