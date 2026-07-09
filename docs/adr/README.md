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
