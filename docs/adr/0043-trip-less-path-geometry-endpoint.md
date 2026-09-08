# ADR-0043: A trip-less sibling of the path-geometry endpoint

- **Status:** Accepted
- **Date:** 2026-09-07
- **Supersedes:** —
- **Superseded by:** —
- **Constrained by:** ADR-0029 (path geometry is fetched at request time, trip-addressed),
  ADR-0040 (the Swift client's trips live entirely in local SwiftData), ADR-0042 (MapKit answers
  road pairs on-device; the server's job narrows to rail)

## Context

`POST /api/trips/[id]/path-geometry` (ADR-0029) is addressed by Trip id: it calls
`getTripWithDetails(tripId)` and hard-404s if that Trip is not a row in this server's database.
That was a safe assumption for the web app, whose only client is itself server-rendered against
the same database.

It stops being safe once a second kind of client exists whose trips are never rows there at all.
ADR-0040 put the Swift client's trip data entirely in local SwiftData, deliberately with no
server-side counterpart — Phase A's whole point (ADR-0038) is that only VROOM/OSRM/the rail graph
need to be reachable over the network, not that trip data does. ADR-0042 then gave the Swift client
a reason to call this endpoint's rail-answering half specifically, now that its road half is
answered on-device — but the endpoint has no way to serve a trip id that will never exist there.

Checked before deciding: the trip-scoped route's own handler body uses the fetched Trip for
exactly two fields — `trip.roadProfile` and `trip.journeyRoadKinds` — both of which a SwiftData-
backed client already holds locally, current as of its own last write. Nothing else about the
route is trip-specific; the actual resolution work (`resolvePathGeometryBatch`, factored out of the
existing route by this same change) takes those two values as plain parameters already.

## Decision

**Add `POST /api/path-geometry` — a sibling endpoint taking `roadProfile` and `journeyRoadKinds`
directly in the request body instead of looking them up by Trip id.** The trip-scoped route is
unchanged in behavior and stays exactly as addressed as it was; both routes now share one resolver
(`src/lib/resolvePathGeometryBatch.ts`) so they can never drift into answering a pair differently.

Request shape: `{ pairs: PairRequest[], roadProfile: "walking" | "driving", journeyRoadKinds?:
JourneyRoadKind[] }`. Response shape is identical to the trip-scoped route's:
`{ results: (Path[] | null)[], retry: number[] }`. Validation mirrors the trip-scoped route's own
(`pairs` shape/count, `MAX_PAIRS`), plus new checks that `roadProfile` is one of the two literal
values and `journeyRoadKinds` (when present) is well-formed.

Not authenticated any differently than the trip-scoped route — this endpoint reveals no Trip data
of its own; it only resolves whatever coordinates the caller supplies, exactly as the trip-scoped
route does for a Trip the caller can already read.

## Alternatives considered

- **Point the Swift client at a synthetic/dev trip id that does exist server-side.** Rejected:
  fine for proving the pipeline once, wrong for real use — that trip's stored `roadProfile`/
  `journeyRoadKinds` would silently diverge from whichever real local Trip is asking, the moment
  either one is edited.
- **Ship the Swift client entirely on `NoGeometryProvider`/`MapKitGeometryProvider`, with no server
  call at all for Phase A.** Considered seriously, since ADR-0042 already covers the large majority
  of a typical Japan trip's *non-rail* pairs. Rejected as a permanent answer, not a phased one:
  rail is this app's actual Japan differentiator (ADR-0019/ADR-0024), and a client that never asks
  the server for rail geometry has given up exactly the capability MapKit cannot replace. Nothing
  stops the client from continuing to run on-device-only during development; the endpoint's
  existence doesn't obligate immediate use.
- **Widen the trip-scoped route itself to accept an optional inline trip shape instead of adding a
  new path.** Rejected for clarity: overloading one route to mean two different addressing
  schemes (by id, or by inline value) is a worse interface than two routes with one shared
  resolver — REST-ish and typed-request-shape conventions elsewhere in this codebase (e.g.
  `/api/trips` vs `/api/trips/[id]`) already favor a distinct path per addressing scheme.

## Consequences

- **The web app is completely unaffected.** It keeps calling the trip-scoped route exactly as
  before; nothing about its behavior, caching, or request shape changes. `resolvePathGeometryBatch`
  is a pure refactor of logic that already existed, not a behavior change to it.
- **This closes the addressing gap ADR-0042 named but didn't solve.** The Swift client can now
  call the server for rail geometry from a Trip that has never been and will never be a row in this
  database.
- **Two routes now share one resolver.** A future change to registry dispatch, the `kinds` list, or
  the retry-index contract only needs to happen in `resolvePathGeometryBatch.ts` to reach both
  callers — this was true in spirit before (one route, one body) and stays true in fact now (two
  routes, one shared function).
- **No new infrastructure, no new provider, no schema change.** This is routing/validation code
  only; VROOM, OSRM, and the OSM-Japan rail graph are unaffected and unaware a second route exists.
