# ADR-0010: Import strategy & trip-creation entry points

- **Status:** Accepted
- **Date:** 2026-06-24
- **Supersedes:** —
- **Superseded by:** —
- **Amended by:** ADR-0015 (step-2 "Stay creation" → lodging-kind Location; Manifest groups by kind)
- **Constrained by:** ADR-0002 (Location), ADR-0009 (discovery + enrichment)
- **Note:** Reframed in the 2026-06-24 grilling session — the foundation is
  create-and-discover, not bulk import; My Maps demoted from "primary" to accelerator.

## Context

Three Google-flavored things get conflated and must be kept distinct:

- **Google My Maps** — a custom map the user *authors* and publishes; exposes a clean
  public KML with exact coordinates. This is what the existing `/api/import` consumes.
- **Google Maps saved/starred lists** — the "Want to go" lists users actually keep in the
  Maps app. The north star's original "saved list" phrasing. No clean public export, but
  reachable via Google **Takeout** (GeoJSON/CSV).
- **Google Places** — the POI *search* API. Not a list import at all — it is discovery
  (ADR-0009).

The earlier draft made **My Maps the primary import**. That optimizes for data quality
(exact coords, no scraping) but not for what users arrive with: the median traveler has a
saved list, not a published custom map, so "paste your My Maps URL" as the front door is
an onboarding cliff. The foundation entry point should match what users have and lean on
the discovery the app is already built around.

## Decision

Trip creation is **create-and-discover first; bulk import is an accelerator.**

1. **Blank-slate + in-app Places search (the foundation).** Create an **empty trip**, then
   add Locations by searching Google Places in-app — both **unanchored** (text/keyword
   search to seed an empty trip) and **anchored** (nearby an existing Location). This is
   ADR-0009 discovery applied at build time; `findPlaceFromText` and `searchNearby` already
   exist. Requires no file or map authoring. `sourceUrl` becomes nullable.
2. **My Maps URL (accelerator).** Retained for users who already maintain a public custom
   map: extract `mid` → fetch public KML → parse placemarks into Locations with exact
   coordinates, then enqueue enrichment (ADR-0009). No longer the primary path — a
   power-user fast-track.

Saved-list-via-Takeout and other file formats (CSV/KML/KMZ/GPX) remain **deferred** —
re-add via Takeout only if bulk saved-list import proves wanted.

## Alternatives considered

- **My Maps as primary (earlier draft).** Rejected: best data quality, but assumes the
  user authored a published map — wrong default for the app's front door.
- **Saved/starred lists via Takeout as the primary.** Rejected for now: matches user data
  but needs geocoding/resolution (messier coords) and a file-upload flow; kept as the
  deferred path if bulk saved-list import is later prioritized.
- **My Maps only (status quo).** Rejected: no empty trips; contradicts the discovery half
  of the product.

## Consequences

- `createTripWithLocations` / schema allow a null `sourceUrl`; a "new empty trip" action is
  added, and the foundation onboarding is *create → search → add*, not *paste a URL*.
- **Discovery must support an unanchored mode** (Places text search with no anchor) for
  seeding an empty trip — a refinement to ADR-0009, which had framed discovery as
  anchored-nearby only.
- My Maps import remains but moves out of the primary onboarding path (e.g. a secondary
  "Import from My Maps" affordance).
- The import step-2 lodging picker becomes **Stay creation** (ADR-0005/0008); its
  single-lodging copy updates to the Stay model.
- Build priority follows the reframe: blank-slate + search is foundational (right after the
  ADR-0008 schema); the My Maps accelerator is lower priority.
