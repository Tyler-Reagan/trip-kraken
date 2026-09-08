# ADR-0042: MapKit supplies road geometry on-device; the server keeps only rail

- **Status:** Accepted
- **Date:** 2026-09-07
- **Supersedes:** —
- **Superseded by:** —
- **Constrained by:** ADR-0039 (MapKit as the rendering stack), ADR-0023 (VROOM is the Decision
  layer, untouched), ADR-0038 (VROOM/OSRM/the rail graph stay server-side for Phase A), ADR-0029
  (path geometry is fetched at request time, never persisted)

## Context

ADR-0039 evaluated `MKDirections` once already, but only as a candidate *order optimizer* — the
user's initial framing was "hand off to MapKit to handle optimal routing" — and found that false:
`MKDirections` computes a route between exactly one source and one destination, with no
waypoint-order-optimization capability at all. That finding is correct and unaffected by this ADR.
It never considered `MKDirections` as a *geometry source* for a pair whose order VROOM has already
decided, which is a different question with a different answer.

Checked against Apple's actual current API before deciding, not assumed from training-data memory:

- **`MKDirections.calculate()` returns a real `MKRoute.polyline`** for `.walking` and `.automobile`
  transport types — the same two profiles `roadProfile` already selects between for OSRM
  server-side (ADR-0024). This is on-device, free, and requires no server call at all.
- **`.transit` is not supported by `calculate()`.** Apple's own forums confirm it returns
  `directionsNotFound`; only `calculateETA` handles transit, and that returns arrival/departure
  times with no route geometry. This means MapKit cannot answer for rail pairs at all — it cannot
  replace the OSM-Japan rail graph (ADR-0019/ADR-0024), which is this app's actual differentiator
  for Japan itineraries.
- **Rate limits are real but undocumented.** `MKDirections` requests are throttled
  (`MKError.loadingThrottled`) at limits Apple does not publish and reserves the right to change.
  Developer reports place the practical ceiling in the neighborhood of tens of requests before
  throttling; a multi-day trip's pair count can exceed that easily. Any client using this
  capability must serialize requests and back off on throttle, not fire a trip's worth of pairs at
  once.

Given these three facts, the road-profile portion of the existing `/api/trips/[id]/path-geometry`
endpoint's job — currently served by OSRM containers (ADR-0024) — is answerable entirely on-device
for the walking/driving case, using a resource that costs nothing and requires no self-hosted
infrastructure. The rail case still requires the server; nothing about the OSM-Japan graph moves.

`MKRoute` also carries `distance` and `expectedTravelTime`. Checked before deciding what to do with
them: unlike the web app's server, **the Swift client has no separate per-pair cost source for a
road pair at all.** VROOM's optimize-time matrix is a server-side input to the solver — it decides
stop *order*, but is never exposed as a queryable "what does this cost" API the client can consult
afterward. The only place a road pair's cost or geometry reaches the Swift client is this same
path-geometry pipeline. So there is no existing answer to preserve for a MapKit-served pair: MapKit
becomes this pair's sole cost-and-geometry source, the same way OSRM is the sole source for it
today. This is a real, named residual — a MapKit-answered pair's displayed duration can disagree
with whatever number VROOM's server-side matrix used to decide order, the same category of
disagreement the existing path-geometry endpoint's own documentation already accepts as bounded and
understood for provider-mismatch pairs (Google-costed bus legs drawn and timed by OSRM/haversine
instead). `answeredBy: .mapkit` (a new `ProviderId` case) keeps this honestly labeled rather than
misattributed to `.osrm`.

## Decision

**A `MapKitGeometryProvider` answers walking and driving pairs on-device, using `MKDirections`.
Rail pairs are declined, not attempted, and continue to be answered by the server's OSM-Japan
graph over the (new, ADR-0043) trip-less HTTP endpoint. A composite provider dispatches each pair
by kind and lets the pair's own held Path chain contribute only geometry, never cost.**

Concretely:

1. `MapKitGeometryProvider` (`TripKrakenRouting`) builds one `MKDirections.Request` per pair, with
   `transportType` from the trip's `roadProfile` (or the pair's `JourneyRoadKind` choice when one
   exists), and maps the resulting `MKRoute` into a single-span `Path` — `polyline` becomes
   `PathGeometry`, and `distance`/`expectedTravelTime` become this pair's `TravelCost`
   (`basisOfCost: .routingService, answeredBy: .mapkit`), since nothing else in the Swift client
   answers a road pair's cost at all (see Context).
2. Requests are serialized through an actor-isolated queue, one in flight at a time, with
   exponential backoff on `MKError.loadingThrottled`. The active Day's pairs are served first; the
   renderer already tolerates a partially-answered batch (an unanswered pair draws dashed), so
   there is no correctness requirement to answer a whole trip in one burst.
3. `MapKitGeometryProvider` itself has no notion of "this pair is rail" — the seam
   (`PathGeometryProviding`, `TripKrakenKit`) carries a `RoadProfile`, not a `PathKind`, so a
   single provider only ever sees "walking or driving." Rail exclusion is therefore the
   *composite's* job (ADR-0043): it asks the HTTP/rail provider first and only ever routes a pair
   to `MapKitGeometryProvider` when nothing rail-capable claimed it. This keeps
   `MapKitGeometryProvider` simple and matches how it is used standalone today (Phase A has no
   rail provider yet, so every pair it receives is, in fact, a road pair).
4. This does not reach into VROOM's own optimize-time matrix or change how the plan's stop order
   was decided (ADR-0023) — it only changes what answers a display-time query for one pair's
   geometry/cost on the map, after the order is already fixed.

## Alternatives considered

- **Do nothing; keep all road geometry server-side via OSRM, as today.** Simpler, but forgoes a
  real, no-cost capability that removes a server round-trip for the large majority of a typical
  trip's pairs (rail-heavy Japan itineraries aside) and is a genuine, unplanned step toward
  ADR-0038's Phase B end goal, landing during Phase A at no extra infrastructure cost.
- **Attempt `.transit` via `MKDirections` for rail pairs.** Rejected as infeasible, not merely
  undesirable — confirmed against Apple's own API behavior that `calculate()` returns
  `directionsNotFound` for `.transit`; only ETA-only `calculateETA` supports it. Recorded here so
  it isn't re-opened without new information from Apple.
- **Withhold `distance`/`expectedTravelTime` and leave a MapKit-answered pair costless (geometry
  only).** Considered, since it would avoid the VROOM-disagreement residual entirely. Rejected as
  strictly worse: `PathBase.travelCost` is non-optional, a synthetic zero-cost value would be a
  silent lie rather than an honest unknown, and nothing downstream currently *reads* a road pair's
  displayed cost anyway (Phase A's UI shows visit duration, not travel duration) — so the
  disagreement this ADR accepts costs nothing in practice today and is cheap to revisit if that UI
  is ever built.
- **Fire every pair in a Day (or the whole trip) concurrently.** Rejected given the undocumented,
  unpublished throttle ceiling — a burst risks failing most of a batch instead of degrading
  gracefully. Serialized-with-backoff is slower per pair but correct under an unknown limit.

## Consequences

- **The server's geometry job narrows to rail.** Once ADR-0043's trip-less endpoint lands, OSRM's
  walking/driving containers (ADR-0024) are no longer in the path-geometry request path at all for
  the Swift client — they remain exactly as they are for the web app, which is unaffected by this
  ADR (MapLibre continues fetching geometry from the existing trip-scoped endpoint).
- **This is the first piece of ADR-0038's Phase B (full on-device) to land during Phase A.** Not a
  scope change to ADR-0038 — VROOM's solver and the OSM-Japan graph remain server-side exactly as
  that ADR decided — but a data point that on-device capability can arrive incrementally rather
  than as a single all-or-nothing cutover.
- **MapKit's request throttle becomes a real operational constraint the client must handle**, not
  a theoretical one. If real-world use shows the ceiling is lower than a single Day's pair count,
  the fallback is the server (OSRM already answers this profile today) — the composite provider
  seam (`PathGeometryProviding`, `TripKrakenKit`) makes that a reordering of dispatch priority, not
  a rewrite.
- **A MapKit-answered road pair's displayed cost can disagree with VROOM's own optimize-time
  matrix for the same pair.** Accepted and named, not hidden — the same category of residual the
  existing endpoint already tolerates for Google-costed bus legs. Nothing in Phase A's UI surfaces
  a road pair's travel cost today, so this has no visible effect yet; revisit if that changes.
  `ProviderId.mapKit` keeps the answer honestly attributed rather than mislabeled as `.osrm`.
