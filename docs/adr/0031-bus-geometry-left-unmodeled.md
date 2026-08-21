# ADR-0031: Bus Path geometry is left unmodeled; the map's one remaining disagreement with the Plan is accepted

- **Status:** Accepted
- **Date:** 2026-08-20
- **Supersedes:** —
- **Superseded by:** —
- **Constrained by:** ADR-0018 (§1's 2026-08-08 amendment: a `TravelCost` or `PathGeometry` derived
  from Google must never be persisted, and the only Service Specific Terms §19.3 caching exception
  covers latitude/longitude, never a polyline), ADR-0029 (§2's rejection of the optimizer's full kind
  list on the map, on the same per-call-billing ground reasserted here; §6's request-time,
  never-persisted posture), ADR-0030 (§10's `["rail", trip.roadProfile]` map request, which already
  drops `google` on the kind intersection; the residual this ADR was named to resolve), ADR-0017 /
  ADR-0028 (degrade visibly; a `straightLine` Basis of cost is not a defect to hide)
- **Note:** Decided by resolving issue
  [#201](https://github.com/Tyler-Reagan/trip-kraken/issues/201), under map
  [#181](https://github.com/Tyler-Reagan/trip-kraken/issues/181).

## Context

`optimize.ts` requests `["rail", "bus", trip.roadProfile]`, so `google` (`kinds: ["bus"]`) can cost a
pair as a bus ride. The map requests `["rail", trip.roadProfile]` (ADR-0030 §10): `google` fails that
kind intersection and drops out, deliberately, so no per-call billing happens on a page load for data
ADR-0018 forbids persisting. A pair the optimizer costed as a bus ride is therefore drawn by whatever
`osrm` or `haversine` answers instead — the map's one remaining disagreement with the Plan, named and
deliberately left standing by ADR-0030 §10 and its Consequences.

`googleRoutesProvider.ts` does not request a polyline today; `computeRoutePolyline` exists only for
`describeJourney`'s own use and is not wired to the map's geometry lookup. Closing the disagreement is
not simply "ask for the polyline" — it raises the same ToS question ADR-0018 already settled for cost
data, applied to a different field of the same response.

Three shapes of answer were on the table:

1. Let the map call `google` for bus pairs on page load.
2. Call `google` but hold the polyline only in the client's `usePathGeometry` store — memory for one
   browser session, not disk or database.
3. Leave bus Paths dashed, as they already render today, and record that bus geometry is deliberately
   unmodeled rather than pending.

## Decision

**Bus Path geometry stays unmodeled. The map continues to request `["rail", trip.roadProfile]`
exactly as ADR-0030 §10 left it — no code changes. A bus-costed pair draws whatever `osrm` or
`haversine` answers, dashed wherever neither has a real shape, and that is the permanent, accepted
behavior rather than a backlog item.**

### Option 1 is rejected: calling Google at render time re-opens a question already answered twice

ADR-0029 §2 rejected the optimizer's full kind list on the map specifically because `google` would
"spend money per call on every map load, for data ADR-0018 forbids persisting." ADR-0030 §10 upheld
the same objection when rail geometry made the rest of the kind-list question live again. Nothing
about bus changes the shape of that argument — a page load is not a user action with intent behind
it, and a Trip's map is opened and re-rendered far more often than its optimize step runs. Reopening
this a third time would need a new fact, not a restatement; there isn't one.

### Option 2 is rejected: a session-only cache is still the caching the ToS names

ADR-0018's 2026-08-08 amendment reads the Google Maps Platform ToS directly: §3.2.3(a) forbids
Customer to "pre-fetch, index, store, reshare, or rehost Google Maps Content outside the services,"
and §3.2.3(b) forbids caching except as the Service Specific Terms permit. The only Routes API
exception (§19.3) covers latitude/longitude for up to 30 days — durations, distances, and polylines
are not covered. That amendment drew its safe line at **the request boundary**: one matrix fetched,
held in memory, and discarded within a single optimize run is not a pre-fetch, because "the run is
the request, and nothing leaves the service boundary."

A `usePathGeometry` entry does not sit at that boundary. ADR-0029 §5 built that store specifically so
a Trip's geometry survives across `reload()` — after every move, removal, and field edit — for as
long as the browser tab stays open. A bus polyline placed in it would be read back across many
requests it was never fetched for, which is a textbook pre-fetch-and-reuse, not "the run is the
request." "It's memory, not disk" answers where the bytes sit, not what §3.2.3 restricts, which is
reuse across requests regardless of medium. Relying on that distinction to hold up would be staking a
ToS reading on a technicality the amendment that governs this exact provider already rejected once,
for the adjacent field of the same API response.

### Option 3 costs nothing and is what the map already does

No code changes: bus Paths already draw with the same straight, dashed style as any other pair
`osrm` declines and `haversine` answers, per ADR-0029 §3's presence-of-`geometry` test. This is the
degrade-visibly posture ADR-0017 and ADR-0028 already established for the rest of the app — a Path
with no real shape says so on the map rather than being drawn as if it were routed — applied here to
a case where "no real shape" is now a permanent fact about bus, not a temporary ingest gap.

Bus is also a smaller share of a typical Japan itinerary than rail, which is what makes leaving this
disagreement standing the right size of compromise: it is real, it is documented, and it is bounded to
the one Path kind whose geometry provider was never going to be safe to call from the map in the first
place.

## Alternatives considered

- **Call `google` for bus pairs at map render time.** Rejected (see Option 1 above): the same
  per-call-billing objection ADR-0029 §2 and ADR-0030 §10 already raised, with no new fact to justify
  reopening it.
- **Cache the polyline in `usePathGeometry`, scoped to the browser session.** Rejected (see Option 2
  above): the store is built to answer repeated requests over a session's lifetime, which is exactly
  the reuse-across-requests ADR-0018's ToS reading forbids for any field but lat/lng — "session, not
  disk" does not change which requirement is at issue.
- **Fetch bus geometry once and persist it server-side, keyed by an Extract or cache-epoch identity**
  (the pattern ADR-0029 §6 left open for a future geometry cache). Not pursued: the object ADR-0018
  restricts is the polyline itself, not where a cache of it would live, so a differently-scoped cache
  does not change the ToS analysis — a bus polyline is not `answeredBy: "osrm"`, and no epoch key
  makes Google content otherwise-restricted content persistable.
- **A distinct map style marking bus Paths as "geometry not modeled," rather than plain dashed.**
  Not pursued: ADR-0029 §4 already rejected a third rendering state for a temporary ingest gap (rail,
  pre-#142); the same reasoning applies harder here, since this gap is not temporary. Dashed already
  means exactly "no real shape," which is the true statement about a bus Path.

## Consequences

- **No code change.** `MapView.tsx`, `usePathGeometry.ts`, and the map's `["rail", trip.roadProfile]`
  request (ADR-0030 §10) are already correct for this decision.
- **The map-versus-Plan disagreement on bus-costed pairs is a permanent, accepted, documented
  residual**, not an open item under #181. A pair the optimizer costs via `google` as a bus ride is
  drawn by whatever `osrm` or `haversine` answers on the map, and that is expected to stay true
  indefinitely rather than pending a future ticket.
- **`googleRoutesProvider.ts` gains no polyline request.** `computeRoutePolyline` stays scoped to
  `describeJourney`'s own request-time use (ADR-0018's 2026-08-12 amendment), and is not wired to the
  map's geometry lookup.
- **Revisiting this needs a new fact, not a retry.** The two rejected options were rejected on the
  same ToS and billing grounds this project has now applied three times (ADR-0029 §2, ADR-0030 §10,
  here). A future reversal would need something that actually changed — a different Google licensing
  terms, a paid/cached-tile product, or evidence that bus is a larger share of real itineraries than
  assumed here — not a fourth restatement of the same trade-off.
