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
tracks closing that gap. The objective itself was amended mid-stream by **ADR-0016**: category
balance is out of the authoritative objective (deferred to a later advisory feature), and
feasibility is a hard lexicographic gate, not a weighted term in one summed cost.

---

## Where we are

### What's decided (ADR-0001, 0003, 0004, 0005, 0016 — all Accepted)

- **The objective (ADR-0001, amended by ADR-0016):** originally feasibility ≫ travel ≫ intent ≫
  balance, expressed as one comparable cost. Intent (locking) was dropped by ADR-0015. ADR-0016
  then narrowed this further: the **authoritative** objective is feasibility ≫ travel only,
  compared as two lexicographic tiers (a feasibility violation always loses to a feasible
  candidate, regardless of travel cost) — not summed into one flattened number. Category/variety
  balance is removed from the authoritative objective entirely and deferred to a later, advisory
  suggestions feature (not scored, not part of what "optimized" means).
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
| Objective | Feasibility penalties (window, day-budget) live in `objective.ts`, called by `optimizer.ts`. They're still summed into one flattened cost with travel distance — not yet the lexicographic gate ADR-0016 requires. | `objective.ts` + `optimizer.ts` | A composed whole-itinerary comparator (O3) that checks feasibility **before** ever comparing travel — two tiers, not one sum |
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
- **Lodging-gap coverage (found 2026-07-05, deliberately out of scope here).** ADR-0001's
  "every day reachable from lodging" clause is *not* actually guaranteed today — lodging
  `checkInDate`/`checkOutDate` are nullable (`schema.ts`) and nothing enforces gapless Stay
  coverage across a trip's nights. A gap (e.g. checked out of Hotel A day 3, doesn't check into
  Hotel B until day 5) leaves `lodgingOnNight()` returning `null` for the uncovered nights, so
  `optimizer.ts` silently falls back to an unanchored heuristic ordering for that day — no
  reachability check, no surfaced warning. **Decision: this is a data-completeness problem, not
  an optimizer/objective problem** — optimization can only ever operate on top of knowing where a
  day actually starts/ends, so the fix belongs upstream (trip creation / lodging-editing flow
  validation), not inside `solve()`'s objective. Tracked here so it isn't lost; not designed or
  scheduled.
- **A second, stronger solver (VRPTW/OR-Tools)** — ADR-0003 explicitly defers this past building
  the interface. Out of scope until the interface exists and earns a reason to add one.

### Future "improve the optimizer" work is two distinct kinds (surfaced in the O1–O3 grill, 2026-07-05)

Every idea for making trip plans better that came up while scoping O1–O3 falls into one of two
categories, kept separate because they carry different evidentiary weight:

- **A — Improve the existing heuristic.** A change to the current clustering/sequencing algorithm
  that keeps the same overall approach: e.g. the O2 travel-cost provider gaining real per-mode
  speeds (walking vs. driving vs. transit) instead of one fixed constant, or the clustering step
  someday using real travel time instead of straight-line distance. These are incremental —
  reasoned about and reviewed like any other code change, using the same objective functions
  (`objective.ts`) already in place to judge whether an output actually got better.
- **B — Build and compare an alternative solver.** A structurally different algorithm (e.g. a
  VRPTW/OR-Tools solver) implemented as a second `solve()` (O3) besides the default. Unlike A,
  whether a category-B solver is actually *better* is **not verifiable a priori** — ADR-0001's
  ranked, soft objective doesn't reduce to a single formula you can reason about abstractly. It has
  to be built, run against real trips, and compared against the default solver's actual output
  before being trusted or adopted as the new default. A category-B proposal is a *research task*,
  not a normal code review.

Neither category is scheduled or in scope for O1–O3. This split is recorded so a future "should we
improve the optimizer" conversation starts here instead of re-litigating it: a category-A change
can be proposed and reviewed as an ordinary quality improvement; a category-B change requires an
experiment/comparison step first, not just a diff.

---

## Where we're going

Not yet decided — first decision needed is sequencing (one PR vs. stacked slices) and how thin
the first cut can be. A reasonable default shape, subject to revision once actually scoped:

| # | Slice | Scope |
|---|---|---|
| **O1** ✅ | **Objective module** | Extract ADR-0001's penalties (window, category-balance, day-budget) out of `nearestCentroidIndex`/`windowPenaltyKm`/`routeWindowPenalty` into one named, directly-testable module. No behavior change — same weights, same output — this is a pure extraction. **Done** — see status log. |
| **O2** | **Travel-cost provider** | Wrap `haversine` + `AVG_SPEED_KM_PER_MIN` behind an **async** `cost`/`costMatrix(mode)` (ADR-0004's whole point is a future real routing API, which is inherently async — building the interface sync now would force a breaking rework later, exactly when it matters most). Default provider preserves current behavior/numbers exactly — no realism upgrade (e.g. no per-mode speeds) bundled into this slice. **Scope boundaries:** (1) the clustering step's centroid-distance math (`nearestCentroidIndex`/`seedCentroids`) is explicitly *not* part of this — a centroid is a synthetic averaged point, not a real place, so it stays on plain `haversine`, untouched, forever; only real Location-to-Location queries (sequencing + the window-penalty arrival simulation) go through the provider. (2) The sequencing algorithms (`sequenceDay`, `nearestNeighborOrder`, `twoOpt`) must fetch each day's full pairwise distances via one upfront `costMatrix()` batch call, not `cost()` one pair at a time inside their loops — the ad hoc-per-pair shape is exactly the N² live-network-call problem ADR-0004's matrix form exists to prevent, and it's cheaper to build correctly now than to fix once a real provider exists. (3) Async propagates: this slice must also update `objective.ts`'s `routeWindowPenalty` (its `travelMins` callback becomes `Promise`-returning), `optimizer.ts`'s sequencing functions, `optimize.ts`'s `optimizeTrip`, the `/api/trips/[id]/optimize` route, and `optimizer.test.ts` — **all in the same pass**, since a partial ripple wouldn't compile/run. |
| **O3** | **Solver interface** | Define `OptimizationProblem`/`Itinerary` types; wrap the existing two-phase heuristic as the default `solve()` implementation (now async, inherited from O2). **Thin only:** no solver-registry or config-selection mechanism — there is exactly one implementation, so building a way to choose between solvers is speculative until a second one actually exists. `optimize.ts` assembles the problem from `TripWithDetails` and calls `solve()` instead of `optimizeItinerary()` directly. **Per ADR-0016:** the whole-itinerary comparator this slice introduces must compare feasibility violations *before* ever comparing travel cost — two lexicographic tiers, not one flattened weighted sum (the greedy per-stop/per-swap costs already inside `kMeans`/`twoOpt` stay approximate signals guiding construction; only the final comparator needs the real guarantee). |

This is a guess at slicing, not a locked plan — revisit if building O2 surfaces something new.

## Decisions needed

- **Sequencing:** stacked PRs (O1→O3) vs. one PR. The ADR-0015 rebuild used stacked layers
  because the model didn't fully run mid-stack; O1 stayed a pure extraction with zero ripple, but
  O2 is no longer that shape (see above — it changes public signatures end-to-end). Worth a fresh
  call on whether O2 alone warrants being its own PR before O3.
- **Scope of "default solver" (O3).** ADR-0003 says the default solver is "the current heuristic,
  reframed" — confirmed: no algorithmic change is in scope for O1–O3 (a pure interface extraction
  plus the async rewiring O2 requires), with quality improvements deliberately deferred — see the
  category A/B split above.

## Status log

- 2026-07-05 — Doc created. Gap audited against ADR-0001/0003/0004/0005 and current
  `optimizer.ts`/`optimize.ts`. No code changed.
- 2026-07-05 — **O1 done.** Extracted `src/lib/objective.ts`: `windowPenaltyKm`,
  `routeWindowPenalty`, `dayBudgetPenaltyKm`, `categoryBalancePenaltyKm` plus their constants,
  pulled out of `nearestCentroidIndex`/`twoOpt`/`nearestNeighborOrder`. Pure extraction, zero
  behavior change — `routeWindowPenalty` now takes travel time as an injected `travelMins`
  callback rather than computing it inline, so the objective module stays uncoupled from ADR-0004
  (the travel-cost provider O2 will introduce); `optimizer.ts` supplies today's haversine-based
  callback. Verified: `tsc` clean, `npm test` all green (unchanged assertions), `knip` clean.
- 2026-07-05 — **O1–O3 grilled** (`/grill-with-docs`) against ADR-0001/0003/0004/0005/0015 before
  starting O2. No changes needed to O1's already-committed code — its primitives
  (`windowPenaltyKm`, `routeWindowPenalty`, `dayBudgetPenaltyKm`, `categoryBalancePenaltyKm`) are
  confirmed durable atoms that O3's future composed itinerary-scorer will call, not replace.
  Decisions locked for O2/O3: async provider interface; clustering's centroid distance stays out
  of the provider entirely; sequencing batches distances via `costMatrix` upfront rather than
  ad hoc `cost()` calls in loops; O2 absorbs its full async ripple (objective.ts, optimizer.ts,
  optimize.ts, the API route, tests) in one pass; O3 stays thin — no solver-selection mechanism
  until a second solver actually exists. Also locked: future optimizer-quality ideas split into
  category A (improve the existing heuristic — ordinary code review) vs. category B (an
  alternative solver — requires build-and-compare, not verifiable a priori).
- 2026-07-05 — **Scrutinized the four O1 primitives against ADR-0001 directly**, at the user's
  request, before continuing to O2. Found: (1) `windowPenaltyKm`/`routeWindowPenalty` are one
  rule + its reducer, not two independent criteria; (2) `categoryBalancePenaltyKm` only
  approximates variety (penalizes exceeding an "ideal" per-day share, doesn't guarantee spread);
  (3) the real issue — feasibility was being treated as "a big weight in one sum," conflating
  feasibility (a gate defining the candidate set) with optimization (a search over that set) —
  which can't structurally guarantee ADR-0001's "never trade a closed-hours violation for a
  shorter route" rule. Resolved by **ADR-0016**: authoritative objective narrows to
  feasibility-then-travel as two lexicographic tiers; category/variety balance removed from the
  objective entirely, deferred to a later advisory suggestions feature.
- 2026-07-05 — **Category balance removed end-to-end**, per ADR-0016. Deleted
  `categoryBalancePenaltyKm`/`CATEGORY_BALANCE_KM` (`objective.ts`); removed the `categories`
  field from `LocationInput` and the `dayCategoryCounts`/`idealCategoryCounts` machinery from
  `kMeans`/`nearestCentroidIndex` (`optimizer.ts`); removed the `balanceCategories` option
  end-to-end (`optimize.ts`, the `/api/trips/[id]/optimize` route, `tripStore.ts`'s `optimize()`
  signature, and the `OptimizeModal` UI checkbox) rather than leave a now-dead toggle in the UI.
  `dayBudgetPenaltyKm` stays — reconfirmed as feasibility-tier (ADR-0001 already placed "day
  overstuffed" under criterion #1) — still needs restructuring into a true gate in O3, not done
  here. Verified: `tsc` clean, `npm test` all green, `knip` clean. Next: build O2.
