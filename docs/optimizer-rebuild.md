# Optimizer Rebuild — Status & Roadmap (ADR-0003, ADR-0004)

> **Status: PLANNING.** No code changed yet. This doc exists to track the gap between what
> ADR-0003 (solver interface) and ADR-0004 (travel-cost provider) already say is decided, and
> what `src/lib/optimizer.ts`/`optimize.ts` actually do today — and to record the slice plan
> once one is chosen. Modeled on the now-deleted `place-model-rebuild.md`, which tracked the
> ADR-0015 model swap the same way.

## TL;DR

**ADR-0003 and ADR-0004 are Accepted but only partially built.** The domain model (ADR-0015)
and trip topology (ADR-0005) are real; the optimizer itself is still the pre-ADR-0003 monolith
they were meant to replace — one function, no interface, no swappable travel cost. This doc
tracks closing that gap, not re-deciding the objective (ADR-0001 is settled) or the topology
(ADR-0005 is settled).

---

## Where we are

### What's decided (ADR-0001, 0003, 0004, 0005 — all Accepted)

- **The objective (ADR-0001):** feasibility ≫ travel ≫ intent ≫ balance, expressed as one
  comparable cost. Intent (locking) was later dropped by ADR-0015 — re-optimize is wholesale —
  so the live ranking is feasibility ≫ travel ≫ balance.
- **The solver interface (ADR-0003):** `solve(problem: OptimizationProblem): Itinerary`, with
  the objective as a **named, shared module** solvers call to score candidates, and the default
  solver being today's heuristic reframed (not replaced) behind that seam. A stronger solver
  (VRPTW, OR-Tools) is a later, config-selected implementation of the same interface.
- **The travel-cost provider (ADR-0004):** `cost(from, to, mode)` / `costMatrix(points, mode)`,
  default implementation haversine + fixed per-mode speed, real routing APIs pluggable later.
- **Trip topology (ADR-0005):** multi-lodging Stays anchor days; clustering runs within a Stay's
  scope; travel-between-Stays days route lodging→lodging. This part **is** built (see below).

### The gap — what the code still does (pre-ADR-0003 shape)

| Concern | Code today | Lives in | ADR target |
|---|---|---|---|
| Entry point | `optimizeItinerary(locations, numDays, stays, ...)` — a plain function with 6 positional/optional params | `optimizer.ts` | `solve(problem: OptimizationProblem): Itinerary` — one typed input, one algorithm-agnostic output |
| Objective | Feasibility/travel/balance penalties (window penalty, category-balance, day-budget) hand-inlined across `nearestCentroidIndex`, `windowPenaltyKm`, `routeWindowPenalty` | `optimizer.ts` | A **named, shared objective module** implementing ADR-0001's ranked criteria; solvers call it, don't re-encode it |
| Travel cost | `haversine()` + a hardcoded `AVG_SPEED_KM_PER_MIN` constant, called directly throughout | `optimizer.ts` | A **travel-cost provider** (`cost`/`costMatrix`, mode-aware), default = haversine, swappable for a routing API later |
| Algorithm choice | One hard-coded two-phase heuristic (k-means → nearest-neighbor + 2-opt), no seam to swap it | `optimizer.ts` | The heuristic becomes the **default implementation** of the solver interface; alternates (VRPTW) plug in beside it, chosen by config |
| Testability of objective | Only testable indirectly, by running the whole heuristic and inspecting output | `optimizer.test.ts` | Feed the objective two itineraries directly, assert the better one scores lower — no solver required |

### Already aligned with ADR-0005 (topology) — not part of this gap

`StayPlan`, `dayAnchor`/`seqStart`/`seqEnd`, and the k-means anchor-tethering already implement
"cluster within a Stay's scope, route between Stays lodging→lodging." This machinery is *inside*
the monolith today but its logic doesn't need to change — it needs to move behind the new seam,
not be redesigned.

### Parked, not part of this gap (per ADR-0015 / ADR-0011)

- **Transit constraint fields** — `kind: transit` carries no fields yet; trip-edge (arrival/
  departure) routing stays dormant until a shape lands (ADR-0011). `EdgeAnchors` in
  `optimizer.ts` is kept ready but unfed.
- **A second, stronger solver (VRPTW/OR-Tools)** — ADR-0003 explicitly defers this past building
  the interface. Out of scope until the interface exists and earns a reason to add one.

---

## Where we're going

Not yet decided — first decision needed is sequencing (one PR vs. stacked slices) and how thin
the first cut can be. A reasonable default shape, subject to revision once actually scoped:

| # | Slice | Scope |
|---|---|---|
| **O1** | **Objective module** | Extract ADR-0001's penalties (window, category-balance, day-budget) out of `nearestCentroidIndex`/`windowPenaltyKm`/`routeWindowPenalty` into one named, directly-testable module. No behavior change — same weights, same output — this is a pure extraction. |
| **O2** | **Travel-cost provider** | Wrap `haversine` + `AVG_SPEED_KM_PER_MIN` behind `cost`/`costMatrix(mode)`; default provider preserves current behavior exactly. Callers (`kMeans`, `sequenceDay`, `nearestNeighborOrder`, `twoOpt`) consume the provider instead of calling `haversine` directly. |
| **O3** | **Solver interface** | Define `OptimizationProblem`/`Itinerary` types; wrap the existing two-phase heuristic as the default `solve()` implementation; `optimize.ts` assembles the problem from `TripWithDetails` and calls `solve()` instead of `optimizeItinerary()` directly. |

This is a guess at slicing, not a locked plan — revisit once someone sits down to actually build
O1.

## Decisions needed

- **Sequencing:** stacked PRs (O1→O3) vs. one PR. The ADR-0015 rebuild used stacked layers
  because the model didn't fully run mid-stack; this refactor is different — each slice can
  preserve full behavior at every step (all are pure extractions until O3 flips the caller), so
  a single PR may be viable. Needs a call before starting.
- **Scope of "default solver."** ADR-0003 says the default solver is "the current heuristic,
  reframed" — confirm no algorithmic change is in scope for this pass (a pure interface
  extraction), with quality improvements (VRPTW, etc.) deliberately deferred to a later ADR-scoped
  effort.

## Status log

- 2026-07-05 — Doc created. Gap audited against ADR-0001/0003/0004/0005 and current
  `optimizer.ts`/`optimize.ts`. No code changed.
