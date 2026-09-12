# Architecture Decision Records

This directory records the **decisions** that shape Trip Kraken, top-down from the
product goal. We refactor against these records, not against the current code: an
audit asks "does this conform to the relevant ADR?", not "is this good in a vacuum."

Stack and implementation are secondary to the goal. Any of them may change when an
ADR says so.

## How to read these

The project's ubiquitous language lives in [`CONTEXT.md`](../../CONTEXT.md); ADRs use
those terms.

Start at `0001` (the north star) and read down. Lower-numbered ADRs constrain
higher-numbered ones. Each ADR is immutable once **Accepted** — to change a
decision, write a new ADR that **Supersedes** the old one and flip the old one's
status to **Superseded by ADR-NNNN**.

## Status legend

`Proposed` → under discussion · `Accepted` → in force · `Superseded` → replaced ·
`Deprecated` → no longer relevant, not replaced.

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [0000](0000-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0001](0001-north-star-and-success-criteria.md) | North star & what makes an itinerary good | Accepted |
| [0002](0002-domain-model.md) | Domain model & invariants | Accepted |
| [0003](0003-optimization-formulation.md) | Optimization behind a pluggable solver interface | Accepted |
| [0004](0004-travel-cost-model.md) | Travel cost behind a pluggable provider | Accepted |
| [0005](0005-trip-topology.md) | Multi-lodging sequential trip topology | Accepted |
| [0006](0006-optimize-vs-refine-authority.md) | Lock-and-fill: manual intent survives re-optimization | Superseded by 0015 |
| [0007](0007-pipeline-shape-and-compute.md) | Phased pipeline, server-side compute | Accepted |
| [0008](0008-persistence-and-state-model.md) | Persistence & schema management (Drizzle) | Accepted |
| [0009](0009-enrichment-and-data-sources.md) | Enrichment & external data sources | Accepted |
| [0010](0010-import-strategy.md) | Trip creation: blank-slate + search; My Maps accelerator | Accepted |
| [0011](0011-transit-integration.md) | Transit integration (pluggable, handoff) | Accepted |
| [0012](0012-export.md) | Export (pluggable, Markdown baseline) | Accepted |
| [0013](0013-accommodation-bookings-and-derived-anchors.md) | Accommodations as timed bookings; day anchors derived | Superseded by 0015 |
| [0014](0014-location-primitive-date-bookings-derived-roles.md) | Location as primitive; stays as date bookings; roles and anchors derived | Superseded by 0015 |
| [0015](0015-locations-typed-by-kind-constraints-and-plan.md) | Locations typed by kind; constraints as fields, plan as placements | Accepted |
| [0016](0016-feasibility-gate-and-deferred-balance.md) | Feasibility is a hard gate; category balance deferred to advisory suggestions | Accepted |
| [0017](0017-surface-feasibility-violations.md) | The solver's result surfaces feasibility violations, not just an arrangement | Accepted |
| [0018](0018-transit-cost-time-policy-and-provider-shape.md) | Transit cost: time-of-day policy and provider shape | Accepted |
| [0019](0019-japan-osm-transit-graph-provider.md) | Japan transit provider: OSM topology graph, no timetables (Phase 1) | Accepted |
| [0020](0020-optimizer-eligible-day-masks-and-coverage.md) | Optimizer: eligible-day masks and per-metro coverage | Accepted |
| [0021](0021-leg-renamed-to-path-travel-primitive.md) | Leg renamed to Path; Path is the travel primitive | Accepted |
| [0022](0022-path-taxonomy-and-composed-travel-cost.md) | Path as a kind-narrowed union; travel cost composed, not inherited | Accepted |
| [0023](0023-vroom-as-the-decision-layer.md) | VROOM is the Decision layer; the objective is the solver's | Accepted |
| [0024](0024-osrm-facts-source-and-capability-dispatched-registry.md) | OSRM as primary road Facts; capability-dispatched provider registry | Accepted |
| [0025](0025-bff-over-http-services-and-deployment-posture.md) | The app stays a BFF; VROOM and OSRM are upstream HTTP services | Accepted |
| [0026](0026-self-heal-plan-repair.md) | A removed activity Placement self-heals its Day locally; re-optimize stays optional, never forced | Accepted |
| [0027](0027-stadia-basemap-over-carto.md) | Stadia Maps replaces CARTO as the basemap provider | Accepted |
| [0028](0028-transit-constraint-fields-and-trip-edges.md) | Transit carries `arriveAt` / `departAt`; trip edges are unique by construction | Accepted |
| [0029](0029-map-renders-path-geometry-at-request-time.md) | The map renders one line per Path, from geometry fetched at request time and held only in memory | Accepted |
| [0030](0030-rail-segment-geometry-ingest-and-partial-path-shapes.md) | Rail geometry is traced at ingest, stored per ride edge, and a Path carries the real spans it has | Accepted |
| [0031](0031-bus-geometry-left-unmodeled.md) | Bus Path geometry is left unmodeled; the map's one remaining disagreement with the Plan is accepted | Accepted |
| [0032](0032-rail-journey-decomposes-per-shift.md) | A rail Journey decomposes into one Path per shift, transfers and access walks included | Accepted |
| [0033](0033-premium-boarding-penalty.md) | Boarding a premium service costs flat minutes, charged once per boarding | Accepted |
| [0034](0034-map-rendering-stack-stays-station-labels-added-client-side.md) | The map rendering stack stays as-is; station labels are added client-side | Accepted |
| [0035](0035-surfaced-transit-projected-as-a-provenance-not-a-kind.md) | Surfaced Transit is `Transit.authored: false`, not a new kind, projected by a standalone function | Accepted |
| [0036](0036-row-per-path-shift-rows-in-the-itinerary-and-map-panel.md) | Itinerary and map panel render one row per Path shift, not per Journey | Accepted |
| [0037](0037-hosting-goes-live-fly-io-turso-and-a-password-gate.md) | Hosting goes live: Fly.io for VROOM/OSRM, Turso for the database, a password gate | Accepted |
| [0038](0038-swift-native-client-vroom-osrm-stay-server-side-for-now.md) | Client rebuilds as Swift-native; VROOM/OSRM/rail graph stay server-side for now | Accepted |
| [0039](0039-swift-client-maps-with-mapkit-not-maplibre.md) | The Swift client maps with MapKit, not MapLibre Native | Accepted |
| [0040](0040-swift-client-persists-with-swiftdata-schema-built-cloudkit-compliant.md) | Swift client persists with SwiftData, schema built CloudKit-compliant from the start | Accepted |
| [0041](0041-cloudkit-default-conflict-resolution-accepted-no-field-level-merge.md) | CloudKit's default conflict resolution accepted; no field-level merge engine built | Accepted |
| [0042](0042-mapkit-supplies-road-geometry-on-device.md) | MapKit supplies road geometry on-device; the server keeps only rail | Accepted |
| [0043](0043-trip-less-path-geometry-endpoint.md) | A trip-less sibling of the path-geometry endpoint | Accepted |
| [0044](0044-swift-client-place-search-and-enrichment-via-mapkit.md) | Swift client's place search and enrichment run on-device via MapKit, not Google Places | Accepted |
| [0045](0045-trip-less-optimize-endpoint.md) | A trip-less sibling of the optimize endpoint | Accepted |
| [0046](0046-path-geometry-retry-splits-blip-from-sustained-throttling.md) | Automatic path-geometry retry stays a short blip window; a sustained failure hands off to a person | Accepted |
