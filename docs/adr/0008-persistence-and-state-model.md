# ADR-0008: Persistence & schema management

- **Status:** Accepted
- **Date:** 2026-06-23
- **Supersedes:** —
- **Superseded by:** —
- **Constrained by:** ADR-0002 (domain model), ADR-0005 (topology), ADR-0006 (locks)
- **Cashes bills from:** ADR-0002, ADR-0005, ADR-0006
- **Note:** Shaped by the 2026-06-23 grilling session, which overrode the original
  "no ORM / hand-rolled migrations" draft in favor of Drizzle.

## Context

Three accepted ADRs deferred their schema changes here: ADR-0002 needs a `Stay`
entity, a `locked` flag, and per-Day Anchors; ADR-0005 replaces the `isLodging`
boolean with a Stay timeline; ADR-0006 replaces delete-all re-optimization with a
reconciling write. This ADR defines the durable storage, how its schema is defined and
evolved, and the transactional contract for mutating it.

The current persistence has specific, known problems this ADR must fix:

- Schema is bootstrapped by `CREATE TABLE IF NOT EXISTS` plus an append-only list of
  `ALTER TABLE` statements each wrapped in `try { } catch {}`. Failures are swallowed,
  and the list includes `ADD COLUMN isAnchor` followed later by
  `RENAME COLUMN isAnchor TO isLodging` — so a fresh database and an upgraded one are
  not guaranteed to converge, and nothing detects drift.
- `rebuildItinerary` does `DELETE FROM ItineraryDay` then recreates everything,
  destroying manual intent (now forbidden by ADR-0006).
- All SQL is hand-written and untyped against the row shapes.

Client-side caching and update propagation (the `reload`-after-mutation pattern in
`tripStore`) is deliberately **not** decided here: it is server-authoritative
full-refetch, a simple and reversible default that does not meet the bar for an ADR.
ADR-0007 may revisit it if the reactivity model forces a change.

## Decision

### Engine: SQLite, local-first, via Drizzle

Trip Kraken is a single-user, local tool. We keep an embedded SQLite database as the
single source of truth (WAL mode, foreign keys on). We adopt **Drizzle ORM** as the
schema definition, query layer, and migration tool. Drizzle settles three things at
once: a typed schema as the source of truth, type-safe queries (removing a class of
hand-SQL bugs), and a real migration generator. The underlying driver is
**`better-sqlite3`** (mature, synchronous — matching today's synchronous access, the
correct model for an in-process local DB — and it retires the experimental
`node:sqlite` dependency). Chosen over `libsql`, whose embedded-replica/Turso-sync
features serve a hosting need this ADR rejects.

### Schema is defined in Drizzle and evolved by generated migrations

The TypeScript schema is the source of truth. Schema changes are expressed there and
turned into ordered, recorded migrations via `drizzle-kit`; they run forward-only and
fail loud. This replaces the idempotent-`ALTER`-with-`try/catch` bootstrap entirely —
fresh and upgraded databases converge because they apply the same ordered migrations.

### Schema changes implementing 0002 / 0005 / 0006

- **`Stay`** *(new)* — `id, tripId → Trip, lodgingLocationId → Location, ord,
  startNight, endNight`. A Stay reuses a `Location` row as its Lodging (inheriting
  enrichment); a Trip's Stays are ordered with contiguous, non-overlapping night
  ranges. "Is this Location a Lodging?" = "is it referenced by a Stay?", replacing the
  `isLodging` boolean.
- **Day → Stay is derived, not stored.** A Day's Stay is the one whose
  `[startNight, endNight]` contains that night (ADR-0002 invariant 1). Night ranges
  work before calendar `startDate` exists.
- **Per-Day Anchors.** Each Day resolves a **start Anchor** and **end Anchor**
  (ADR-0002): normally the Stay's Lodging (round trip); a travel day's start Anchor is
  the previous Stay's Lodging. Anchors are derived from the Stay timeline where
  possible; an explicit entry/exit-point Anchor (airport/station) for arrival/departure
  is a later addition, not modeled now.
- **`Stop.locked`** *(new, default false)* — ADR-0006.

### Migration of existing data

A migration converts each trip's current `isLodging = 1` location into a single `Stay`
(ord 0) spanning all nights — the single-lodging trip becomes the degenerate one-Stay
timeline, preserving today's behavior exactly. Days then derive that one Stay.

### Re-optimization is a declarative reconciling write (ADR-0006)

Replace `rebuildItinerary`'s delete-all with a **declarative diff keyed on
`locationId`**. Stop identity is **stable per scheduled Location** (a scheduled Location
has one persistent Stop row), so the solver returns the complete desired itinerary and
the writer makes the DB match it, in one transaction:

- **insert** Stops for newly-scheduled Locations,
- **delete** Stops whose Location is no longer scheduled (excluded/removed),
- **update** `(day, order)` in place for unlocked Stops whose placement changed
  (preserving the row, its `notes`, and lock state),
- **leave locked** Stops untouched (they appear in the solver output as no-ops),
- route any **day-orphaned locked** Stop to Unassigned, lock inert, with a warning
  (ADR-0006).

The solver receives locked Stops as fixed input (ADR-0003); before commit the writer
**asserts the output honors every lock** (correct Day + relative order) so a solver bug
fails loud instead of silently moving a pinned Stop. In-place reassignment (not
delete+reinsert of unlocked Stops) is what preserves `notes` and identity for every
Stop.

### Transactional contract

SQLite serializes writers; with WAL, readers don't block the writer. Every
multi-statement mutation runs inside a single Drizzle transaction, so a partial failure
never leaves a half-written itinerary. Sufficient for a single-user local tool; a
hosted/multi-writer deployment would require its own ADR.

## Alternatives considered

- **Keep the `try/catch` ALTER bootstrap.** Rejected: silently diverging schemas and
  swallowed failures are exactly the fragility we're removing.
- **Hand-rolled minimal migration runner on `node:sqlite` (original recommendation).**
  Rejected during the grill in favor of Drizzle: the team valued type-safe queries and
  retiring the experimental driver over keeping the dependency surface at zero. Drizzle
  costs one dependency and some abstraction; it buys a typed schema, typed queries, and
  a migration tool that gets exercised immediately by these changes.
- **Move off SQLite to hosted Postgres.** Rejected: no multi-user or network
  requirement exists; local SQLite is faster and simpler for the actual use case.
- **Embed Lodging place data directly in `Stay`.** Rejected: would duplicate the
  enrichment pipeline; reusing a `Location` row keeps one source of place data
  (ADR-0002's Lodging-vs-Stay split).

## Consequences

- New dependencies: `drizzle-orm`, `drizzle-kit`, `better-sqlite3`. The existing
  `node:sqlite` access layer and the hand-written `CREATE/ALTER` bootstrap are
  replaced.
- `isLodging` disappears from the schema and types (ADR-0002); readers switch to Stay
  membership. `Location.isLodging`, `toggleLodging`, and lodging guards move to Stay
  operations.
- `rebuildItinerary` is replaced by a reconciling writer; its callers (the optimize
  route) change shape.
- Drizzle's typed schema becomes the data-access boundary; raw hand-written SQL outside
  it is an audit failure.
- Entry/exit-point Anchors and the client cache/sync strategy are explicitly out of
  scope here (future ADR-0007 / as-needed).
