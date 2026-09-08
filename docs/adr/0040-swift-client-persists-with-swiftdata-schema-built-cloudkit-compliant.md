# ADR-0040: The Swift client persists with SwiftData, its schema built CloudKit-compliant from the start

- **Status:** Accepted
- **Date:** 2026-09-07
- **Supersedes:** —
- **Superseded by:** —
- **Constrained by:** ADR-0038 (names this as one of three deliberately deferred sub-decisions),
  ADR-0028 (the trip-edge uniqueness invariant this ADR changes the enforcement layer for)

## Context

ADR-0038 left SwiftData vs. GRDB open rather than pre-deciding it. Both are viable local stores for
the Swift client; no local persistence exists yet at all (the sample trip is a hardcoded Swift
literal), so this is greenfield, not a migration.

The deciding consideration turned out not to be "which local store is better" in isolation, but
what each implies about sync. ADR-0038's Consequences framed "how CloudKit replaces Turso's sync" as
a peer sub-decision — but the thing currently on `main` under that name (`scripts/db-sync.ts`,
`bcbe28c`) is developer tooling that reconciles a solo developer's local `db/dev.db` against the
deployed Turso database; it is not, and never was, an end-user multi-device sync feature. The
production web app has no client-side database at all — it's server-rendered, reading Turso directly
per request. So there is no existing proven sync behavior to preserve. Separately, ADR-0038's own
architecture only requires VROOM/OSRM/the rail graph to be reachable over the network — nothing
requires trip data itself to leave the device. Multi-device sync for the Swift client is therefore a
feature being newly chosen, not a port of anything that already works.

That reframing changes what SwiftData actually costs. Verified against current (2026) sources before
deciding, not assumed from training-data memory: a CloudKit-backed SwiftData store forbids
`@Attribute(.unique)` entirely, requires every relationship to be optional, and requires every
non-optional attribute to carry a default — real friction against this project's actual schema
(`src/lib/db/schema.ts`), which relies on three DB-level unique constraints: `trip_name_unique`, the
two partial indexes enforcing ADR-0028's "at most one arrival/departure Location per Trip," and
`JourneyRoadKind`'s composite unique-per-pair. But those constraints are a CloudKit limitation, not a
SwiftData one — CloudKit cannot do atomic uniqueness checks across offline devices regardless of
which local store sits in front of it, so a GRDB-plus-hand-rolled-CloudKit-sync design would hit the
identical wall the moment two offline devices raced an edit. The constraint loss is the cost of
wanting CloudKit sync at all, not a SwiftData-specific tax.

Also verified before deciding: enabling CloudKit sync later, on an already-shipped local-only
SwiftData store, is not a clean toggle. Current developer-forum reports (2026) describe real
failures — "SwiftData crash when enabling CloudKit for existing users" among them — when a store
built without CloudKit's constraints in mind is later reconfigured to expect one. The safe order is
the reverse: design the schema to already satisfy CloudKit's rules, then decide separately, whenever
warranted, whether to actually turn sync on.

Cost check before deciding: CloudKit's private database — the only one this app would ever use, since
it holds one user's own trips — is never billed to the developer; usage counts against the end user's
own iCloud storage quota. The Apple Developer Program membership this decision would otherwise be
weighed against is already a sunk cost, unrelated to this choice. SwiftData itself, GRDB, and
CloudKit's private-database tier are all free regardless of which way this ADR went.

## Decision

**The Swift client persists locally with SwiftData. Its schema is written to satisfy CloudKit's
constraints from the start, even though CloudKit sync itself is not enabled by this ADR.**

Concretely, when the persistence layer is actually built:

1. No `@Attribute(.unique)` anywhere. `trip_name_unique`'s collision guard becomes purely app-level —
   this project already has the muscle for this (`schema.ts` documents an app-level
   `checkTripNameCollision` pre-check backing the DB index today). ADR-0028's "at most one
   arrival/departure Location per Trip" and `JourneyRoadKind`'s composite uniqueness get an
   equivalent app-level validation pass in `TripKrakenKit`, rather than a stored index.
2. Every `@Model` relationship is optional.
3. Every non-optional attribute carries a default.
4. No `ModelConfiguration(cloudKitDatabase:)` is configured yet — the store starts local-only
   (`.none`). Turning sync on is left to a follow-up decision (see Consequences), made easier
   specifically because this ADR keeps the schema already compliant when that day comes.

## Alternatives considered

- **GRDB, local-only, schema ported faithfully from `src/lib/db/schema.ts`.** Full SQL fidelity —
  the JSON columns, partial indexes, cascading FKs, and single-table-per-`kind` discriminated union
  all port close to 1:1, and `DatabaseMigrator` closely parallels the existing Drizzle migration
  files. Rejected for now: it has zero CloudKit integration, so any future sync would be a
  from-scratch engine — real, ongoing infrastructure this project has consistently chosen not to
  build ([[project_outsource_over_build]]) when a provider (here, Apple's own framework) already
  solves the problem. Remains the right call specifically if a future decision rejects CloudKit's
  sync model outright (e.g. wanting `db-sync.ts`-style field-level merge instead of CloudKit's
  coarser per-record resolution) — see Consequences.
- **SwiftData without pre-emptive CloudKit compliance** (use `@Attribute(.unique)` and non-optional
  relationships freely now, decide on sync later). Cheaper today, but rejected: current, dated
  reports confirm that flipping an existing local-only store to `cloudKitDatabase: .automatic` is a
  real failure mode, not a toggle — this trades a small cost now for an open-ended migration risk
  later, the opposite of what this project's schema-change history (ADR-0015, ADR-0028) has favored.

## Consequences

- **The schema pays a real, bounded cost today for three lost DB-level guarantees.** Trip-name
  collision, single-arrival/departure-per-trip, and per-pair `JourneyRoadKind` uniqueness all move to
  app-level validation in Swift. This is mechanical, scoped work — not architecture-altering — but it
  is work, and it must happen before or alongside the SwiftData models themselves, not after.
- **No CloudKit sync exists yet, and this ADR does not schedule it.** The Swift client remains
  single-device until a follow-up decision turns `cloudKitDatabase` on. That follow-up inherits a
  schema that's already compliant, which is the entire point of paying the cost now.
- **The open question ADR-0038 filed as "how CloudKit replaces Turso's sync" is reframed, not yet
  answered.** There is no existing sync behavior to replace — `db-sync.ts` is unaffected dev tooling.
  The real remaining question is whether CloudKit's default per-record conflict resolution is
  sufficient, or whether this project wants field-level merge semantics closer to what `db-sync.ts`
  already demonstrates it values enough to have built once. That decision is free to reject CloudKit
  sync entirely — nothing here commits to turning it on, only to being ready if it's wanted.
- **`TripKrakenKit` gains real scope it didn't have before:** validation logic for the three
  invariants above becomes domain logic the library owns, not a database's job — consistent with
  ADR-0038's framing of `TripKrakenKit` as the pure domain layer.
