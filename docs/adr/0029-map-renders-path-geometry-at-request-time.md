# ADR-0029: The map renders one line per Path, from geometry fetched at request time and held only in memory

- **Status:** Accepted
- **Date:** 2026-08-17
- **Supersedes:** —
- **Superseded by:** —
- **Constrained by:** ADR-0021 (Path is derived from the Plan, never stored), ADR-0022 (a Journey is
  "not stored and not scored"), ADR-0024 (§4's registry order and §6's narration dispatch), ADR-0026
  (the first request-time `describeJourney` call outside optimize), ADR-0028 (a `straightLine` Basis
  of cost is not a defect to hide), ADR-0027 (Stadia supplies the basemap; the Plan's own lines are
  drawn by MapLibre over it)
- **Note:** Decided by resolving issue
  [#182](https://github.com/Tyler-Reagan/trip-kraken/issues/182)'s grilling questions, under map
  [#181](https://github.com/Tyler-Reagan/trip-kraken/issues/181). Two of the six answers reached in
  that grilling were corrected afterwards by reading the code — see §2 and §5, which record what the
  obvious reading of ADR-0026's precedent would have got wrong.

## Context

`MapView.tsx` draws exactly one straight `LineString` per Day, built from raw Location coordinates in
visit order, for every kind of travel alike. It never calls `describeJourney` and never reads a
Path's `geometry`. Meanwhile `osrmProvider.describeJourney` already returns real OSRM geometry for
walking and driving, and `PathBase.geometry` (a GeoJSON `LineString`) already exists, optional, on
every Path variant. The walking/driving half of "show the traveler's real path" therefore needs no
new data captured — only wiring.

Rail geometry is not ingested yet (issue #142) and bus geometry is not requested from Google at all
(#181 puts it out of scope). So any decision made here must degrade honestly for the kinds that have
no real shape to draw, rather than assume all Paths will eventually have one.

Two facts about the existing routing layer shape this decision, and neither is visible from the
domain model alone:

- **Registry dispatch answers a whole Journey from the first entry whose declared kinds intersect the
  request** (ADR-0024 §6). `osm-japan` is row 1, declares `kinds: ["rail"]`, and its gate is true for
  any Trip in Japan with the graph file present — which is the target case, not an edge case.
- **`osrm` declines a pair by snap distance rather than erroring** (ADR-0024's 2026-08-10 amendment),
  and the terminal `haversine` entry then answers with `basisOfCost: straightLine`. That decline is a
  statement about the current Extract's coverage, not a permanent fact about the two Locations —
  `osrmProvider`'s own module doc says road coverage grows by widening the Extract.

Nothing in the project persists routing output today. The schema holds `Trip`, `Location`, and
`Placement` and nothing else; `isPersistable` (`types/path.ts`) is referenced only by tests. It is a
guard-rail written ahead of a cache that does not exist.

## Decision

**The map renders one line per Path, using real geometry where a Path has it and a visibly distinct
straight line where it does not. Geometry is fetched at request time, scoped to the Trip's Road
profile alone, and held only in memory — never written to the database.**

### 1. One line per Path, not one per Day

A Day's line becomes N features, one per Path, sharing that Day's colour and its active/browsed
opacity tier. The alternative — keeping one Day-level line and upgrading its coordinates only when
every constituent Path has geometry — is rejected because a Day with four routed Paths and one
unroutable pair would render entirely straight, hiding four real answers behind one missing one.

Per-Path is also the shape the data already has: `describeJourney` returns `Path[]`, and
`osrmProvider` splits a single requested pair into multiple Paths at every shift (a walk that crosses
a ferry returns `walking` and `other`). A per-Day line cannot represent that without discarding it.

### 2. Geometry is requested with the Trip's Road profile alone, never the full kind list

The lookup passes `[trip.roadProfile]` — not `["rail", "bus", roadProfile]`, which is what
`selfHeal.ts`'s `healKinds` passes and what copying ADR-0026's precedent would suggest.

This is load-bearing, not a micro-optimization. With the full kind list, `osm-japan` matches on
`rail` first and answers **every** pair for any Trip in Japan, returning Paths that carry no geometry
at all — the map would show no real shapes precisely where the product is aimed. `google` would also
match on `bus`, spending money per call on every map load, for data ADR-0018 forbids persisting.

Narrowing to the Road profile makes both entries fail the kind intersection and drop out. `osrm`
answers or declines; `haversine` fills the rest. That yields exactly the two states §3 needs, and it
is correct only because this ADR scopes rendering to walking and driving (§4).

### 3. A `straightLine` Path is drawn as visibly straight

ADR-0028 established that a `straightLine` Basis of cost is an honest report, not a defect to
suppress. A Path with real geometry draws solid; a Path without draws dashed, keeping the same Day
colour and opacity so the distinction reads as *provenance*, never as emphasis.

The renderer keys this off the presence of `geometry`, not off `basisOfCost` — "we have a real shape
to draw" is the question the map is actually asking, and it stays correct if a future provider
returns a real Basis of cost with no shape attached (rail, once #142 lands).

### 4. Walking and driving ship first; other kinds stay straight without special marking

Rail and bus Paths render with the same straight dashed style as an OSRM decline. No third "geometry
pending" state is introduced. Such a state is temporary by definition — #142 removes it for rail —
and would cost styling work to represent a fact about our ingest backlog rather than about the
traveler's Plan.

### 5. Geometry is held in memory, keyed by pair, and only missing pairs are requested

The client keeps a map from `(Road profile, from coordinate, to coordinate)` to the Paths that pair
resolved to, and requests only the pairs it does not already hold. Coordinates key it rather than
Location ids, so re-geocoding a Location invalidates its entries by construction; the Road profile is
in the key, so changing that setting does the same.

This is required, not an optimization. `reload()` is called from roughly fifteen places in
`tripStore.ts` — after every move, removal, optimize, and field edit — and each call replaces the
Trip and so re-derives every Day. Without a pair-keyed store, one drag of a Placement re-requests
every pair in the Trip (about a hundred on a two-week Plan), and `movePlacement`'s optimistic update
makes it happen twice. With one, a drag requests the two or three pairs that became newly adjacent,
and switching Days requests nothing.

The store is session state in the browser. It is discarded on reload, and neither the server nor the
database retains anything — so §6's prohibition is unaffected.

### 6. Nothing is persisted

No table, no column, no server-side cache. The map's geometry is a request-time computation, exactly
as `CONTEXT.md` already describes a Journey — "not stored and not scored."

This is the point on which the domain model and the practical hazard agree, so it is worth recording
both. `CONTEXT.md` says a Path is "derived from the Plan, never stored," and persisting geometry
would make this the project's first persisted routing output. Independently: a `straightLine` result
is a statement about the Extract of the moment (see Context). Stored, it would survive an Extract
rebuild that made the same pair routable, and the map would keep drawing a dashed line while
believing itself correct — a wrong answer with no signal that it is wrong.

### 7. The map never waits on geometry

Straight lines render immediately from coordinates already in the store, exactly as today, and each
Path's line is replaced when its geometry arrives. A slow or stopped OSRM container therefore
degrades the map to its current behaviour rather than blanking it, and no loading state is introduced
for a canvas that has always drawn synchronously.

## Alternatives considered

- **Persist geometry in the database.** Rejected (see §6). Legally available — `answeredBy: "osrm"`
  is persistable under `PersistableTravelCost`, so ToS is not the obstacle — but it contradicts
  `CONTEXT.md`'s "never stored," makes this the first stored routing output in the project, and
  freezes `straightLine` verdicts that are expected to change as the Extract widens. Revisit only if
  measurement shows first-load latency actually hurts, and then as its own ADR keyed on an Extract
  identity so rebuilds expire the rows by construction.
- **One multi-waypoint OSRM call per Day instead of one call per pair.** OSRM's `route` service
  accepts a whole coordinate chain and returns per-leg geometry, which would cut a two-week Trip from
  about a hundred calls to fourteen. Rejected because it is all-or-nothing: the per-pair snap decline
  is exactly what produces the honest solid/dashed distinction §3 depends on, and a single chained
  call cannot say which pair was unroutable. The architecture's granularity is the feature here, not
  the overhead.
- **Keep one Day-level line, upgraded only when every Path in the Day has geometry.** Rejected (see
  §1): renders a mostly-routed Day as entirely unrouted.
- **Follow `healKinds` and request `["rail", "bus", roadProfile]`.** Rejected (see §2): silently
  yields no geometry on Japanese Trips and bills Google on every map load.
- **Fetch only the active Day's geometry, lazily, on each Day change.** Rejected: every Day is
  already drawn at once under the existing opacity tiers, so most visible lines would stay straight
  most of the time — the feature would appear not to work except on the Day in view.
- **Re-request every pair whenever the derived Days change, with no client store.** Rejected (see
  §5): about a hundred lookups per drag, twice.
- **Add a distinct "geometry pending" style for rail and bus.** Rejected (see §4): encodes our ingest
  backlog in the traveler's map, for a state #142 deletes.

## Consequences

- A new API route gains the read-side responsibility of resolving a batch of pairs to Paths, with
  bounded concurrency rather than an unbounded fan-out. `fetchOsrmJson` currently passes no
  `AbortSignal`; at ADR-0026's N of one that was tolerable, and at this ADR's N it is worth a
  timeout, so a stopped container fails fast instead of hanging the request.
- `MapView.tsx`'s route-building `useMemo` splits: the pure "Day to ordered pair list" rule (start
  Anchor, check-in waypoint, stops, end Anchor) becomes a tested module, and the component keeps only
  the feature assembly.
- The `routes` layer gains a data-driven `line-dasharray`. This is supported in the pinned MapLibre
  (5.21.1, style-spec 24.7.0, where the property is `cross-faded-data-driven`); if the runtime
  disagrees with the spec, the equivalent is two filtered layers over the same source.
- No schema change and no migration.
- Self-heal (ADR-0026) and this ADR are now two request-time consumers of `describeJourney` with
  *different* kind lists, for good reasons in both cases. A third consumer should state its kind list
  deliberately rather than copy either one.
- Bill that comes due later: when #142 lands rail geometry, §2's Road-profile-only narrowing is what
  must be revisited to let `osm-japan` answer — and §3's presence-of-`geometry` test is already
  written to accommodate a rail Path that has a real Basis of cost but no shape.
