# ADR-0044: The Swift client's place search and enrichment run on-device via MapKit, not Google Places

- **Status:** Accepted
- **Date:** 2026-09-07
- **Supersedes:** —
- **Superseded by:** —
- **Amends:** ADR-0009 (§"Enrichment is single-provider... Google Places is authoritative" — narrowed
  in scope to the web app; the Swift client substitutes on-device MapKit, per the Decision below.
  ADR-0009 stands unchanged for the web app itself), ADR-0038 (names VROOM/OSRM/the rail graph as
  staying server-side for Phase A but says nothing about place search/enrichment — this ADR is the
  decision ADR-0038 left open for that surface)
- **Constrained by:** ADR-0042 (the same actor-isolated, serialize-with-backoff pattern this ADR
  reuses for `MKLocalSearch`'s own undocumented throttle), ADR-0040 (the Swift client's Locations
  live in local SwiftData, so enrichment has no server round-trip to make even if it wanted one)
- **Note:** Reconstructed from the implementing commit
  (`eacb816`, "Add on-device location enrichment via MapKit (ADR-0044)") and the code it introduced —
  the ADR file itself was never written at the time. Dated to that commit.

## Context

The web app's enrichment and discovery both go through Google (ADR-0009): Google Places is the
canonical resolver for a Location's identity, coordinates, address, rating, categories, phone, and
hours; discovery search runs through a `DiscoveryProvider` interface Google backs by default.

The Swift client (ADR-0038, Phase A) keeps VROOM, OSRM, and the rail graph server-side, but a Trip's
Locations live entirely in local SwiftData (ADR-0040) with no server-side row to enrich against.
Continuing to call a Google-backed endpoint from the client would mean either standing up a
trip-less enrichment endpoint (the ADR-0043 pattern) purely to proxy Google, or giving the client its
own Google API key and billing relationship — neither of which is required, because Apple's own
on-device `MKLocalSearch` already answers the same underlying question ("find places matching this
text") for both enrichment (best match for an already-known name) and discovery (free-text search for
something new), with no network dependency on this project's own server at all.

`MKMapItem`'s `address`/`location` properties — needed to fill in what enrichment writes — are iOS/
macOS 26.0+ only, a genuinely new-this-cycle API rather than a workaround for an older one. Checked
against Apple's current documentation: `MKLocalSearch`/`MKMapItem` expose no rating, no review count,
and no opening hours — fields Google Places does provide and ADR-0009 lists as part of enrichment's
job on the web app.

## Decision

**One actor, `MapKitPlacesProvider`, answers every place-search job on the Swift client via
`MKLocalSearch`: free-text search to add a new Location, enrichment (single-best-match for an
existing Location's name), and along-route search (sampling points along a corridor, since
`MKLocalSearch` takes only a circular region) — replacing Google Places entirely for this client.**

- **Enrichment writes address, phone, and a single POI category only.** Rating, review count, and
  hours are left unwritten — not a bug to fix later, but an honest reflection of what MapKit's API
  surface actually returns. `MKPointOfInterestCategory` is also a single value where Google's `types`
  is multi-tag; the raw identifier (`"MKPOICategoryRestaurant"`) is humanized to `"Restaurant"` so the
  existing category-formatting UI, built for Google's shape, still renders something readable.
- **Recovery is manual, not automatic — a real deviation from ADR-0009.** The web app rescans for
  `pending` Locations on server startup and re-enqueues them automatically; the Swift client has no
  server-side queue to rescan and no background process of its own. `enrichableLocations(trip)` (pending
  or failed) is walked only when the toolbar's "Enrich" action is invoked, mirroring the *retry* shape
  ADR-0009 kept for `failed` rows, not the *automatic* recovery it added for `pending` ones. A `.done`
  Location is never re-enriched automatically either way.
- **Serialization and backoff mirror `MapKitGeometryProvider` exactly (ADR-0042), for the same reason:**
  `MapKitPlacesProvider` is an `actor`, giving one-at-a-time request serialization for free, with
  exponential backoff (2s, doubling, up to `maxRetries`) on `MKError.loadingThrottled` — MapKit's rate
  limit is real but undocumented, same as for `MKDirections`.
- **A "no match" is a real, terminal answer, not a transient failure.** `enrich(name:near:)` returning
  `nil` marks a Location `.failed` with reason "No match found" — distinguished from throttling, which
  retries instead of failing.
- **Along-route search required real work, not just a different search origin.** `MKLocalSearch` has
  no polyline-region option, so `AlongRoute.swift`'s `samplePoints`/`flattenPathGeometry`/
  `distanceToRoute` turn an already-known route (typically the map's own held Path geometry for that
  gap) into a handful of sample points, search each in turn through the same serialized actor, merge
  and dedupe what comes back, and rank by true distance to the whole route rather than to whichever
  sample happened to find a given result first.
- **`PlaceSearchRequesting`/`MKLocalSearchRequester` split for testability, mirroring
  `DirectionsRequesting`/`MKDirectionsRequester` (ADR-0042).** `MKMapItem` has no public initializer
  with the fields needed, so a fake can't construct one; every decision (retry, backoff, single-match-
  vs-every-result) lives in the tested `MapKitPlacesProvider`, and the thin requester is exercised only
  by running the app.
- **Platform floor raised to iOS 26/macOS 26** (`swift-tools-version: 6.2`) specifically for
  `MKMapItem.address`/`.location`. No back-compat path via the older, now-deprecated
  `MKPlacemark`-based APIs was taken — [no users, not deployed](../../CLAUDE.md), so there is no
  compatibility obligation to preserve.

## Alternatives considered

- **Proxy Google Places through a trip-less server endpoint** (the ADR-0043 pattern applied to
  enrichment/discovery instead of geometry). Rejected: MapKit already answers the same question
  on-device for free, and a proxy would still need the client to shape and ship its own API key/billing
  concern to the server, for no benefit over calling MapKit directly.
- **Give the Swift client its own Google Places API key.** Rejected: adds a second billing relationship
  and a second provider integration to maintain, for data (rating, hours) this ADR already accepts
  going unfilled — see Consequences.
- **Automatic startup rescan of `pending` Locations, matching ADR-0009's web-app behavior.** Rejected
  for this first cut: the Swift client has no long-running server process to run a rescan from: it
  would mean rescanning on every app launch instead, a different trigger ADR-0009 never specified and
  wasn't asked for. Left as manual-only; automatic recovery on launch is a plausible, currently
  undecided follow-up.
- **Fall back to the pre-26 `MKPlacemark`-based search APIs to avoid raising the platform floor.**
  Rejected: those APIs are already deprecated, and there is no pre-launch user base this project owes
  backward compatibility to.

## Consequences

- **Google Places is no longer in the Swift client's dependency graph at all.** No API key, no
  billing, no network call leaves the device for search/enrichment — a real simplification ADR-0038
  didn't anticipate needing to make.
- **Enriched Locations on the Swift client permanently lack rating, review count, and hours** — not a
  gap to backfill from MapKit later (the API doesn't expose them), but a standing difference from what
  the web app's Google-backed enrichment fills in. Any UI that assumes those fields exist needs to
  tolerate their absence on this client.
- **`.pending` Locations no longer self-heal without user action.** Losing ADR-0009's automatic
  startup rescan means a Location stuck at `.pending` (e.g. added while offline) stays that way until
  someone taps "Enrich" — worth naming plainly since it's a behavior regression relative to the web
  app, accepted deliberately rather than overlooked.
- **The platform floor (iOS/macOS 26) is now a hard dependency for anyone building this client**,
  binding the whole app, not just the enrichment surface, to whatever else that OS version requires.
- **`LocationSearchView` unifies the web app's three separate discovery modes** (unanchored,
  anchored/"nearby", along-route) into one view and one provider method, rather than three endpoints —
  a client-side simplification `optimizationProblem`/`MapKitGeometryProvider`'s own single-provider
  shape already made natural.
