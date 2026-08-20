# ADR-0030: Rail geometry is traced at ingest, stored per ride edge, and a Path carries the real spans it has

- **Status:** Accepted
- **Date:** 2026-08-19
- **Supersedes:** —
- **Superseded by:** —
- **Amends:** ADR-0029 (§2's Road-profile-only narrowing is lifted, as that ADR predicted; §3's
  solid/dashed test is restated over a Path that may carry several spans), ADR-0019 (its
  "no stored geometry" scope note is paid, and its `way`-tracing exclusion is reversed for rendering
  while left standing for duration)
- **Constrained by:** ADR-0021 (Path is the travel primitive, derived from the Plan, never stored),
  ADR-0022 (a Path ends at every shift), ADR-0024 (§4's registry order, §6's narration dispatch),
  ADR-0028 (§6's authored-versus-surfaced Transit distinction, and the blocker it records),
  ADR-0017 / ADR-0028 (degrade visibly; a `straightLine` Basis of cost is not a defect to hide)
- **Note:** Decided by resolving issue
  [#142](https://github.com/Tyler-Reagan/trip-kraken/issues/142)'s grilling, under map
  [#181](https://github.com/Tyler-Reagan/trip-kraken/issues/181). Two research passes preceded it and
  are recorded in
  [`docs/research/rail-geometry-ingest-142.md`](../research/rail-geometry-ingest-142.md); every
  figure below is measured on the pinned `260101` all-Japan Extract the pipeline actually downloads.
  The ticket's own framing was inverted by the first pass — see Context.

## Context

`RideEdge` carries `{ fromStopId, toStopId, distanceMeters }`, where the distance is the haversine
between two station coordinates. There is no shape between them, so `MapView.tsx` draws every rail
Path as a straight line. ADR-0029 shipped real geometry for walking and driving and left rail
explicitly unfinished, naming this ticket as the thing that would revisit its §2.

**The ticket asked whether the ingest pipeline needed to change to retain `way` geometry. It does
not — the geometry is already there, and has been all along.** `osmium tags-filter` completes
references transitively two levels down by default (relation → member ways → those ways' nodes);
the filtered national extract holds 630,298 nodes, of which 527,576 are untagged geometry vertices,
90,632 ways, and **zero dangling references of any kind**. `parsers/osmXml.ts` already parses every
one of those nodes into `OsmNode[]` and hands them to `buildTransitGraph`; it is `<way>` parsing
alone that is missing. **About 91% of the 212 MB of XML the ingest reads on every run is geometry it
throws away.** `scripts/ingest-transit-graph.sh` needs no change.

Four further facts shape the decision, none of them visible from the domain model:

- **Assembly is ours to write, and the data fights back.** No osmium subcommand assembles a route
  relation into an ordered line. A deliberately naive assembler gets 95.6% of the shipped graph's
  20,281 ride edges a shape — a count that matches ADR-0019's J5 figure exactly, so the percentage
  describes the real artefact — but only 82.2% cleanly. Twelve relations assemble into closed loops,
  including 山手線, 大阪環状線 and 名古屋市営名城線, where index-based cutting traces the long way
  round: 33.71 km of track for a 0.77 km hop.
- **The map and the Plan already disagree.** `optimize.ts` requests
  `["rail", "bus", trip.roadProfile]`, and both matrix composition and narration dispatch are "first
  capable entry wins, declines fall through". `osm-japan` declines only on the identity cell or when
  no station is within snap range, so in urban Japan it answers most pairs — the optimizer costs them
  as rail rides. ADR-0029's map route asks for `[trip.roadProfile]` alone and so draws those same
  pairs as solid OSRM walking lines. That was the right call when rail had no shapes to return; it is
  not a permanent state.
- **The search discards the identity it computes.** `RideStep` is `{ kind: "ride"; lineName }` and
  `TransferStep` is `{ kind: "transfer" }`. ADR-0028 §6 names this exact discard as what blocks
  Surfaced Transit, and its Consequences park that work "blocked on `osmTransitProvider` recording
  the station identity it currently discards."
- **A rail Journey is one Path today.** `describeJourney` returns a single-element `Path[]` with every
  ridden line's name joined into one string — which the module's own doc calls "an honest but lossy
  placeholder," since ADR-0022 says a Path ends at every shift.

## Decision

**Rail `way` geometry is traced at ingest, stored as one binary shape per ride edge, and reaches the
map as the real spans a Path actually has — with anything we cannot honestly draw left absent rather
than approximated.**

### 1. A segment built across a known discontinuity gets no geometry

The assembler knows, at the moment it happens, when it concatenated two way pieces whose endpoints
did not match. That known discontinuity is the gate — **not** a jump-distance threshold, which has
false positives on genuinely sparse straight track (a Shinkansen viaduct looks like a gap).

A segment built across a discontinuity stores no shape. ADR-0029 §3 then draws it dashed, with no
change to the renderer and no third "low confidence" style invented. This keeps the predicate the map
already tests — presence of geometry — meaning *we trust this shape*, and it is the
degrade-visibly posture ADR-0017 and ADR-0028 already established.

### 2. Closed-loop relations get a wraparound cut

Twelve relations assemble into a closed chain. The hop that closes the loop is
`chain[lastStopIndex..end]` joined to `chain[0..firstStopIndex]` — an exact cut, not a heuristic.

This is special-cased deliberately rather than left to §1's gate. Refusing these would put the app's
most conspicuous dashed line on the Yamanote, the Osaka Loop, and a Nagoya subway loop: three of the
lines a Japan itinerary is most likely to actually ride.

### 3. A station node that is not on the track is snapped, within the existing radius

741 stop members (3.4%) are not a vertex of any member way — 418 of them the old-style
`railway=station` node, which genuinely sits beside the tracks. These are cut at the nearest point on
the assembled chain, but **only when that point is within `STATION_SNAP_RADIUS_METERS`**; otherwise
§1's gate applies and the segment draws dashed.

Reusing the existing constant is the point: it is already this codebase's answer to "is this station
reachable from here," and a second, separately-tuned notion of nearness would be a second thing to
get wrong. The bound also stops a loop line from snapping to the wrong lap. A station keeps its own
coordinates — the snap locates the cut, never the station.

### 4. `distanceMeters` stays haversine; geometry is render-only here

Traced track length is stored because it is free once the shape exists, but **nothing consumes it for
cost in this ADR**. Rail durations are unchanged.

Recomputing is a sized change, not an unknown one: measured over 15,925 clean national ride edges the
traced-to-straight ratio is **1.077**, so swapping it in raises every rail duration ~7.7% unless the
speed table absorbs it. It is deliberately not done here for two reasons. A rendering change must not
move every rail duration — nobody debugging a wrong travel time would look in the map's ingest. And
the retune is gated on a defect ADR-0019 already recorded (§7 below).

The published circuity literature is **not** the right input to that future retune and is recorded
here so it is not reached for: figures of 1.16–1.37 measure *origin–destination network* circuity,
which bundles routing indirectness and transfers, whereas `RideEdge.distanceMeters` holds an
adjacent-station chord. The graph already models network indirectness by summing hops. Taking the
literature at face value would overstate the effect four- to fivefold.

### 5. Geometry is a varint-encoded BLOB column on `RideEdge`, at 5 decimal places, with no deduplication

Twelve representations were built as real SQLite files and measured on disk against a 8,998,912 B
control:

| Representation | On disk |
| --- | --- |
| shared table, corridor-dedup (lossy), varint-5dp | 11.19 MB |
| shared table, lossless dedup, varint-5dp | 12.08 MB |
| **`RideEdge.geometry` BLOB, varint-5dp** | **12.78 MB** |
| RouteChain + offsets, varint-5dp | 12.96 MB |
| GeoJSON-6dp TEXT (the naive shape) | 47.03 MB |

**Encoding is the lever; deduplication is not.** Binary beats text 3.7×. 5 decimal places costs a
maximum positional error of 0.740 m, which is immaterial for rail at any zoom — and MapLibre's
GeoJSON `tolerance` default (0.375) simplifies per zoom level regardless of what we store.

Deduplication is rejected despite 59.5% of shapes being geometrically redundant. It saves 0.7 MB and
costs a shared table, a direction flag on every lookup, and a real correctness hazard: within
id-matched groups the p99 disagreement is 1,287 m and the maximum is **395 km**, because loop
relations traced opposite ways round. Any id-keyed dedup silently picks one of the two. 3.8 MB of
growth on a regenerable reference file is the better trade.

Three further options are rejected on measurement, recorded so they are not re-proposed: a separate
geometry table costs a flat ~1.75 MB more regardless of encoding (composite text keys and their
index, not the shapes); per-row compression saves 2.6% and *inverts* under gzip, because it destroys
cross-row redundancy; and chain-plus-offsets is a net on-disk loss that relocates the duplication
rather than removing it.

### 6. The graph file records which Extract built it

A one-row `Meta` table carries the OSM snapshot date, the region, and the ingest timestamp.

`transitGraphStore.ts`'s schema records no provenance of any kind today. This file *is* regenerated
wholesale with the Extract, so the identity is implicit in the artefact and #181's "a geometry cache
needs an Extract identity in its key" is not strictly breached. It is added anyway, while the schema
is open: it makes the file self-describing for anyone debugging a wrong-looking line, and adding it
later means a second schema change for something already known to be wanted.

### 7. The search records the station identity it crosses, deliberately

`RideStep` gains the from- and to- stop node ids. `TransferStep` gains the station cluster id.

The ride-step widening is not optional and not incidental: a ride edge **is** a pair of stop node
ids, so the key a geometry lookup needs is the station identity. There is no version of this change
that records one without the other. **This pays ADR-0028's parked bill**, and it is stated here so a
later reader does not mistake it for luck.

The transfer widening goes one field beyond what geometry needs, because "change at Kyoto" is the
fact a traveller actually wants and ADR-0028 §6 named the transfer station as the thing they cannot
act on. `Step` is opened once rather than twice.

**Surfaced Transit is not built here.** ADR-0028's Consequences say it needs its own issue and
probably its own ADR — a derived-from-Plan entity entering the read model as a Location is a new
idea, and nothing in this ADR decides it. What changes is only that the block is gone, which is
recorded rather than left to be rediscovered.

### 8. Direction is resolved at read time, never stored twice

The stored shape runs from its edge's `fromStopId` to its `toStopId`. `buildAdjacency` inserts every
ride edge in both directions, so the search can cross any edge backwards; the provider compares the
recorded step ids against the stored pair and reverses the point list when they disagree.

No reversed copy is stored. §7's ids make this free — the information needed to decide is already
being recorded for the lookup.

### 9. A Path carries the real spans it has: `geometry` becomes a list of lines

`PathBase.geometry` widens from one GeoJSON `LineString` to a list of them. A Path's geometry is the
spans that have real shapes; the ride edges refused under §1 or §3 contribute nothing, leaving gaps.
The renderer draws each span solid over the Path's dashed straight chord.

**This is required, not a refinement.** Between edges that trace to nothing (4.4%) and edges refused
under §1, roughly 5–8% of ride edges have no shape — and a long rail journey crosses about twelve of
them, so **around half of long journeys contain at least one**. Under an all-or-nothing test those
journeys would draw entirely dashed, discarding eleven real answers to represent one missing one.

That is precisely the argument ADR-0029 §1 used to reject one line per Day, applied one level down;
deciding it the other way here would contradict that ADR's own reasoning. Bridging the gaps with
straight chords instead was rejected as the dishonest option — it draws an invented line and reports
it as routed, which §1 exists to prevent.

ADR-0029 §3's test is restated accordingly: a Path draws solid where it has a real span and dashed
where it does not, rather than solid-or-dashed as a whole.

### 10. The map requests `["rail", trip.roadProfile]`

ADR-0029 §2's narrowing to the Road profile alone is lifted. This is the revisit that ADR named as
"the bill that comes due later," and the condition it was waiting on — rail Paths having geometry —
is what this ADR delivers.

`google` declares `kinds: ["bus"]`, fails the intersection, and drops out, so no Google call is made
and ADR-0018's persistence rule is untouched. `osm-japan` answers where it has stations and declines
otherwise; `osrm` answers or declines on snap distance; `haversine` fills the rest. That reproduces
the optimizer's own composition for every pair except bus-answered ones.

**The residual is recorded rather than hidden:** a pair the optimizer costed via Google as a bus ride
is drawn by whatever `osrm` or `haversine` answers. The map still disagrees with the Plan there. That
is a smaller and better-understood disagreement than today's, where the map contradicts the Plan on
most urban Japanese pairs.

### 11. The matrix stops paying for detail it discards

`routeJourney` backs both `costMatrix` and `describeJourney`, and builds a step list either way —
which `costMatrix` then throws away, keeping only the cost, across N² calls. §7 makes each step
heavier, so the waste grows.

A flag on `routeJourney` skips step accumulation for matrix callers. The map's path is unaffected.

### 12. Path decomposition at transfers is not in scope

A rail Journey stays one Path here, with its line names joined, exactly as today. ADR-0022 says a
Path ends at every shift, so this is a standing divergence — but it is a domain-model fix, not a
geometry one, and §7's identities are what finally make it possible. It goes to its own ticket
alongside [#139](https://github.com/Tyler-Reagan/trip-kraken/issues/139), which needs the same
decomposition to show transfer detail in the sidebar.

§9 is what makes deferring this affordable: because a Path carries several spans, a multi-line
journey still draws its real track correctly while remaining one Path.

## Alternatives considered

- **Change the osmium filter step to retain `way` members.** Unnecessary — reference completion is
  already transitive two levels down, verified with zero dangling references on the national Extract.
  Had this not been checked, the obvious reading of ADR-0019's exclusion would have produced a
  pipeline change that did nothing.
- **`osmium export` to GeoJSON.** Rejected by the tool's own docs and confirmed by measurement: it
  emits per-way linestrings with *zero* relation membership (0 of 2,886 features carried a relation
  id), losing which line a track belongs to — the one thing a per-ride-edge geometry needs.
- **`osmium add-locations-to-ways`.** Works, but adds a second osmium invocation, its own index-type
  and memory decision, and a non-standard file extension the rest of the toolchain does not
  understand — for a resolution step that is a `Map.get` against nodes already parsed. It also
  silently deletes untagged nodes without `-n`, which was demonstrated to drop two node members of
  rail relations on a small file.
- **A jump-distance threshold as §1's gate.** Rejected: it cannot distinguish an assembly gap from
  genuinely sparse straight track, and the assembler already knows the answer exactly.
- **Refusing the closing hop of loop lines under §1.** Rejected (see §2): correct is available
  arithmetically, and the affected lines are the most-ridden in the country.
- **Deduplicating shared corridor geometry.** Rejected (see §5): 0.7 MB saved against a 395 km
  worst-case silent disagreement between the twins it would collapse.
- **A separate geometry table, per-row compression, or chain-plus-offsets.** All measured, all worse
  (see §5).
- **Recomputing `distanceMeters` from traced length in this change.** Rejected (see §4): it moves
  every rail duration ~7.7% on a rendering ticket, and is gated on a classifier defect that has not
  been fixed.
- **All-or-nothing Path geometry.** Rejected (see §9): about half of long rail journeys would draw
  entirely dashed.
- **Bridging refused ride edges with straight chords inside a Path's geometry.** Rejected (see §9):
  it draws an invented line and reports it as routed.
- **Keeping the map on `[trip.roadProfile]`.** Rejected (see §10): rail would never draw, which is
  the whole point of the ticket, and the existing map-versus-Plan disagreement would stand.
- **Requesting the optimizer's full `["rail", "bus", roadProfile]` on the map.** Rejected: `google`
  would match on `bus` and bill per call on every map load, for data ADR-0018 forbids persisting —
  the same objection ADR-0029 §2 raised.
- **Building Surfaced Transit here.** Rejected (see §7): ADR-0028 reserves it for its own decision.
- **Decomposing a rail Journey into per-shift Paths here.** Rejected (see §12): a domain fix riding
  in on a geometry change, and #139 is its natural home.

## Consequences

- **Persistence.** `RideEdge` gains a nullable geometry BLOB and a traced-length column; a `Meta`
  table is added. `db/transit-japan.db` grows from ~9.0 MB to ~12.8 MB. This is regenerable
  reference data outside the app's Drizzle schema, so there is no migration — the file is rebuilt by
  `scripts/ingest-transit-graph.sh`, which itself is unchanged.
- **`parsers/osmXml.ts` learns `<way>`.** Its docblock, which currently explains that way parsing
  "would be speculative," is now wrong and must be rewritten. `transitGraphIngest.ts`'s header
  exclusion likewise stands for *duration* and no longer for *rendering*; both notes should say so
  rather than be quietly deleted.
- **The transform's tested seam widens.** `buildTransitGraph` takes ways alongside nodes and
  relations. Assembly, loop handling, snapping, and cutting are pure and belong behind that seam,
  where ADR-0019's ticket #87 drew the unit-test line.
- **`PathBase.geometry` changes type for every provider, not just rail.** `osrmProvider` returns a
  one-element list, and `MapView.tsx`'s feature assembly emits one feature per span. This is the
  widest blast radius in the ADR and the only part that touches already-shipped ADR-0029 code.
- **ADR-0029 is amended in two places** — §2's kind list and §3's solid/dashed test — rather than
  superseded. Its per-Path decision, its request-time posture, and its refusal to persist OSRM
  geometry all stand.
- **Ingest cost is unmeasured.** `scripts/ingest-transit-graph.ts` reads the whole 212 MB XML into
  one string and parses it with `fast-xml-parser` today; `<way>` parsing adds 90,632 retained objects
  with 605,089 node references between them. This already works, so it is not a new risk, but the run's
  memory profile was explicitly not measured and should be watched on the first real ingest.
- **Bills that come due later**, each its own ticket under #181:
  - The `lineTypeOf` classifier defect — **zero** of 1,419 lines are classified `shinkansen` or
    `limitedExpress`, so every Shinkansen runs at the 45 km/h `commuter` speed. Recorded in ADR-0019
    and never ticketed, which is why it is still open.
  - Recomputing `distanceMeters` from traced length and retuning `LINE_TYPE_SPEEDS_KMH`, blocked by
    the classifier fix. ADR-0019's own eval found Tokyo→Ikebukuro estimated *too fast*, so the ~7.7%
    increase moves in the correct direction.
  - Surfaced Transit (ADR-0028 §6), now unblocked by §7.
  - Path decomposition at shifts (ADR-0022), needed by #139.
- **Bus geometry remains uncaptured**, unchanged by this ADR and still out of #181's scope. §10 makes
  it the *only* remaining source of map-versus-Plan disagreement, which sharpens the case for its own
  ticket if it turns out to matter in practice.
