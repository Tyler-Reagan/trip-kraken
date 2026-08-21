# ADR-0032: A rail Journey decomposes into one Path per shift, transfers and access walks included

- **Status:** Accepted
- **Date:** 2026-08-20
- **Supersedes:** —
- **Superseded by:** —
- **Constrained by:** ADR-0021 (Path is the travel primitive, derived from the Plan, never stored),
  ADR-0022 (a Path ends at every shift; a seated through-run across Operators is still one Path,
  taking the boarding Operator; `PathEndpoint.locationId` is optional for ephemeral interchange
  endpoints; a Journey is "N Paths, access walks included"), ADR-0024 §6 (registry dispatch: whichever
  entry's kinds intersect first answers the whole Journey and returns `Path[]` itself — `osm-japan`
  does its own decomposition, the same as `osrmProvider` already does for a walk that crosses a
  ferry), ADR-0030 §7 (`RideStep` carries `fromStopId`/`toStopId`, `TransferStep` carries the station
  cluster id — the identities this decomposition reads), ADR-0030 §9 (`Path.geometry` is a list of
  spans), ADR-0030 §12 (names this ticket as decomposition's home, deliberately left out of that ADR)
- **Note:** Decided by resolving issue
  [#195](https://github.com/Tyler-Reagan/trip-kraken/issues/195)'s grilling questions, under map
  [#181](https://github.com/Tyler-Reagan/trip-kraken/issues/181).
  [#139](https://github.com/Tyler-Reagan/trip-kraken/issues/139) (sidebar transit detail) is the
  consumer waiting on this; [#140](https://github.com/Tyler-Reagan/trip-kraken/issues/140) (per-Path
  provider mixing) is what this unblocks next.

## Context

`osmTransitProvider.describeJourney` returns a single-element `Path[]` for a whole rail Journey,
every ridden line's name joined into one string — the module's own docblock calls this "an honest
but lossy placeholder." ADR-0022 says a Path ends at every **shift** (a change of kind, Operator, or
service — something the traveler *does*), so a journey across three lines with two transfers is one
Path today where the domain says five: an access walk, three rides, an interchange between each pair
of rides, an egress walk.

ADR-0030 §7 makes the split possible for the first time. `RideStep` now carries `fromStopId`/
`toStopId`; `TransferStep` carries the station cluster id crossed. Before that change, the provider
had no way to see where the shifts fell at all.

**The cost is not hypothetical.** A real Journey (Meiji Jingu → Park Hotel Tokyo, 30 min, two lines,
measured while eyeballing ADR-0030's rendered output) has a 571 m access walk to the boarding
station, a 200 m interchange transfer, and a 73 m egress walk — none of them visible today, because
all three are folded into the one Path's totals rather than reported as their own thing.

**A structural fact shapes what this decomposition can and cannot know.** Stop nodes are scoped per
OSM route relation (`stopNodeId = relationId:osmNodeId` in `transitGraphIngest.ts`), so ride edges
only ever connect stop nodes within one relation — crossing from one line to another always crosses
a transfer edge in `buildAdjacency`, unconditionally charged `TRANSFER_MINUTES`. The graph has no
tag or feature distinguishing a real interchange from a seated through-run that OSM happens to model
as two separate route relations. ADR-0022's "a seated through-run stays one Path" carve-out has no
signal to act on in this data.

## Decision

**`describeJourney` decomposes its search's `Step[]` into an ordered `Path[]`: one Path per
contiguous run of same-line `RideStep`s, one Path per `TransferStep`, and one Path for each nonzero
access/egress walk.** `costMatrix` is unaffected — it already calls the shared search with
`withSteps: false` (ADR-0030 §11) and never sees a Path.

### 1. Split at every `TransferStep`, unconditionally — the through-running blind spot is recorded, not solved

Every line boundary the search crosses becomes a Path boundary, with no attempt to detect a seated
through-run. Building that detection (an OSM `route_master` relation, a shared-name heuristic, or
similar) is unresearched on this graph and would block a working decomposition on an open-ended
side quest.

This introduces no new inconsistency. `TRANSFER_MINUTES` already charges every relation boundary as
a transfer today, before this ADR — decomposition only makes that existing charge visible as its own
Path instead of silently folding it into one Journey's total. The blind spot is recorded the way
[#201](https://github.com/Tyler-Reagan/trip-kraken/issues/201) → ADR-0031 recorded bus geometry: a
known, accepted residual, revisit-worthy only if it turns out to matter on a real Trip.

### 2. Access and egress walks become their own `kind: "walking"` Paths

ADR-0022 defines a Journey as "a chain of one or more Paths, access walks included" — not just the
interchanges. Today's access/egress walk time is folded into `routeJourney`'s totals via
`seed.walkMinutes`/`toSnap.walkMinutes` and never surfaces as a step at all. Splitting only
interchanges would leave the decomposition still short of that definition and would leave the
sidebar unable to say "walk to Shibuya, board the Yamanote" the same way it can now say "change at
Kyoto."

Each carries `basisOfCost: "straightLine"` (§4) and `answeredBy: "osm-japan"` — the provider computed
it, via its own walk-speed fallback rather than a real route. It renders dashed on the map, same as
any other `straightLine` Path, until [#140](https://github.com/Tyler-Reagan/trip-kraken/issues/140)
wires per-Path provider mixing so these can route through `osrm` instead.

### 3. A transfer becomes its own `kind: "walking"` Path; `PathEndpoint` gains `stationName`

`WalkingPath` today is bare (`PathBase & { kind: "walking" }`) — nothing carries a station name for
the sidebar's "change at Kyoto." Rather than add a field to `WalkingPath` alone,
**`PathEndpoint` gains an optional `stationName: string`**, populated on both ends of a transfer
Path and, for free, on the boarding/alighting ends of every rail Path too — the same fact ADR-0028 §6
and ADR-0030 §7 already named as what a traveler can act on, now reaching the Path a caller actually
holds.

Materializing the transfer as its own Path — rather than folding its cost onto an adjacent rail
Path — is what ADR-0022 already says: "transfers have migrated to the *gaps between* Paths, where
transfer cost can eventually be modeled properly." A gap between Paths **is** a Path once it has a
name and a cost; there is no third place for it to live.

### 4. A transfer Path's Basis of cost is `straightLine`

Its distance is always `0` — `shortestPath` never adds distance across a transfer edge, only
`TRANSFER_MINUTES` of time — because no real interchange-walk distance exists in this graph at all,
only a flat constant standing in for it. `straightLine`'s own definition, "no route computed,"
already covers exactly this without a fourth `BasisOfCost` value invented for one constant.

### 5. Each decomposed Path's `TravelCost` is recomputed from its own steps, not apportioned

A rail Path's distance/duration comes from summing its own `RideStep`s' edge distances against that
line's `LINE_TYPE_SPEEDS_KMH` entry — the same numbers `shortestPath`'s Dijkstra relaxation already
computes per hop, regrouped rather than re-derived. A transfer Path is `0` m / `TRANSFER_MINUTES`.
A walk Path is `haversineMeters(from, stop)` at `WALK_SPEED_KMH`. Summing every decomposed Path's
`TravelCost` back reproduces today's one-Path total by construction — an invariant worth asserting
in tests, not just a behavior to eyeball.

### 6. A zero-cost Path is omitted

An access or egress walk can be genuinely `0` m / `0` s (a Location entered at a station's own
coordinates); a transfer never is, since `TRANSFER_MINUTES` is charged unconditionally. A Path that
costs nothing and draws nothing is not information, so it is not emitted.

### 7. A whole-Journey walk (no ride at all) now reports `kind: "walking"`, not `UnknownPath`

When `from` and `to` snap into the same stop node, today's `steps` is empty and `describeJourney`
returns an untyped Path (`{ from, to, travelCost }`, `kind` absent) because "not honestly `kind:
'rail'` either." Once every walk leg is properly `kind: "walking"` (§2), this case has no more claim
to `UnknownPath` than any other walk-only Path — `UnknownPath` means no route was computed at all,
and a haversine-at-walk-speed estimate is a computed (if honest-about-being-approximate) route.

> ### Amended 2026-08-20 — the renderer did need one change, and the Consequences said it would not
>
> Implemented the same day. **No decision above changed**, and the measurements below replace this
> ADR's one unverified prediction rather than revise a decision.
>
> **"`MapView.tsx`: no code change expected" was wrong, and checking is what caught it.** The
> Consequences said to confirm the rendering visually rather than assume it held. Confirmed instead
> by replicating the renderer's feature assembly over the same real Journeys in both shapes — the
> pre-decomposition single Path and the decomposed chain — and diffing the output, which is exact
> where an eyeball is not.
>
> A spanless Path called `drawStraight` **unconditionally**, bypassing the renderer's own
> `GAP_MIN_METERS` (50 m). That threshold exists because "a dash drawn across [a router's snap]
> offset would claim a gap that isn't one." Before decomposition, a two-metre access walk and a
> same-platform transfer were *interior gaps* between spans, and the threshold suppressed them.
> Decomposition promoted them to Paths of their own, so they began drawing as dashed stubs — the
> precise thing the threshold was written to prevent, reached by a route its author had not
> anticipated. **The fix is one line: a Path with no shape *is* a gap, so it answers to the same
> minimum.** `drawGap` replaces `drawStraight` in that branch.
>
> **With that, the prediction holds as measured** on `db/transit-japan.db`, over three real
> Journeys (one single-line, one crossing two interchanges, one inter-city):
>
> - **Solid geometry is byte-identical** in all three — same spans, same coordinates, same order.
>   Decomposition redistributes spans across more Paths and changes none of them.
> - **Dashed features match feature-for-feature**, differing only by **≤ 0.67 m** of coordinate
>   precision, which is not an error introduced here: a station endpoint carries its own full
>   coordinates while a span's endpoint has been through 5dp storage, whose maximum positional error
>   ADR-0030 §5 measured at 0.740 m. The disagreement is that rounding and nothing else.
> - **One 50.2 m egress dash newly draws**, on the inter-city Journey alone, because the station's
>   own coordinate falls just the far side of `GAP_MIN_METERS` from where the last span ended. It is
>   a real unrouted walk drawn honestly; a threshold boundary being straddled is not a systematic
>   change.
>
> **The sum invariant (§5) holds exactly on real data**, not just in the fixture: distance agrees to
> 0, duration to 2.3e-13 seconds, against the same pair's `costMatrix` cell.
>
> **`journeyCost` was needed, and is a decision this ADR did not anticipate.** §5's invariant is
> only useful if something sums the chain, and one caller — self-heal's DELETE route (ADR-0026) —
> read `paths[0].travelCost` as the whole Journey's cost. Correct while a provider returned one Path
> per Journey; after decomposition it reports the access walk. `types/path.ts` gains `journeyCost`,
> and the aggregate's `basisOfCost` is **the most-routed Path's, not the weakest**. Two rules were
> tried and rejected against the provider's own fixture:
>
> - *Weakest link* stamps every rail Journey `straightLine`, since access walks and transfers are
>   `straightLine` by construction (§2/§4) — making the marker meaningless, the failure #139's
>   resolution explicitly warned against. It also misreads what those legs are: station-snapping
>   walks and the flat `TRANSFER_MINUTES` are components of the rail graph's own cost model
>   (ADR-0019), not a fallback away from it.
> - *Longest Path by duration* was written first and **the fixture failed it**: a flat five-minute
>   transfer out-durates two short urban hops, so a three-station ride reported as a straight-line
>   estimate. Recorded because it looks reasonable and is not.
>
> Most-routed reproduces what every one of these Journeys reported before decomposition.

## Alternatives considered

- **Detect through-running before splitting, so a seated cross-Operator run stays one Path as
  ADR-0022 intends.** Rejected (see §1): the graph carries no signal for it today, and building one
  is unscoped research that would block a working decomposition rather than sharpen it.
- **Defer access/egress decomposition to #140, splitting only interchanges here.** Rejected (see
  §2): ADR-0022 already defines a Journey as including access walks; a decomposition that omits them
  still wouldn't match that definition, and the sidebar loses "walk to Shibuya" detail for no reason
  tied to what #140 actually does (routing, not existence).
- **Fold a transfer's cost onto an adjacent rail Path instead of giving it its own Path.** Rejected
  (see §3): blends a walking cost into a `railNetwork`-basis Path's numbers, and contradicts ADR-0022's
  own "migrated to the gaps between Paths."
- **A new `BasisOfCost` value for a modeled constant with no real distance behind it.** Rejected (see
  §4): `straightLine` already means "no route computed," which is exactly this case, and a value that
  would only ever apply to one kind of Path is a vocabulary cost with no corresponding gain.
- **Add the station-name field to `WalkingPath` alone rather than `PathEndpoint`.** Rejected (see
  §3): a rail Path's own boarding/alighting stations are just as nameable, and `PathEndpoint` is
  already the place identity-adjacent optional fields live (`locationId`).
- **Keep the whole-walk Journey as `UnknownPath`.** Rejected (see §7): consistent typing was the
  point of §2; carving out one exception for the same shape of Path undoes it.

## Consequences

- **`osmTransitProvider.ts`**: `joinedLineNameOf` and `describeJourney`'s single-Path return are
  replaced by a decomposition pass over `SearchResult.steps`; `spansOf`'s per-step geometry assembly
  is regrouped per rail Path rather than concatenated across the whole Journey.
- **`types/path.ts`**: `PathEndpoint` gains an optional `stationName: string`.
- **Tests**: `transitGraphIngest.test.ts`'s existing multi-line fixtures aren't enough on their own —
  `osmTransitProvider.test.ts` needs a Journey crossing at least one real interchange, asserting Path
  count, the `kind` sequence, `stationName` on the transfer's endpoints, and that summed
  distance/duration across the decomposed `Path[]` equals today's single-Path totals.
- **`MapView.tsx`**: no code change expected. Rendering is already per-Path with per-span dashing
  (ADR-0029 §1/§3, ADR-0030 §9); decomposition redistributes the same spans across more Path objects
  sharing one Day's styling. Confirm this visually once built rather than assume it holds.
  *(Wrong — see the 2026-08-20 amendment: one line changed, and checking is what found it.)*
- **`costMatrix` is unaffected.** It already calls the shared search with `withSteps: false`
  (ADR-0030 §11) and the optimizer never sees a Path (ADR-0022).
- **Bills that come due later**, each its own ticket:
  - [#140](https://github.com/Tyler-Reagan/trip-kraken/issues/140): per-Path provider mixing, so the
    walk/transfer Paths this ADR creates can route through `osrm` instead of staying dashed.
  - [#139](https://github.com/Tyler-Reagan/trip-kraken/issues/139): the sidebar consumes the new
    `Path[]` shape and `PathEndpoint.stationName` for "change at Kyoto" detail.
  - The through-running blind spot (§1), revisit-worthy only if a real seated cross-Operator Trip
    shows it splitting a run that shouldn't split.
