# ADR-0036: The itinerary and map panel render one row per Path shift, not one row per Journey

- **Status:** Accepted
- **Date:** 2026-08-21
- **Supersedes:** — (the row-shape and map-scope parts of #139's own 2026-08-05 interim decision
  comment are superseded — see Context — but that comment is a GitHub comment, not an ADR, so there
  is no formal document to supersede)
- **Superseded by:** —
- **Constrained by:** ADR-0030 (real rail geometry — `Path.geometry` as a list of spans,
  `PathEndpoint.stationName`, the identities this ADR's rows read), ADR-0032 (a rail Journey
  decomposes into a real chain of Paths — access walk, per-line ride(s), transfer walk(s), egress
  walk — the shape a "row per Path" render depends on existing at all), ADR-0035 (`surfacedTransitOf`
  — the projection a transfer row's click opens)

## Context

[#139](https://github.com/Tyler-Reagan/trip-kraken/issues/139), under map
[#181](https://github.com/Tyler-Reagan/trip-kraken/issues/181), asks where and how OSM-Japan transit
detail (real line names, transfer counts, the estimated-timing caveat) surfaces in the itinerary UI.
An interim decision posted 2026-08-05 locked placement, content, and vocabulary — but it was written
before three ADRs that changed its own premises. It said *"no route geometry exists to draw"*
(ADR-0030 made that false); it framed a Path's payload as *"1–3 line names, transfer count"* on the
premise that a Journey is **one** Path with every ridden line's name joined into a string — the
lossy placeholder ADR-0032 replaced with a real decomposed chain; and it predates
`surfacedTransitOf`, built by ADR-0035 specifically for the transfer detail this ticket wants, with
no consumer at the time.

Resolved via `/grilling`, reconciling the interim decision against those three ADRs, then
`/prototype` (three loading/density variants, A/B/C, compared live against real trip data), then
further live refinement once C was picked. Two real bugs surfaced along the way, not anticipated by
either the interim decision or the reconciliation:

- **A day with only anchors and no scheduled stops got zero connectors at all.** Every connector in
  `DayCard.tsx`'s `<ol>` was gated on `day.stops.length > 0`, so an anchor-to-anchor gap (e.g.
  arrival → check-in, on a day nothing has been scheduled into yet) had no connector rendered
  anywhere — found live, on a real trip, even though a real Path exists between the two anchors.
- **`MapView.tsx`'s `StopPanel` never rendered the check-in waypoint row at all**, a gap from
  `DayCard`'s own row set that predates this ticket — the two Location lists disagreed about how
  many Locations a Day even has.

Both are fixed by this ADR's shared-entries design (§ Decision), not patched by hand a second time.

## Decision

**Every Location-to-Location gap in a Day renders one row per Path in that gap's chain — a plain
walk is a chain of length 1 (today's shape, unchanged), a rail Journey decomposes (ADR-0032) into
however many shifts it actually has, each its own row.**

1. **Uniform mechanism, not a rail special case.** "Render one row per Path in the chain between
   these two Locations" already produces the right output for both cases — a non-transit Leg's chain
   just happens to have length 1. A rail-only branch would be the special case, not the default.
2. **Rows are flat, never indented.** A long chain (more than two shifts) collapses behind a
   persistent, re-openable header row (a toggle, a summary of ridden lines, a shift count).
   Expanding reveals more rows at the same list level — a disclosure control, not a hierarchy. Short
   chains skip the toggle and show their row(s) directly.
3. **One shared row component (`PathShiftRows.tsx`)** serves both `DayCard`'s sidebar `<ol>` and
   `MapView`'s `StopPanel` — polymorphic between `<li>`/`<div>` (`as` prop) since the two hosts have
   different list semantics. One template, content driven by field availability (kind icon,
   line/station name, a `(straight-line)` marker when `basisOfCost === "straightLine"`, duration) —
   not branched per shift kind.
4. **Duration is now shown per shift**, reversing the interim decision's "no duration, ever" rule.
   That rule targeted a Journey-level total that was doubly dishonest — haversine-based *and* folded
   across shifts, hiding which part of the estimate was weak. ADR-0032 §5 gives each shift its own
   real, un-apportioned `TravelCost`; a per-shift number is honest enough to show, paired with its
   own Basis marker, and directly serves the job ADR-0019/the interim decision named: catching an
   implausible shift (a 3-minute "transfer," a suspiciously long ride) at a glance.
5. **The shared "what's in a Day's chain, and what connects to what" logic lives in
   `src/lib/pathPairs.ts`** (`dayChainEntries`/`dayChainPairs`), consumed by both `DayCard` and
   `StopPanel` — replacing what used to be two independently hand-enumerated conditional blocks.
   Built on the same ordering rule `chainOfDay` (the coordinate-only, routing-request-keying sibling)
   already encoded, so the two can't drift apart, and a day with only anchors produces its connector
   pairs by construction rather than by an enumeration that has to remember every case.
6. **Transfer rows are clickable — surface-specific, not one behavior.** `DayCard`'s sidebar opens
   the existing `InspectorPopover` via `surfacedTransitOf` (ADR-0035); `MapView`'s `StopPanel`
   instead flies the map camera there. A surfaced station has real coordinates but no `Location` row
   to resolve the existing `FocusTarget` `{tier: "stop", locationId}` variant by id, so `FocusTarget`
   gains `{tier: "point", lat, lng}` — a coordinate-only focus command.
7. **Hovering a `StopPanel` shift row highlights its own span on the map canvas.** `tripStore` gains
   `highlightedPathId`, keyed by `pathPairs.ts`'s `pathShiftId` (a gap's `pairKey` plus the shift's
   index in that pair's resolved chain) — the same identity `MapView`'s route-drawing loop tags onto
   every feature belonging to one Path. A dedicated `highlightLayer`, filtered on that id, draws the
   highlight — not a data-driven expression on the base `routeLayer`, whose width/collision behavior
   against Stadia's own basemap rail layer is already deliberately tuned (ADR-0034 §5) and shouldn't
   be touched for this. `DayCard`'s sidebar never wires this — there's no canvas there to highlight
   against.
8. **The "along the way" search trigger stays one per gap, not one per shift** — anchored on the same
   persistent header row as the collapse toggle (point 2), and now always visible rather than
   hover-revealed, so hiding it never leaves a gap in the row.
9. **Station and line names come from OSM's `name:en` tag**, not a hardcoded translation table.
   `transitGraphIngest.ts` gains a single `englishNameOf(tags, fallback)` helper, preferring
   `tags["name:en"]` over the local-script `tags.name` — used by `lineNameOf` (route relations),
   `stationNameOf` (stop nodes), *and* `buildClusters`' `stop_area`/`stop_area_group` naming
   (transfer-cluster names — "change at X" text). The first re-ingest run against this fix caught
   the last of these directly: line and per-line stop names came back in English, but cluster names
   ("change at 東京") did not — `buildClusters` read `relation.tags.name` straight, a second,
   independent place the old preference had to be (and wasn't) applied. One shared helper closes
   that gap by construction rather than by finding a fourth call site later.

## Alternatives considered

- **Keep one aggregate row per Journey, joined line names.** The interim decision's own framing —
  obsoleted once ADR-0032 made a Journey a real decomposed chain rather than a lossy joined string.
  An aggregate row can no longer honestly represent what a Journey now structurally is.
- **A/B loading-state variants** (skeleton-batch placeholder for the whole gap; pop-in with no
  placeholder at all) — built during `/prototype` to compare against C's collapsed-header approach,
  not shipped. C won because it's the one shape that also solves the density question (a long chain
  collapsing behind a summary) rather than only the settle-behavior question.
- **A precomputed `DerivedDay.chainEntries` field**, computed inside `deriveTripPlanDays`. Rejected
  for the same reason ADR-0035 §4 rejected threading `Path[]` into `deriveTripPlanDays` for
  `surfacedTransitOf`: it would ripple into every one of that function's call sites for data only
  two consumers need, and a standalone `pathPairs.ts` function leaves that decision local to the
  surfaces that actually want it.
- **A data-driven expression on the existing `routeLayer` for hover-highlight**, instead of a
  separate `highlightLayer`. Rejected — `routeLayer`'s width was tuned against a real measured
  collision with Stadia's own `railway` layer (ADR-0034 §5); adding highlight logic to that same
  paint expression risks that tuning silently drifting the next time either changes.
- **Per-Path provider mixing** (routing access/transfer/egress walks through `osrm` instead of
  haversine) — explicitly not pulled into this ticket, exactly as #181 already frames it. Shift rows
  show `(straight-line)` for now; that's the honest current state of the map, not a defect this
  ticket owns.

## Consequences

- **`usePathGeometry` is hoisted** from `MapView`-only scope to `TripClient.tsx`, shared via a new
  `PathGeometryProvider`/`usePathGeometryContext` — both `DayCard` and `MapView` read one cache
  instead of each fetching independently, which would have risked the two surfaces disagreeing about
  the same pair's staleness.
- **`surfacedTransit.ts` gains two exports** (`surfacedTransitIdOf`, `isTransferWalk`) that were
  previously private — their doc comments describing them as internal are now stale (mechanical fix,
  not a design change).
- **The anchor-to-anchor connector bug fix is general, not an instance patch.** `dayChainPairs`
  produces the right pairs for any combination of anchors/stops by construction; the specific case
  found (arrival → check-in, no stops) is one of many the same function now gets right.
- **`FocusTarget`'s new `"point"` tier is part of the map's public focus vocabulary** — any future
  focus-command consumer needs to handle it (`MapView.tsx`'s `applyFocus`/`boundsFor` already do).
- **`name:en` requires each developer's local `db/transit-japan.db` to be rebuilt** (gitignored, not
  shared) via `npm run ingest:transit-graph` before station/line names read in English locally —
  the fix is real and permanent, but dormant until that re-ingest runs.
- **Hover-highlight only exists in `StopPanel`.** `DayCard`'s sidebar rows carry no `onHoverChange`
  wiring — a deliberate asymmetry (§7), not an oversight, since the sidebar has no canvas to
  highlight against.
