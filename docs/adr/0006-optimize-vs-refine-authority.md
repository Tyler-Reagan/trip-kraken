# ADR-0006: Lock-and-fill — manual intent survives re-optimization

- **Status:** Accepted
- **Date:** 2026-06-23
- **Supersedes:** —
- **Superseded by:** —
- **Constrained by:** ADR-0001 (intent ranks above optimality)
- **Constrains:** ADR-0002 (Stop.locked), ADR-0003 (solver honors locks), ADR-0008 (reconciling write)
- **Note:** Lock semantics & lifecycle (the section below) were pinned down in the
  2026-06-23 grilling session.

## Context

The app has two sources of truth in tension: the optimizer's automatic plan and the
user's manual edits. Today, re-optimizing calls `rebuildItinerary`, which deletes all
days and stops and regenerates them — silently destroying every manual placement. The
discovery → refinement loop is the whole point of the product, so refinement must
survive re-optimization.

## Decision

We adopt a **lock-and-fill** authority model:

- A **Stop carries a `locked` flag** (ADR-0002). Locking pins it to its **Day** and its
  **order relative to other locked Stops**. The user locks a stop explicitly, and any
  hand-placement (manual move/add) is treated as locked by default.
- **Re-optimization is constrained, not total.** The solver (ADR-0003) treats locked
  stops as **fixed constraints**: their Day and relative order are honored, and the
  optimizer arranges all *unlocked* stops in any remaining slot around them.
- **Locks are honored even when suboptimal**, consistent with ADR-0001's ranking
  (intent ≫ travel quality). The optimizer may warn (e.g. "this lock forces a long
  detour") but never silently overrides.
- **Re-optimize never deletes the itinerary wholesale.** It reconciles in place,
  preserving Stop identity (ADR-0008's declarative write).

## Lock semantics & lifecycle

The mechanics that make lock-and-fill concrete (decided in the grilling session):

- **What a lock pins:** Day membership + order relative to other locked Stops. A single
  lock therefore degrades to "stays on this Day"; the optimizer still routes unlocked
  Stops freely around it. A fixed-*time* pin (e.g. a 7pm reservation) is a distinct,
  richer lock variant deferred to later, built on the optimizer's time-window machinery.
- **Identity across re-opt:** Stop identity is **stable per scheduled Location**
  (ADR-0008). Re-optimization reassigns `(day, order)` *in place* for unlocked Stops and
  leaves locked ones — so `notes` and lock state survive for *every* Stop, not just
  locked ones.
- **Orphaned lock (its Day removed, e.g. day-count reduced):** the Stop moves to the
  **Unassigned** bucket keeping its notes, with a surfaced warning; its day-pin is void
  so the lock goes inert until re-placed. Re-opt proceeds — we *surface*, never block or
  silently relocate.
- **Excluding/deleting a locked Stop's Location:** a **confirm-and-cascade** — prompt
  naming the consequence, then on confirm unschedule the Stop (lock included). Delete
  removes Location + Stop; Exclude removes the Stop but keeps the Location in the pool.
  (Direct action on the locked item ⇒ informed confirmation, not the "surface-only"
  treatment given to the *indirect* re-opt orphan above.)

## Alternatives considered

- **Optimizer is source of truth (status quo).** Re-opt regenerates everything.
  Rejected: destroys manual intent, contradicts ADR-0001, makes the refinement loop
  hostile.
- **Manual is source of truth (optimizer only proposes).** Rejected: too passive for a
  tool whose value *is* automatic optimization; the user would hand-build everything.
- **Lock whole days instead of stops.** Rejected: too coarse — users pin specific
  must-do stops, not entire days.

## Consequences

- `rebuildItinerary`'s delete-all-and-recreate strategy is replaced by a declarative
  reconciling write keyed on `locationId` that preserves Stop identity (ADR-0008).
- The solver interface (ADR-0003) takes locked stops as part of the
  `OptimizationProblem`, must produce a result consistent with them, and the writer
  **asserts** that consistency before commit (a solver lock-violation fails loud).
- The UI needs: a lock affordance per stop, a visible locked-vs-auto-placed distinction,
  the Unassigned bucket surfacing orphaned locks with a warning, and a confirm dialog
  for excluding/deleting a locked Stop's Location.
- A locked set that is itself infeasible is a surfaced warning state, not a crash —
  surfaced, not resolved by force. (With Day+relative-order locks, infeasibility is rare;
  it becomes live once fixed-time locks are added.)
