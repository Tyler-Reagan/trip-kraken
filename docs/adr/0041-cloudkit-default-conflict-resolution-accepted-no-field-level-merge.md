# ADR-0041: CloudKit's default conflict resolution is accepted; no field-level merge engine is built

- **Status:** Accepted
- **Date:** 2026-09-07
- **Supersedes:** —
- **Superseded by:** —
- **Constrained by:** ADR-0040 (leaves this question open in its Consequences), ADR-0038 (names it
  the third of three deliberately deferred sub-decisions)

## Context

ADR-0040 closed SwiftData vs. GRDB but explicitly left one question open: whether CloudKit's default
per-record conflict resolution is sufficient once sync is ever turned on, or whether this project
wants field-level merge semantics closer to what `scripts/db-sync.ts` (`bcbe28c`) already
demonstrates — a git-style three-way merge, diffed field by field against a stored merge-base
snapshot, so non-overlapping edits combine automatically and only genuine same-field conflicts
surface for manual resolution.

The user's answer: `db-sync.ts` is a one-off developer convenience — reconciling a solo developer's
local `db/dev.db` against deployed Turso during development — not a capability worth preserving into
the Swift client. Nothing about it is a proven end-user feature to port (ADR-0040 already established
this), and no one has asked for field-level merge as a product requirement independent of that script
existing.

## Decision

**No custom conflict-resolution or merge engine is built for the Swift client. If/when CloudKit sync
is ever enabled (still not scheduled by any ADR), its own default per-record resolution is accepted
as-is.** `scripts/db-sync.ts` is not ported to Swift in any form and continues to exist solely as
`main`'s developer tooling for the TypeScript app.

## Alternatives considered

- **Port `db-sync.ts`'s field-level three-way merge on top of SwiftData's history-tracking APIs.**
  Rejected — disproportionate engineering for a capability nobody has asked for as a product
  requirement; the only reason it was on the table at all was that the script already existed for an
  unrelated purpose. Revisit only if CloudKit's default resolution causes a real, observed problem
  once sync is actually built and used.

## Consequences

- **All three sub-decisions ADR-0038 deferred are now closed** (ADR-0039: MapKit; ADR-0040: SwiftData;
  this ADR: no custom merge layer). Nothing architectural remains open from that ADR's Consequences
  section.
- **Whether CloudKit sync is ever turned on at all remains unscheduled.** This ADR only settles what
  happens *if* it is: plain default resolution, no additional design or engineering burden beyond
  what ADR-0040 already paid for (the CloudKit-compliant schema).
- **`scripts/db-sync.ts` stays exactly what it is** — unaffected TypeScript-app dev tooling, with no
  obligation to keep its behavior in mind while building the Swift client.
