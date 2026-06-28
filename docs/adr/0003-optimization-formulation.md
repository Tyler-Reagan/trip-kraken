# ADR-0003: Optimization behind a pluggable solver interface

- **Status:** Accepted
- **Date:** 2026-06-23
- **Supersedes:** —
- **Superseded by:** —
- **Amended by:** ADR-0015 (inputs are constraint fields; output is `Placement`s; locks removed)
- **Constrained by:** ADR-0001 (objective), ADR-0005 (topology), ADR-0006 (locks)
- **Depends on:** ADR-0004 (travel cost)

## Context

Optimization is the riskiest, most-likely-to-change part of the app. Today it's a
hard-coded two-phase heuristic (k-means clustering, then nearest-neighbor + 2-opt)
welded directly into the optimize route. We want freedom to improve solution quality
later — up to a unified vehicle-routing-with-time-windows (VRPTW) solver — without
rewriting callers, and we want the objective (ADR-0001) to live in one place rather
than being smeared across the heuristic.

## Decision

We will define a **solver interface** that separates *the problem* from *how it's
solved*:

```
solve(problem: OptimizationProblem): Itinerary
```

- **`OptimizationProblem`** captures everything from the domain model: candidate
  locations, the base timeline (ADR-0005), locked/excluded constraints (ADR-0006),
  per-day budgets, and a **travel-cost provider** (ADR-0004). It does not know which
  algorithm runs.
- **`Itinerary`** is days of ordered stops — the same shape regardless of solver.
- The **objective function is a named, shared module** implementing ADR-0001's ranked
  criteria (feasibility ≫ travel ≫ intent ≫ balance). Solvers *call* it to score
  candidate solutions; they don't each re-encode penalties.
- The **default solver** is the current heuristic, reframed to honor the new
  structure: assign days to bases → cluster within base → sequence within day,
  treating locked stops as fixed and closed-hours as feasibility violations.
- A stronger solver (unified VRPTW, OR-Tools, etc.) may be introduced later as a new
  implementation of the same interface, selected by config — no caller changes.

## Alternatives considered

- **Keep the two-phase heuristic hard-wired (status quo).** Rejected: couples callers
  to one algorithm and scatters the objective; every quality improvement becomes a
  risky in-place rewrite.
- **Jump straight to a unified VRPTW now.** Rejected for *now*: large complexity and a
  solver dependency before the domain model and objective have settled. The interface
  keeps that door open without paying the cost yet.

## Consequences

- The objective becomes testable in isolation: feed it two itineraries, assert the
  better one scores lower.
- Two-phase decoupling (cluster-then-sequence) is now an implementation detail of the
  *default* solver, not an architectural commitment — its known suboptimality is
  bounded and swappable.
- Callers (the optimize route) depend only on `solve(problem)`; they assemble the
  problem from the domain model and persist the result.
- Existing optimizer bugs (e.g. the empty-cluster merge the code comments but never
  does) get fixed inside the default solver, audited against ADR-0001, not patched ad
  hoc.
