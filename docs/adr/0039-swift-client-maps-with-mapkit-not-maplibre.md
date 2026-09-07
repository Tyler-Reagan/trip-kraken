# ADR-0039: The Swift client maps with MapKit, not MapLibre Native

- **Status:** Accepted
- **Date:** 2026-09-07
- **Supersedes:** —
- **Superseded by:** —
- **Constrained by:** ADR-0038 (names this as one of three deliberately deferred sub-decisions),
  ADR-0023 (VROOM is the Decision layer — unaffected by this ADR)

## Context

ADR-0038 named MapKit vs. staying on MapLibre as an open sub-decision rather than pre-deciding it,
because the web app's `MapView.tsx` does real custom work against MapLibre specifically: data-driven
route styling (color/opacity by day and active/metro/rest tier, dashed gaps for unrouted spans), a
hover-highlight layer keyed to a specific Path shift (ADR-0036), and a station-label layer (ADR-0034
§4) that reaches directly into Stadia's own loaded vector tile source (`openmaptiles`/`poi`, filtered
to `class: railway`) to render labels the basemap's own style doesn't draw. None of that is a given
on a different rendering stack.

"Stay on MapLibre" in a Swift app means MapLibre Native (its Swift SDK), not the web stack. Since
it's the same style-spec engine, most of the above would transfer close to as-is — Stadia's style
JSON, the data-driven paint expressions, the station-label trick — at the cost of a third-party
rendering dependency shipped inside the app, with camera/click/hover hand-wired against an imperative
Swift API with no SwiftUI-native bindings (no equivalent to `react-map-gl`).

Two questions were checked against MapKit's actual current API surface before deciding, rather than
assumed from training-data memory:

- **Native transit POI display.** `MapStyle.standard(pointsOfInterest: .including([.publicTransport]))`
  is a real, current SwiftUI MapKit API — confirmed via Apple's `MKPointOfInterestCategory` enum,
  which lists a `PublicTransport` case (value 30) current as of iOS 26.x. This shows Apple's own
  transit points of interest and labels, natively, with no custom layer. Not confirmed: whether it
  renders station names in multiple scripts (kanji/romaji) the way Stadia's tiles do, or a distinct
  rail-vs-bus distinction — Apple's category is a single umbrella, and documentation didn't settle
  the labeling question either way.
- **Whether MapKit could also take over route order-optimization** (the user's initial framing was
  "hand off to MapKit to handle optimal routing of locations for each day"). Checked and found false:
  `MKDirections` computes a route between exactly one source and one destination — no waypoints
  array, no order-optimization parameter of any kind exists in the public API. VROOM remains the
  Decision layer (ADR-0023); this was never really a MapKit-vs-MapLibre question and doesn't become
  one here.

Given native transit POI display covers the station-label need differently (not identically), and
given this transition's standing posture is "native ergonomics over fancy UI for now"
(`swift/TripKrakenApp`'s existing UI-direction decision), the user chose to drop the station-label
and hover-based path-highlighting features rather than replicate them, in favor of building directly
on MapKit's SDK/UI rather than porting MapLibre's.

## Decision

**The Swift client's map view is built directly on MapKit — SwiftUI's `Map`, `MapContentBuilder`,
`MapPolyline`, `Annotation`, `MapCameraPosition` — not MapLibre Native.**

Concretely:

1. **Basemap:** Apple's own standard/hybrid style, themed by the OS's own dark mode rather than a
   bespoke third-party dark style (Stadia's Alidade Smooth Dark has no MapKit equivalent to adopt),
   configured with `pointsOfInterest: .including([.publicTransport])` for transit context.
2. **Route lines:** one `MapPolyline` per Path segment, with color/opacity/dash computed in ordinary
   Swift (day color, active/metro/rest tier, `StrokeStyle` dash array for unrouted gaps) —
   re-expressing `MapView.tsx`'s coloring/opacity/gap logic natively, not porting MapLibre
   style-spec expressions.
3. **Stops/anchors:** SwiftUI `Annotation` views, using the same state-driven-view idiom the rest of
   the app already uses, replacing the GL circle-layer paint expressions.
4. **Camera:** `MapCameraPosition` fed by the same bounds-fitting math `boundsOf`/
   `computeInitialViewState` already implement in TypeScript — the logic ports; only the landing API
   changes.
5. **Dropped outright, not replicated:** the custom station-label layer (ADR-0034 §4) and
   hover-based path-shift highlighting (ADR-0036's map-hover wiring). Both were real
   MapLibre-specific capabilities with no MapKit equivalent. Native transit POI display is accepted
   as a different answer to what the label layer solved for, not a lesser port of it; hover-highlight
   has no planned substitute.
6. **VROOM stays the Decision layer (ADR-0023), untouched by this ADR.** The Swift client hands
   VROOM's already-decided stop order to MapKit for drawing and (eventually) turn-by-turn
   navigation. MapKit is never asked to decide order — it can't.

## Alternatives considered

- **MapLibre Native (the Swift SDK).** Would preserve Stadia's style, the data-driven paint
  expressions, and the station-label trick close to as-is. Rejected: it's a third-party rendering
  dependency to ship and maintain inside the app, with no SwiftUI-native binding layer to lean on,
  and it directly reverses what ADR-0038's Decision section already named as the plan ("moves off
  MapLibre/Stadia toward MapKit") — staying would need a specific reason, and preserving the
  station-label hack wasn't judged strong enough once native transit POI display covers the same
  need differently.
- **Replacing VROOM's order-optimization with MapKit/MKDirections.** Rejected as infeasible, not
  merely undesirable — confirmed via Apple's own request API shape that `MKDirections` has no
  waypoint-order-optimization capability at all. Recorded here so it isn't re-opened without new
  information from Apple.
- **Replicating the station-label layer via a bundled/synced station dataset** (e.g. surfacing the
  OSM-Japan rail graph ADR-0024 already maintains server-side, to the client for custom annotation).
  Not rejected outright — genuinely possible, and the data likely already exists server-side — but
  deferred: `pointsOfInterest: .including([.publicTransport])` is accepted as sufficient for now.
  Worth revisiting only if native POI display proves inadequate in real use (e.g. doesn't render
  station names the traveler needs).
- **Replicating hover-based path-shift highlighting via manual hit-testing against segment
  geometry.** Rejected — real but disproportionate effort for a hover-only, macOS-mouse-only
  affordance the user explicitly chose not to keep.

## Consequences

- **MapKit is now the target for all future Swift map-view work.** No MapLibre Native dependency
  enters the project; `TripKrakenKit` is unaffected either way, since it has no map-rendering code.
- **Basemap licensing/attribution vigilance does not carry forward to the Swift client.** ADR-0027's
  and ADR-0034's OSMF-compliance work (forced attribution controls, provider license verification)
  has no equivalent obligation under MapKit — Apple's own Maps terms apply, and attribution is
  handled by MapKit's own legal label with no custom control needed.
- **The station-label and hover-highlight features are explicitly not carried into the Swift
  client.** If either is missed once real data and daily use exposes a gap, the alternatives above
  name the fallback path for each rather than starting from zero.
- **ADR-0027, ADR-0029, and ADR-0034 continue to govern the web app unchanged.** They are not
  superseded — ADR-0038 sets no cutover date, and the web client keeps running on MapLibre until the
  Swift client reaches parity.
- **This closes one of ADR-0038's three named sub-decisions.** SwiftData-vs-GRDB for local
  persistence and how CloudKit replaces Turso's sync remain open.
