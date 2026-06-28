# ADR-0007: Phased pipeline, server-side compute

- **Status:** Accepted
- **Date:** 2026-06-24
- **Supersedes:** —
- **Superseded by:** —
- **Amended by:** ADR-0015 (authority model retired — re-optimize is wholesale, no lock-and-fill)
- **Constrained by:** ADR-0006 (authority model)
- **Note:** Decided in the 2026-06-24 grilling session.

## Context

The app has several processing stages — import, enrichment, optimization, manual
refinement. We need to decide how they relate (does work flow automatically, or in
discrete user-triggered phases?) and where compute happens (client, server, or a
dedicated worker). Today the shape is already implicit: import auto-triggers background
enrichment, optimize is an explicit `POST /optimize`, and manual edits persist without
re-solving. This ADR makes that shape a decision rather than an accident, and settles
the compute location.

## Decision

### Phased pipeline with explicit re-optimization

Work happens in discrete phases the user drives, with exactly one automated background
stage:

- **Import** → creates Locations and **auto-enqueues background enrichment** (the one
  automatic stage; its job/durability model is ADR-0009).
- **Optimize / re-optimize** → **explicit, user-triggered.** Never fires automatically.
- **Refine** → manual edits (move/add/remove/exclude/lock) persist immediately and do
  **not** re-solve the itinerary.

Re-optimization is deliberately *not* reactive. Auto-re-solving on every edit would
fight the manual refinement the product exists to support and would contradict
lock-and-fill (ADR-0006): the optimizer speaks only when invoked. The discovery →
refinement loop stays under the user's control.

### Server-side compute, in route handlers

Optimization runs **server-side, in a Next.js route handler, in-process and
synchronously** (Fluid Compute). The client POSTs an optimize request; the server loads
Locations, runs the solver (ADR-0003), applies the reconciling write (ADR-0008), and
returns the updated trip. The data already lives in server SQLite, and the heuristic is
sub-second for typical trip sizes, so there is no case for client offloading or a
worker.

## Alternatives considered

- **Reactive pipeline.** Edits auto-propagate and re-solve. Rejected: fights manual
  refinement, makes small edits expensive, destabilizes the plan under the user's hands,
  and contradicts ADR-0006.
- **Hybrid (auto-place new locations, never re-sequence existing).** Rejected: more
  automation surface and fuzzy authority between user and optimizer for little gain.
- **Client-side optimization.** Rejected: splits the solver from the data it operates
  on, still requires server-side validation/reconciliation of the posted plan, and the
  workload doesn't need the instant/offline benefit.
- **Dedicated worker/queue for optimization.** Rejected: no long-running or CPU-bound
  workload exists for a single-user heuristic; pure infrastructure cost.

## Consequences

- The UI keeps an explicit "optimize" action; there is no live re-solve. A "stale"
  indicator (itinerary may not reflect recent edits) is a reasonable later UX addition,
  not a re-solve trigger.
- The solver, objective, and reconciling write stay co-located server-side with the DB
  (ADR-0003/0008), keeping one trust boundary.
- Enrichment is the only background job; its durability (today an in-memory queue lost
  on restart) is the subject of ADR-0009, not this ADR.
- If trip sizes ever grow far beyond the heuristic's comfort (hundreds of stops), the
  server-side boundary makes swapping in a heavier solver or an async job a contained
  change — revisit then.
