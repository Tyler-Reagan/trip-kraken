# ADR-0010: Import strategy

- **Status:** Accepted
- **Date:** 2026-06-24
- **Supersedes:** —
- **Superseded by:** —
- **Constrained by:** ADR-0002 (Location), ADR-0009 (enrichment on import)
- **Note:** Decided in the 2026-06-24 grilling session.

## Context

The original plan (recorded in project memory) was a Phase 1 with three import methods
— a shared-list scraper, Google Takeout CSV, and KML/KMZ upload — to be unified later in
Phase 2. In practice the code converged on a single path: **Google My Maps URL**. A My
Maps link carries a `mid`; Google exposes a stable public KML export
(`/maps/d/kml?forcekml=1&mid=…`) with **exact embedded coordinates** — no scraping, no
geocoding. That made the other two methods redundant, so Phase 2's "find a single stable
input" was effectively answered by the My Maps choice.

One gap remains: trip *creation* requires a `sourceUrl` (`createTripWithLocations`), so
there is no way to start an empty trip — even though the discovery features
(nearby search, manual add) assume you can build one from scratch.

## Decision

Two trip-creation entry points; nothing else for now:

1. **My Maps URL** — the primary bulk import. Extract `mid` → fetch the public KML →
   parse placemarks into Locations with exact coordinates, then enqueue background
   enrichment (ADR-0009). Requires the map be public ("Anyone with the link can view").
2. **Blank-slate** — create an **empty trip** and build it via manual add and discovery.
   `sourceUrl` becomes optional/nullable.

Other formats (Takeout CSV, KML/KMZ upload, GPX) are **deferred**, not designed out —
re-add one only when a real need appears.

## Alternatives considered

- **My Maps URL only (status quo).** Rejected: forces map authoring even for a hand-built
  itinerary and contradicts the discovery half of the product, which assumes you can start
  empty.
- **Multi-format import (re-add CSV/KML/GPX).** Rejected for now: each parser is ongoing
  maintenance, and My Maps' clean KML already covers the bulk-import case those methods
  existed for.
- **Google Maps *saved list* (the north star's original phrasing).** Rejected: saved
  lists have no stable public KML export and would require fragile scraping — the very
  thing the My Maps endpoint lets us avoid. My Maps is the deliberate substitute.

## Consequences

- `createTripWithLocations` / the schema must allow a null `sourceUrl`; a new "new empty
  trip" action is added alongside the URL import.
- The import step-2 lodging picker (currently PATCHing `isLodging`) becomes **Stay
  creation** (ADR-0005/0008); its copy ("base / lodging", "prepends lodging to every day")
  updates to the Stay model.
- My Maps' public-map requirement stays a user-facing precondition; the clear error when a
  map isn't public is retained.
- Blank-slate trips lean harder on Discovery (ADR-0009) and manual add as the way to
  populate Locations.
