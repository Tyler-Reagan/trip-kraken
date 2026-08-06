# OSRM viability as trip-kraken's primary road-routing engine

- **Answers:** [#149](https://github.com/Tyler-Reagan/trip-kraken/issues/149)
- **Date:** 2026-08-06
- **Status:** Research findings. Not an ADR — the decisions below need one (or an amendment to
  ADR-0004/0018/0019) before implementation.
- **Code read at:** `refactor/path-kinds-p2-142` ([#148](https://github.com/Tyler-Reagan/trip-kraken/pull/148)),
  stacked on `refactor/path-taxonomy-p1-142` ([#147](https://github.com/Tyler-Reagan/trip-kraken/pull/147)).
  Neither is merged; every file reference below is to that branch, not `main`.
- **OSRM version read:** `master` as of 2026-08-06; latest release `v26.8.0` (2026-08-01).

## Recommendation

**Adopt self-hosted OSRM as the primary provider for `walking`, `driving`, and `bicycle`. Keep
Google, narrowed to exactly one job: scheduled transit outside Japan.** Google's road-mode
arms (`WALK`/`DRIVE`/`BICYCLE` in `GOOGLE_MODE_FOR_KIND`) become unreachable and, with them,
`computeFullMatrix`'s entire element-cap tiling loop.

The economic case is not marginal. Google bills `computeRouteMatrix` **per element**, elements are
origins × destinations, and trip-kraken fetches one full N×N matrix per optimize run — so cost is
quadratic in trip size. At Google's published Essentials rate of $5.00 per 1,000 elements, a
40-point trip costs **$8.00 per optimize run** and the 10,000-event monthly free allowance covers
**six runs** (§3). OSRM's `table` service is the same bulk-matrix shape, self-hosted, unmetered,
with the per-request cap a command-line flag rather than a bill.

Two findings matter more than the money, and both argue for merging #147/#148 rather than
reshaping them:

1. **OSRM's `route` service natively emits shift-decomposed journeys.** With `steps=true`, every
   `RouteStep` carries a `mode` field drawn from `driving | cycling | walking | ferry | train |
   pushing bike` ([`travel_mode.hpp`](https://github.com/Project-OSRM/osrm-backend/blob/master/include/extractor/travel_mode.hpp)).
   Grouping consecutive same-`mode` steps produces exactly ADR-0022-revised's "a Path ends at
   every discernible shift." OSRM would be the **first provider that can actually populate the
   `Path[]` decomposition P1/P2 declares and no current provider implements** — every provider on
   the branch today returns a single-element array. The revised taxonomy is validated by an
   independent engine's output shape, not merely internally consistent.
2. **The road-network-only assumption is confirmed and is, in one direction, wider than assumed.**
   OSRM's car/bicycle/foot profiles route over `route=ferry` and (car) `shuttle_train`, and report
   them as distinct step modes. So an OSRM driving journey can legitimately contain an
   `OtherPath` (a ferry). This is not scheduled transit — a ferry is a graph edge at a constant
   5 km/h with no timetable — so it reopens nothing, but it means `other` and the union's
   multi-kind machinery get exercised on day one.

Pre-merge shape changes are **small and mostly subtractive** (§Decision 2). No DB migration is
needed. `travelCostRegistry.ts` gains one entry, exactly as ADR-0019 promised.

---

## The four decisions

### 1. Is OSRM recommended as primary for `walking` / `driving` / `bicycle`?

**Yes, for exactly those three, with the caveat that OSRM's output also includes ferry and
shuttle-train segments that bin to `other`.** The road-network-only claim is confirmed against
primary sources (§2), so the scope is neither narrower nor wider than #149 assumed at the *kind*
level; it is wider at the *Path* level.

Gate adoption on a J5-style manual eval — the same instrument ADR-0019 used and that caught the
`lineTypeOf()` miscalibration. Specifically: spot-check OSRM walking durations against real-world
routing in hilly terrain (Kyoto Higashiyama, Hakone, Nagasaki), because OSRM's stock `foot`
profile is a **flat 5 km/h everywhere**, adjusted only by surface and tracktype, with no elevation
model ([`foot.lua`](https://github.com/Project-OSRM/osrm-backend/blob/master/profiles/foot.lua);
elevation requires an optional `process_segment` with an external raster, per
[profiles.md](https://github.com/Project-OSRM/osrm-backend/blob/master/docs/profiles.md)). The
stock `bicycle` profile is likewise flat 15 km/h with a 4 km/h push speed. Both are at ADR-0019's
declared altitude ("ordinal correctness, honest transfer topology, hour-granularity feasibility"),
but they are documented weaknesses, not assumptions.

**What Google is still good for, verified:**

| Candidate gap (#149's list) | Verdict |
| --- | --- |
| Traffic-aware ETA precision | **Real, but currently unexercised — not a reason to keep Google.** OSRM *can* ingest traffic (`osrm-customize --segment-speed-file`, CSV of `from_osm_id,to_osm_id,speed`), but supplies none itself ([Traffic wiki](https://github.com/Project-OSRM/osrm-backend/wiki/Traffic)). Google has it — but only via `TRAFFIC_AWARE`/`TRAFFIC_AWARE_OPTIMAL`, which `googleRoutesProvider.ts` does not request, which would bill at **Pro** ($8.00/1,000) rather than Essentials, and which `TRAFFIC_AWARE_OPTIMAL` caps at 100 elements. ADR-0018 §1 already rejected time-bucketed matrices as false precision at this altitude. So trip-kraken gets no traffic benefit from Google today and has no design that wants one. |
| Regional OSM data-quality variance | **Unverified — see "What I could not verify."** No first-party quantitative source found. The honest instrument is the manual eval, not a citation. |
| Bicycle-profile fidelity | **Not a demonstrable Google advantage.** OSRM's bicycle weakness is documented (flat speed, no elevation). Google's `BICYCLE` mode is undocumented as to method, so no comparison is possible from primary sources. Neither confirms nor kills the gap. |
| **Scheduled transit outside Japan** *(not in #149's list; found here)* | **Real, load-bearing, and the only surviving first-class Google job.** OSRM has no transit concept at all; the OSM-Japan graph is Japan-only by construction. A Trip in Paris or Taipei willing to use `rail`/`bus` has no other provider. |
| Google `placeId` waypoints | **Killed.** `googleRoutesProvider.ts` already sends lat/lng, not place IDs, and documents why. No gap. |
| Snapping quality | **Ambiguous, arguably OSRM's advantage.** OSRM snaps to the nearest routable edge for the loaded profile and *reports the snap distance* (`Waypoint.distance`, "the distance, in meters, from the input coordinate to the snapped coordinate"). Google's snapping is opaque. OSRM surfacing the error is worth more than Google hiding it. |

### 2. What should change in `PathProvider` / `TravelCost` / `PathBase` / the schema before #147/#148 merge?

**Nothing in the DB schema.** `Trip.allowedPathKinds` already holds the right vocabulary and OSRM
persists nothing (no key, no per-trip config; its base URL is env config like
`GOOGLE_MAPS_API_KEY`). Migration `0003` stands as written. This is a negative finding and it is
worth stating plainly: the schema question resolves to "no change."

Five changes to the TypeScript shapes, in descending order of confidence:

**(a) Narrow `PathGeometry` to `GeoJSON.LineString` only** — `src/types/path.ts`.

```ts
// before
export type PathGeometry = GeoJSON.LineString | string;   // string = encoded polyline
// after
export type PathGeometry = GeoJSON.LineString;
```

ADR-0022 chose the two-member union to "commit to the field, not to an encoding," on the evidence
that two encodings were already in play. OSRM removes that evidence: it emits GeoJSON natively
(`geometries=geojson`), so no provider is *forced* into an encoded string. Meanwhile the string
arm is now actively unsafe — OSRM offers `polyline` (precision 5) *and* `polyline6`, Google always
returns precision 5, and a bare `string` cannot distinguish them; a polyline6 geometry rendered as
polyline5 is silently wrong by a factor of ten. `computeRoutePolyline` keeps its own
`Promise<string | null>` return (the Places along-route corridor genuinely wants Google's encoded
form) and is not typed `PathGeometry`, so nothing breaks. Shrinking a union is far cheaper before
merge than after.

**(b) Make `lineName` optional on `OtherPath` only** — `src/types/path.ts`.

```ts
export type OtherPath = PathBase & { kind: "other"; lineName?: string; operator?: Operator };
```

`RailPath`/`BusPath` keep it required. Rationale: `lineName` was made required on the transit
kinds because "one Path, one service, one name" — true of a scheduled service, false of `other`.
OSRM's ferry steps carry `RouteStep.name` = the OSM way name, which is routinely empty for
unnamed ferry ways. `other`'s defining property is that we deliberately do not model it;
requiring a per-service identifier asks for more than the bin promises. A missing name on a
`rail`/`bus` Path is a data defect worth failing on; on a ferry it is normal.

**(c) Change the registry's `appliesTo` predicates from set-intersection to resolved-primary-kind**
— `src/lib/travelCostRegistry.ts`. **This one is a correctness fix, not an ergonomics one.**

The registry currently tests intersection (`kinds.includes("rail")`), which P2 introduced
deliberately. Inserting OSRM above Google breaks it: a Trip in Paris willing to use `rail` *and*
`walking` intersects OSRM's road-kind set, so OSRM wins and the Trip silently loses Paris rail
entirely. The fix is one line per entry — resolve first, match on the single kind the provider
will actually be asked for:

```ts
appliesTo: (points, kinds) => {
  const kind = resolvePrimaryPathKind(kinds);           // pathKind.ts, pure, already importable
  return (kind === "walking" || kind === "driving" || kind === "bicycle") && osrmConfiguredFor(kind);
}
```

This does not violate ADR-0022-revised's "thread the set through unresolved." Selection and
spending are different jobs: the *registry* needs one answer to "who is best for what this Trip
will actually do"; the *provider* still receives the whole set and spends it as it sees fit.
`PATH_KIND_PRECEDENCE` already puts `rail`/`bus` first, so OSM-Japan's predicate is unchanged in
behaviour by the rewrite. No interface change to `RegistryEntry`.

**(d) Add a snap-offset field to `PathEndpoint`, and fix what `lat`/`lng` mean on it** —
`src/types/path.ts`.

```ts
export interface PathEndpoint extends Point {
  locationId?: string;
  /** Meters from the Location's own coordinate to the point the provider actually routed from
   *  (OSRM `Waypoint.distance`). Absent when the provider does not snap or does not report it. */
  snapOffsetMeters?: number;
}
```

with the documented convention that `lat`/`lng` are the **routed** coordinates and `locationId` is
how you recover the Location's own. OSRM snaps every input to the road network and reports both
the snapped `location` and the `distance` from the input; today's Google provider copies the input
coordinate straight through, so a Path's endpoints currently claim a precision they do not have.
This is a real signal — a 300 m snap on a walking Path means 300 m of access walking is missing
from the cost — and it feeds #146's "is `basisOfCost` honest" question directly. This is the
weakest of the five: one optional numeric field with a concrete consumer, cheap now because it
changes what `from`/`to` *mean*, not merely what they carry.

**(e) De-duplicate `Point`** — `src/lib/geo.ts` and `src/types/path.ts` both declare
`export interface Point { lat: number; lng: number }`. They are structurally identical so
TypeScript never complains, but ADR-0022's own module table assigns `Point` to `geo.ts`, and
`pathProvider.ts`/`travelCostRegistry.ts` import it from `@/types/path`. Not OSRM-driven; a
pre-existing defect on the unmerged branch that is free to fix now.

**What deliberately does not change, and why the fit is clean:**

- `TravelCost`'s four fields map onto OSRM's `table` exactly: `durations[i][j]` is seconds,
  `distances[i][j]` is meters (both available together via `annotations=duration,distance`),
  `basisOfCost: "routingService"` covers OSRM as it covers Google, `costAsMinutes` derives.
- **Unreachable pairs need no nullable `TravelCost`.** OSRM returns `null` per cell for
  unroutable pairs, but also offers `fallback_speed` (fill from crow-flies distance at a given
  speed) plus `fallback_speed_cells` — "array of arrays containing `i,j` pairs indicating which
  cells contain estimated values." That is a per-cell list of exactly the cells that should be
  stamped `basisOfCost: "straightLine"`. The mixed-basis matrix #146 flags as a *problem* for the
  OSM-Japan provider is, for OSRM, a first-class response field. No interface change; ADR-0017's
  "degrade visibly" is satisfied by the enum tag that already exists. This retires #146's first
  open question in OSRM's favour.
- `PathProviderOptions` needs nothing. OSRM's per-request knobs (`annotations`, `fallback_speed`,
  `radiuses`, `snapping`, `exclude`, `geometries`, `steps`) are provider-internal decisions, the
  same way Google's field mask is.
- `describeJourney(from, to, kinds, opts): Promise<Path[]>` fits OSRM better than Google.
  OSRM's URL carries exactly one profile (`/route/v1/{profile}/…`), so the one-kind-per-request
  collapse `resolvePrimaryPathKind` already performs serves OSRM unchanged — and the `Path[]`
  return is finally non-degenerate.
- `costMatrix(points, kinds, opts)` fits and gets *simpler*. `--max-table-size` defaults to 100
  **locations** (10,000 elements) and is a server flag; set it to 1,000 and every trip is one
  request. Google's caps are 625 elements (non-transit) and 100 (transit) — matching
  `MAX_ELEMENTS` in `googleRoutesProvider.ts`, so that constant is verified correct — and are not
  raisable. `computeFullMatrix`'s batching has no OSRM counterpart.

### 3. Does this reorder or subsume P3 (Google `vehicle.type` + 17→3 binning)?

**Reorders it; does not subsume it. Its scope narrows and its priority drops, but it is the one
part of `googleRoutesProvider.ts` that survives.**

P3 exists because ADR-0022 forbids a provider from reporting transit detail without reporting
which kind of transit. Under this recommendation Google's only remaining first-class job is
non-Japan scheduled transit — precisely the code path P3 fixes. So P3 goes from "a hole in the
taxonomy" to "the last thing Google does, done properly."

Its urgency falls because the taxonomy no longer depends on it to be exercised: OSRM's
`RouteStep.mode` populates `driving`/`bicycle`/`walking`/`other` immediately, and demonstrates
decomposition, which P3 never would have. The binning table is already recorded in ADR-0022's
revised block, so nothing is lost by deferring.

Recommended order: merge P1/P2 → **new P3: the OSRM `PathProvider` plus step-mode decomposition**
→ **old P3, renumbered P4: Google `vehicle.type`, scoped to "Google is the non-Japan transit
provider."** Do this rather than the reverse, because the OSRM slice is what proves the union
shape, and proving it is the reason P1/P2 were held.

### 4. What does this mean for `travelCostRegistry.ts`'s precedence?

Four entries, not three. OSRM goes **second — above Google, below OSM-Japan.**

| # | id | `appliesTo` (resolved primary kind — see Decision 2(c)) |
| --- | --- | --- |
| 1 | `osm-japan` | `kind === "rail"` and `inJapan(points[0])` — unchanged in behaviour |
| 2 | `osrm` | `kind ∈ {walking, driving, bicycle}` **and** an OSRM base URL is configured for that kind |
| 3 | `google` | `GOOGLE_MAPS_API_KEY` present — in practice: non-Japan `rail`/`bus`/`other`, and road kinds when OSRM is unconfigured |
| 4 | `haversine` | always (the floor) |

Three things are load-bearing here:

- **The URL gate is not optional.** OSRM must be configured *per kind*, because one `osrm-routed`
  process serves exactly one profile — `car`, `bicycle`, and `foot` are three separate prepared
  datasets and three separate processes/ports (§3). Without a per-kind gate, a dev machine with no
  OSRM container silently drops from Google to nothing, or from a configured `car` dataset to a
  missing `foot` one.
- **Google is not deleted, and its entry does not gain a `kinds` condition.** It stays the global
  fallback, which is what makes an unconfigured local environment still work. Its *practical*
  scope narrows because entries 1 and 2 now cover Japan-rail and all road kinds respectively.
- **Selection stays applicability-based, not try-and-fallback** (ADR-0018 §4, ADR-0019). An OSRM
  instance that is configured but down errors the run, exactly as a missing `db/transit-japan.db`
  does. `fallback_speed` handles *unroutable pairs*; it does not handle *an unreachable server*,
  and conflating them would reintroduce the silent degradation both ADRs rule out.

---

## Evidence

### 1. License and hosting model

**Code license: BSD 2-Clause, confirmed.**
[`LICENSE.TXT`](https://github.com/Project-OSRM/osrm-backend/blob/master/LICENSE.TXT) —
"Copyright (c) 2017, Project OSRM contributors", BSD 2-Clause (Simplified). Permissive, no
copyleft, no obligation beyond retaining the notice. #149's assumption is correct.

**Actively maintained.** Latest release `v26.8.0`, published 2026-08-01; four releases in the six
weeks before this research. Not a dormant project.

**Self-hosting, concretely.** From the project's own
[README](https://github.com/Project-OSRM/osrm-backend/blob/master/README.md) quickstart, using the
official image `ghcr.io/project-osrm/osrm-backend`:

```
osrm-extract   -p /opt/car.lua  region.osm.pbf     # OSM → intermediate .osrm.* files
osrm-partition region.osrm                          # MLD: hierarchical cell decomposition
osrm-customize region.osrm                          # MLD: apply speeds/turn penalties
osrm-routed    --algorithm mld region.osrm          # HTTP server
```

The CH pipeline substitutes a single `osrm-contract` for partition+customize and serves with
`--algorithm ch`.

**MLD vs CH — which does trip-kraken want? MLD.** The README states MLD is "recommended by default
except for special use cases" and names CH's use case as "very large distance matrices."
trip-kraken's dominant query *is* a distance matrix, which superficially argues CH — but at
n ≤ ~60 (3,600 cells, one fetch per optimize run) matrix latency is nowhere near the binding
constraint, and "very large" means orders of magnitude beyond that. MLD wins on the argument that
actually matters here: `osrm-customize` re-applies speed and turn-penalty changes **without
re-partitioning**, and the Traffic wiki notes MLD's import is "significantly faster" than CH's.
ADR-0019 already treats speed constants as tunable placeholders pending calibration; MLD makes a
walking- or cycling-speed retune a `customize` re-run rather than a full re-contract. The choice
is also cheap to revisit — switching is a preprocessing re-run plus a server flag, not a code
change.

**Profiles are baked in at preprocessing time.** Per
[profiles.md](https://github.com/Project-OSRM/osrm-backend/blob/master/docs/profiles.md): "After
modifying a profile you will need to extract, contract and reload the data again." Profiles are
Lua (`setup`, `process_node`, `process_way`, `process_turn`, optional `process_segment`) and fully
customizable — but **not at query time**. Consequences: (i) the three stock profiles
(`car.lua`, `bicycle.lua`, `foot.lua`) are three independent preprocessing runs and three serving
processes; (ii) any speed calibration is an ops action, not a request parameter; (iii)
`PathKind` → profile is a static map, which suits `resolvePrimaryPathKind` exactly.

**Extract-refresh cadence.** Geofabrik publishes daily; ADR-0019 already pins a dated snapshot
(`japan-260101.osm.pbf`) and forbids rolling `-latest` URLs from automation. Recommend OSRM pin to
the *same* dated file and refresh on the same manual cadence, so rail topology and road topology
never disagree about which day's OSM they came from.

### 2. Road-network-only: confirmed

Three independent primary confirmations:

- **Service list.** The README's six services are Nearest, Route, Table, Match, Trip, Tile. None
  is transit-shaped; there is no schedule, no timetable, no departure-time parameter anywhere in
  [`docs/http.md`](https://github.com/Project-OSRM/osrm-backend/blob/master/docs/http.md).
- **Maintainer statement.** [Issue #1961](https://github.com/Project-OSRM/osrm-backend/issues/1961)
  ("Routing of Public Transport based on GTFS"), closed, maintainer `TheMarex`: "we don't plan to
  support public transport as it needs a completely different approach than street-network level
  routing."
- **Profiles.** Only car, bicycle, foot ship; `route=train` appears in `car.lua`'s
  `route_speeds` only as `shuttle_train = 10` (km/h) — car-carrying motorail, not passenger rail
  service.

**Where it is wider than assumed.** OSRM's internal travel modes
([`travel_mode.hpp`](https://github.com/Project-OSRM/osrm-backend/blob/master/include/extractor/travel_mode.hpp),
string forms from `travelModeToString`):

| OSRM `RouteStep.mode` | trip-kraken `PathKind` | note |
| --- | --- | --- |
| `driving` | `driving` | |
| `cycling` | `bicycle` | |
| `walking` | `walking` | |
| `pushing bike` | `walking` | The traveler is on foot. A bicycle journey honestly alternates `bicycle`/`walking` Paths. |
| `ferry` | `other` | `car.lua` `route_speeds.ferry = 5` km/h; also in `bicycle.lua`/`foot.lua`. Constant speed, no timetable — not scheduled transit. |
| `train` | `other` **(judgement call)** | `shuttle_train` motorail. Arguably `rail`, but OSRM supplies no service identity and the basis is `routingService`, not `railNetwork`. `other` is the honest bin; flag this for the implementer. |
| `steps up/down`, `river up/down`, `route` | n/a | Source comment: "FIXME only for testbot.lua". Not produced by stock profiles. |

`exclude=ferry` is available on `car.lua` (its `excludable` set is
`{toll, motorway, ferry, restricted, tunnel}`) if ferries ever need suppressing;
`bicycle.lua`'s ferry exclusion is commented out upstream.

### 3. API services mapped onto the P2 branch's primitives

#### `table` → `PathProvider.costMatrix` — clean, and simpler than Google

| OSRM field | Maps to | Notes |
| --- | --- | --- |
| `durations[i][j]` | `TravelCost.durationSeconds` | "Values are given in seconds." |
| `distances[i][j]` | `TravelCost.distanceMeters` | "Values are given in meters." Requires `annotations=distance` or `annotations=duration,distance`; `duration` alone is the default. Caveat quoted in the docs: "the distances are not the shortest distance between two coordinates, but rather the distances of the fastest routes" — which is what trip-kraken wants, and matches Google. |
| `null` cell | — | "Can be `null` if no route between `i` and `j` can be found." |
| `fallback_speed` (param) | `basisOfCost: "straightLine"` | "If no route found between a source/destination pair, calculate the as-the-crow-flies distance, then use this speed to estimate duration." |
| `fallback_speed_cells` | which cells get `straightLine` | "array of arrays containing `i,j` pairs indicating which cells contain estimated values based on `fallback_speed`." |
| `fallback_coordinate` | — | `input` (default) or `snapped`. Use `input`, so the fallback distance is Location-to-Location, matching `haversineProvider`. |
| `sources[]` / `destinations[]` | `PathEndpoint` | `Waypoint` objects: `location` (snapped [lng, lat]), `name` (street name), `distance` ("the distance, in meters, from the input coordinate to the snapped coordinate"), `hint`. |

Note the coordinate order: OSRM is `{longitude},{latitude}` throughout, both in the URL and in
`Waypoint.location`. trip-kraken's `Point` is `{lat, lng}`. A swap bug here is silent and produces
plausible-looking wrong distances; it belongs in the provider's tests.

**Per-request cap.** `--max-table-size` defaults to **100 locations**
([`routed.cpp`](https://github.com/Project-OSRM/osrm-backend/blob/master/src/tools/routed.cpp):
`value<int>(&config.max_locations_distance_table)->default_value(100)`). It is a server flag on
your own server. Google's 625/100 **element** caps are not. This is the single largest code
simplification available: `computeFullMatrix`'s origin-batch × dest-batch tiling exists solely to
work around Google's cap and has no OSRM counterpart.

Other `osrm-routed` defaults worth knowing: `--max-viaroute-size 500`, `--max-trip-size 100`,
`--max-matching-size 100`, `--max-nearest-size 100`, `--algorithm CH` (the binary's default
differs from the README's recommendation — set `--algorithm mld` explicitly).

#### `route` → `PathProvider.describeJourney` — the decomposition seam

`GET /route/v1/{profile}/{lng},{lat};{lng},{lat}?steps=true&geometries=geojson&overview=full`

- `routes[0].distance` (float meters) / `.duration` (float seconds) → the Journey total.
- `routes[0].legs[]` → one per waypoint pair. For a two-point A→B query there is exactly one leg;
  legs are **not** Paths.
- `legs[].steps[]` → maneuver granularity (every turn). **Not** Paths either — emitting one Path
  per step would produce hundreds per journey.
- **`steps[].mode`** → the actual shift boundary. Group consecutive steps by `mode`; emit one
  `Path` per contiguous run. Sum each run's `distance`/`duration` into that Path's `TravelCost`;
  concatenate each run's `geometry` into the Path's `PathGeometry`. This is the implementation
  note that matters.
- `waypoints[].location` / `.distance` → `PathEndpoint` (see Decision 2(d)).
- `legs[].annotation` (with `annotations=true`) carries per-node `nodes` (OSM node IDs),
  `distance`, `duration`, `speed`, `datasources` — more than needed, but the `nodes` array is how
  a future #142 would tie geometry back to OSM ways.

`geometries` accepts `polyline` (precision 5, default), `polyline6`, or `geojson`. Request
`geojson` — this is what makes Decision 2(a)'s narrowing possible.

#### `trip` → **not a candidate for the optimizer's category-B track. Close the door.**

OSRM's `trip` service solves TSP, and on its face that looks like the alternative solver
`docs/agents/optimizer-rebuild.md` describes. It is not, on three independent grounds, any one of
which is disqualifying:

1. **Wrong objective.** Per the HTTP docs it "[u]ses the Traveling Salesman Problem using a greedy
   heuristic (farthest-insertion algorithm) for 10 or more waypoints and uses brute force for less
   than 10 waypoints." That minimizes tour cost, full stop. trip-kraken's authoritative objective
   is **feasibility ≫ travel as two lexicographic tiers** (ADR-0016) — a closed-hours violation
   must always lose to a feasible candidate regardless of travel cost. `trip` has no term for
   that and no way to express one.
2. **No constraint vocabulary.** `trip` accepts `roundtrip`, `source` (`any`|`first`),
   `destination` (`any`|`last`), and the shared geometry/steps options. There is no time window,
   no service duration, no day mask, no capacity, no multi-vehicle concept. ADR-0020's
   eligible-day masks, ADR-0016's day budget, and `visitDuration` have nowhere to go. It is a
   single-tour TSP, not a VRPTW.
3. **Wrong shape entirely.** trip-kraken's problem is multi-day: assign N activities to D days,
   *then* sequence within each day, under lodging anchors (ADR-0005). `trip` returns one tour. And
   "[a]ll input coordinates have to be connected for the trip service to work" — a hard failure
   where the optimizer needs graceful per-cell degradation.

The genuine category-B candidate remains a VRPTW solver fed by OSRM's `table` output, which is
what `table` is *for*. OSRM's value to the optimizer is the matrix, not the tour.

#### `match`, `nearest`, `tile` → dismissed

`match` snaps noisy GPS traces to the road network. trip-kraken has no GPS traces; Locations are
Google-canonical coordinates (ADR-0009). Irrelevant. `nearest` (snap one coordinate, return the
`n` closest street matches) is a diagnostic worth knowing about — it is the cheapest way to debug
a Location that snaps somewhere absurd — but is not on any hot path. `tile` emits Mapbox Vector
Tiles of internal routing metadata; a debugging aid, unrelated to `MapView.tsx`'s basemap.

### 4. Operational cost, quantified

#### Google, at trip-kraken's actual volume

Verified from `googleRoutesProvider.ts` and `solver.ts` on the P2 branch:

- `solve()` fetches **one** matrix per optimize run and passes it into `optimizeItinerary` as
  `precomputedDist` — the duplicate fetch that `optimizer-rebuild.md` flagged was fixed (#82).
  ADR-0004's one-fetch-per-run pattern holds.
- `computeFullMatrix` tiles into `floor(sqrt(MAX_ELEMENTS))`-sized batches (25 for road modes, 10
  for transit) over the full origin × destination cross-product, so **total billed elements =
  n²** exactly, where n = points with valid coordinates (placeable activities + lodging and edge
  anchors).
- `MAX_ELEMENTS` (`TRANSIT: 100`, others `625`) matches Google's documented caps precisely — the
  constant is verified correct against
  [compute_route_matrix](https://developers.google.com/maps/documentation/routes/compute_route_matrix):
  "The number of elements cannot exceed 625 for routes that are not `TRANSIT` routes… If you
  specify a `TRANSIT` route, the number of elements cannot exceed 100."

Google bills `computeRouteMatrix` "per ELEMENT returned from the request. The number of elements
is the number of origins multiplied by the number of destinations"
([usage and billing](https://developers.google.com/maps/documentation/routes/usage-and-billing)).
Published rate, **Routes: Compute Route Matrix Essentials** (SKU 9392-1087-2045,
[pricing](https://developers.google.com/maps/billing-and-pricing/pricing)): 10,000 free events per
month, then **$5.00 per 1,000** up to 100,000, $4.00 to 500,000, $3.00 to 1M. The current request
uses no `routingPreference`, so it bills Essentials, not Pro ($8.00/1,000, triggered by
`TRAFFIC_AWARE`/`TRAFFIC_AWARE_OPTIMAL`).

| Trip size (valid-coord points) | Elements per optimize run | Cost per run @ $5.00/1,000 | Free-tier runs per month |
| --- | --- | --- | --- |
| 20 | 400 | $2.00 | 25 |
| 40 | 1,600 | **$8.00** | 6 |
| 60 | 3,600 | $18.00 | 2 |
| 100 | 10,000 | $50.00 | 1 |

The free allowance is per **billing account**, not per user. The cost is **quadratic in trip
size** and **linear in re-optimize count** — and iterative re-optimization is the product's core
loop (CONTEXT.md: "an iterative discovery → refinement loop"). A single user refining a 40-point
trip twenty times in a month costs $110.

#### OSRM, self-hosted, Japan-sized

Sizing against a Japan extract per ADR-0019's single-region invariant, not planet.
[Geofabrik Japan](https://download.geofabrik.de/asia/japan.html): `japan-latest.osm.pbf` = **2.3
GB** (page read 2026-08-06, data through 2026-08-05). Sub-region extracts exist if scope ever
narrows — Kantō 460 MB, Kansai 332 MB, Chūbu 483 MB — but nationwide is the ADR-0019 default.

OSRM's own [Disk and Memory Requirements](https://github.com/Project-OSRM/osrm-backend/wiki/Disk-and-Memory-Requirements)
wiki gives planet figures (v5.26, Nov 2021) and states scaling is roughly linear in input size.
Japan/planet ≈ 2.3 GB / 61 GiB ≈ **3.5%**. Extrapolated, **per profile**:

| Stage | Planet (car) | Japan estimate |
| --- | --- | --- |
| `osrm-extract` RAM | 415 GiB | ~15 GiB |
| `osrm-partition` RAM | 220 GiB | ~8 GiB |
| `osrm-customize` RAM | 174 GiB | ~6 GiB |
| `osrm-contract` (CH) RAM | 230 GiB | ~8 GiB |
| `osrm-routed` serving RAM | ~123 GiB | ~4.3 GiB |
| generated datafiles, disk | ~300 GB | ~11 GB |

**These are derived, not measured — see "What I could not verify."** Two corrections to apply:
the wiki notes `foot` costs ~15% more than car (476 vs 415 GiB on extract) with cycling between;
and **three profiles means three of everything**, since a profile is baked in at preprocessing and
one `osrm-routed` serves one dataset. So: ~33 GB disk and ~14 GiB resident if all three are served
simultaneously — or much less with `--mmap`, or by serving car+foot and treating bicycle as
optional.

That is one ordinary cloud VM (8–16 GB) at roughly $40–80/month for **unlimited** queries. It pays
for itself against **ten** 40-point optimize runs. Preprocessing is a periodic batch job that can
run on a larger short-lived machine and does not size the serving box.

### 5. Pipeline overlap with the existing OSM-Japan ingest

**Shared where it is expensive; disjoint where it is cheap and vendor-supplied.**

`scripts/ingest-transit-graph.sh` today:

```
curl → https://download.geofabrik.de/asia/japan-260101.osm.pbf   (pinned, dated)
osmium tags-filter  → rail route + stop_area relations only
osmium cat -f osm   → OSM XML
tsx scripts/ingest-transit-graph.ts → db/transit-japan.db (SQLite)
```

OSRM would consume **the same downloaded `.osm.pbf`, unfiltered** — `osrm-extract` reads `.pbf`
natively, and the README's own quickstart downloads from Geofabrik. So the download and the
pinned-URL constant are genuinely shared; only the post-download tooling diverges, and OSRM's half
is entirely vendor Docker commands rather than code trip-kraken maintains (no osmium in OSRM's
path; no Lua in trip-kraken's).

The two artifacts are **complementary, not redundant**: `osmium tags-filter` *discards* the road
network, which is exactly what OSRM needs; OSRM's profiles ignore rail route relations, which is
exactly what the rail graph needs. Neither duplicates the other's routing responsibility.

Concrete answer to #149's framing: **incremental at the data-source layer, a second pipeline after
it, and the second pipeline is not trip-kraken's code.** The minimal change is to hoist
`GEOFABRIK_URL` and the downloaded file into a shared step, then branch — either as a new stage in
the existing script or a sibling `scripts/build-osrm-graphs.sh` importing the same pin. One
snapshot date governs both graphs, which is worth more than the shell-script tidiness.

### 6. Data licensing

**Adding OSRM introduces no new class of obligation.** Both graphs derive from the same ODbL 1.0
Geofabrik extract ("Data processed by Geofabrik GmbH and created by OpenStreetMap Contributors |
License: ODbL 1.0"). The analysis below applies identically to `db/transit-japan.db` today.

Against the [ODbL 1.0 text](https://opendatacommons.org/licenses/odbl/1-0/):

- **The prepared `.osrm.*` files are a Derivative Database** — §1 defines one as "a database based
  upon the Database, and includes any translation, adaptation, arrangement, modification". A
  contracted or partitioned routing graph is plainly that. §4.5(c): "Use of a Derivative Database
  internally within an organisation is not to the public and therefore does not fall under the
  requirements of Section 4.4" — the graph is never conveyed, only queried server-side.
- **A route result shown to a user is a Produced Work** — §1: "a work … resulting from using the
  whole or a Substantial part of the Contents (via a search or other query) from this Database."
  §4.5(b): "Using this Database, a Derivative Database, or this Database as part of a Collective
  Database to create a Produced Work **does not create a Derivative Database** for purposes of
  Section 4.4." So **share-alike does not attach to trip-kraken's application code or its
  itineraries.**
- **§4.3 attribution does attach**: "if you Publicly Use a Produced Work, You must include a
  notice associated with the Produced Work reasonably calculated to make any Person that uses,
  views, accesses, interacts with, or is otherwise exposed to the Produced Work aware that Content
  was obtained from the Database … and that it is available under this License."
- **§4.6 also attaches**, because trip-kraken publicly uses a Produced Work *from* a Derivative
  Database. It requires offering recipients either "(a) The entire Derivative Database; or (b) A
  file containing all of the alterations made to the Database or the method of making the
  alterations to the Database (such as an algorithm)". Option (b) is satisfied cheaply: publish
  the pinned Geofabrik URL plus the exact `osrm-extract`/`partition`/`customize` invocations and
  the profile Lua files used. `scripts/ingest-transit-graph.sh` is already this artifact for the
  rail graph; an OSRM sibling script would be the same for roads.

Per the [OSMF Attribution Guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines),
acceptable wording is "© OpenStreetMap contributors" (or "OpenStreetMap", or a qualified form like
"Map data from OpenStreetMap"), and — directly on point — "**Routing instructions** generated by
such a routing engine need not maintain attribution attached to the instructions, as long as they
do not form a Derivative Database." So per-Path attribution is not required; an app-level credit
is.

**One actionable, pre-existing gap surfaced by this:** a repository-wide search finds **no OSM
attribution anywhere in `src/`** — not in `MapView.tsx`, not in `TransitEstimateCaveat.tsx`, not
in any doc. trip-kraken already owes §4.3 attribution for the OSM-Japan rail graph's line names
and durations and does not provide it. OSRM does not create this obligation; it doubles the
surface it applies to. Fix it as part of whichever slice lands next.

---

## What I could not verify

Stated plainly rather than smoothed over. Each of these would change a number, not the
recommendation, unless noted.

- **Measured preprocessing and serving figures for a Japan extract.** The §4 table is a linear
  extrapolation from OSRM's own planet figures, on the strength of the wiki's own statement that
  scaling is roughly linear — but the wiki is dated to v5.26 (Nov 2021) and current OSRM is v26.8.
  No first-party country-extract benchmark exists that I could find. **Confidence: moderate for
  order of magnitude, low for any specific number.** The cheap resolution is to run the pipeline
  once on a laptop and record the real numbers; that is an afternoon, not a research task.
- **Preprocessing wall-clock time.** No first-party figure at any extract size. Unverified
  entirely.
- **Regional OSM road/footway data-quality variance in Japan.** #149 named this as a plausible
  Google gap. I found no first-party, quantitative source — not from OSMF, not from Geofabrik, not
  from OSRM. It is neither confirmed nor killed. **This matters**: it is the one candidate gap
  that, if real and severe, would argue for keeping Google first-class on `walking` in specific
  regions. The right instrument is not a citation but the J5-style manual eval ADR-0019 already
  institutionalized — spot-check twenty real walking and driving Journeys against consumer routing
  before flipping the registry precedence, and treat a systematic bias as a blocker rather than a
  calibration note.
- **Whether a `TRANSIT` `computeRouteMatrix` request bills Essentials or higher.** Google's tier
  documentation names only `TRAFFIC_AWARE`/`TRAFFIC_AWARE_OPTIMAL` (Pro) and two-wheel routing
  (Enterprise) as triggers, and does not enumerate the full per-tier field lists on the pages I
  could read. I assumed Essentials. If TRANSIT bills Pro, every figure in §4 is 1.6× higher and
  the recommendation strengthens.
- **Whether Google's `BICYCLE`/`WALK` modes model elevation.** Google publishes no method. OSRM's
  weakness here is documented; Google's corresponding strength is not. The comparison is
  unavailable from primary sources, so #149's "bicycle-profile fidelity" gap is recorded as
  undecided rather than killed.
- **OSRM query latency for a 40×40 `table` on a Japan MLD graph.** Not measured. The MLD-vs-CH
  recommendation rests on the README's own guidance plus the reversibility of the choice, not on a
  benchmark. If MLD table latency ever bites, `--algorithm ch` is a preprocessing re-run.
