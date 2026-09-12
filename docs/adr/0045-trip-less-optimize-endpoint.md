# ADR-0045: A trip-less sibling of the optimize endpoint

- **Status:** Accepted
- **Date:** 2026-09-07
- **Supersedes:** —
- **Superseded by:** —
- **Constrained by:** ADR-0043 (the identical trip-less-sibling pattern, applied here to a second
  endpoint), ADR-0040 (the Swift client's Trips live entirely in local SwiftData), ADR-0038
  (VROOM stays server-side for Phase A — this is the decision that makes the Swift client's *caller*
  of VROOM concrete), ADR-0023 (VROOM as the Decision layer), ADR-0015 §5 (`setPlacements`'
  replace-not-diff semantics, mirrored by `applyOptimizedPlacements`)
- **Note:** Reconstructed from the implementing commit (`bdc6145`, "Wire VROOM optimize into the Swift
  client (priority #5, ADR-0045)") and the code and route (`src/app/api/optimize/route.ts`, itself
  already carrying most of this reasoning in its own header comment) it introduced — the ADR file was
  never written at the time. Dated to that commit.

## Context

`POST /api/trips/[id]/optimize` is addressed by Trip id: it reads the Trip from Turso, calls `solve()`,
and persists the result via `setPlacements`. That's a safe assumption for the web app, whose Trips are
rows in that same database.

It stops being safe for the Swift client, whose Trips (ADR-0040) are never rows there at all — exactly
the gap ADR-0043 already named and closed for path-geometry. Optimize needs the same fix, with one
real difference from that precedent: `solve()` (`src/lib/solver.ts`) was *already* a pure function with
no Turso involvement of its own — the trip-scoped route's only database traffic is reading the Trip in
and writing placements back out, both of which happen *around* `solve()`, not inside it. A trip-less
sibling for optimize is therefore not a refactor-then-share exercise (there's no `resolvePathGeometryBatch`-
shaped extraction to do); it's a thin route that calls the same already-pure function directly.

## Decision

**Add `POST /api/optimize` — compute-only in both directions, never touching Turso.** It takes an
`OptimizeProblem` in the body, calls `solve()`, and returns the resulting `Itinerary`. The existing
trip-scoped route is completely untouched: it still reads the Trip, calls `solve()`, and calls
`setPlacements` itself. Validation on the new route is deliberately lighter than `/api/path-geometry`'s:
check only what `solve()` needs to avoid failing confusingly (`locations` is an array, `numDays` is a
positive number), and let anything deeper surface as a caught 500 — matching `optimizeTrip`'s own
established philosophy that a selected provider's error propagates by design, rather than path-geometry's
exhaustive per-field validation.

**The Swift client now owns both halves of the work the server used to own around the `solve()` call:**

- `optimizationProblem(for:)` (`TripKrakenKit/Optimize.swift`) is a pure port of `optimize.ts`'s
  `toInput`/stays-from-lodging-dates/edge-resolution/`kinds`-selection logic — domain logic, not a
  networking concern, so it lives beside `pairsOfDay`/`dayChainPairs` rather than inside the HTTP
  provider that eventually calls the endpoint with the value it produces.
- `TripStore.applyOptimizedPlacements(_:)` persists the returned `Itinerary` wholesale into SwiftData —
  replace, not diff (mirrors `setPlacements`' own ADR-0015 §5 semantics exactly: delete every existing
  Placement, insert fresh ones from `itinerary.days`), and caches `unplaced`/`warnings` onto
  `TripStore.lastUnplaced`/`lastOptimizeWarnings` rather than discarding them, mirroring the web app's
  own Zustand `unplaced` state.
- `HTTPOptimizeProvider` calls the new endpoint. It is thinner than `HTTPPathGeometryProvider`:
  `OptimizeProblem`/`Itinerary` are already `Codable` directly in `TripKrakenKit` (no DTO layer, unlike
  `Path`/`Location`'s discriminated-union decoding — see `Optimize.swift`'s own header), and a Trip's
  optimize request is one call, not a per-pair batch, so there's no chunking to do either.

**Wired as a single "Optimize" toolbar button** that re-plans every day's order wholesale; unplaced
locations and warnings surface via a completion alert rather than a dedicated "Unassigned tray" UI (the
web app's own issue #120) — deliberately deferred, not an oversight, since `lastUnplaced` is already
cached for a real tray to read later without another round-trip.

**Verified against the live pipeline, not only unit tests**, before wiring the Swift side to it: the
endpoint's validation, error propagation, and a full successful optimize round-trip were exercised
directly via `curl` against the actual running VROOM/OSRM services first.

## Alternatives considered

- **Point the Swift client at a synthetic/dev trip id that exists server-side**, mirroring the
  alternative ADR-0043 already rejected for path-geometry. Rejected for the identical reason: a real
  local Trip's inputs would silently diverge from whatever synthetic Trip's stored data the moment
  either one changed.
- **Extract a shared resolver function the way `resolvePathGeometryBatch` was extracted for path-
  geometry.** Rejected as unnecessary: `solve()` was already the shared, pure, side-effect-free core;
  there was nothing route-specific to factor out of it in the first place. The trip-scoped route's own
  Turso read/write stays entirely its own concern.
- **Have the new route also accept a trip id as an alternative to an inline problem, widening the
  existing route instead of adding a new path.** Rejected for the same clarity reason ADR-0043 gave:
  two distinct addressing schemes belong in two routes sharing logic, not one route branching on which
  kind of input arrived.
- **Build a dedicated "Unassigned tray" UI for unplaced locations in this same change.** Rejected as
  out of scope for this first cut — the web app's own #120 is the natural home for that, and
  `lastUnplaced` is cached specifically so it doesn't need to be re-fetched when that UI does get built.

## Consequences

- **The web app is completely unaffected** — same as ADR-0043's own consequence, for the same
  reason: the trip-scoped route's behavior, caching, and request shape are untouched.
- **The Swift client can re-plan a Trip that has never been and will never be a row in the server's
  database**, closing the same category of addressing gap ADR-0043 closed for geometry, now for the
  Decision layer (ADR-0023) too.
- **No new infrastructure, no new provider, no schema change** — VROOM and OSRM are unaffected and
  unaware a second caller exists, exactly as ADR-0043 found for its own endpoint.
- **Unplaced-location UX is intentionally thinner on the Swift client for now**: a completion alert,
  not a persistent tray. `lastUnplaced`/`lastOptimizeWarnings` are already in place for that later
  build-out, so this is a deferred UI decision, not a data-modeling one.
- **A future change to `solve()`'s request/response shape, or to how placements get persisted, now has
  two independent call sites to keep honest** — the trip-scoped route's Turso-backed persistence and
  `TripStore.applyOptimizedPlacements`'s SwiftData-backed one — since, unlike path-geometry's shared
  `resolvePathGeometryBatch`, there is no single resolver function both sides call through.
