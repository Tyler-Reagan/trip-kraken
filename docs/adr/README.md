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
| [0006](0006-optimize-vs-refine-authority.md) | Lock-and-fill: manual intent survives re-optimization | Accepted |
| 0007 | Pipeline shape & where compute runs | _Planned_ |
| [0008](0008-persistence-and-state-model.md) | Persistence & schema management (Drizzle) | Accepted |
| 0009 | Enrichment & external data sources | _Planned_ |
| 0010 | Import strategy | _Planned_ |
| 0011 | Transit integration | _Planned_ |
| 0012 | Export | _Planned_ |
