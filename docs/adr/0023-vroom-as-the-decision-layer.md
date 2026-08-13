# ADR-0023: VROOM is the Decision layer; the objective is the solver's, not ours

- **Status:** Accepted
- **Date:** 2026-08-07
- **Supersedes:** —
- **Superseded by:** —
- **Amends:** ADR-0003 (fires its own "a stronger solver may be introduced later" clause — the
  default solver is replaced, the `solve()` seam is not; the shared objective module is **deleted**
  rather than reimplemented), ADR-0016 (its two-tier lexicographic objective is subsumed by VROOM's
  fixed comparator; feasibility stops being a scored gate and becomes hard admission), ADR-0017
  (`feasibilityViolations` is deleted from the solve; the violation story returns through a second
  plan-mode pass), ADR-0020 (the eligible-day mask machinery is deleted; its coverage half survives
  as a pre-flight exclusion)
- **Constrained by:** ADR-0001 (what makes an itinerary good), ADR-0005 (trip topology — lodging
  anchors), ADR-0015 (Locations typed by kind; the plan is Placements)
- **Depends on:** ADR-0024 (the Facts layer that materializes the matrix VROOM consumes)
- **Note:** Decided across the 2026-08-06 and 2026-08-07 design sessions. Backed by
  `docs/research/vroom-v2-alignment.md`, which is cited to VROOM's own source rather than its
  documentation. The 2026-08-07 session stress-tested this against a hierarchical-clustering
  alternative and an adversarial defense of two-phase architectures; both are recorded under
  *Alternatives considered* because the reasoning that rejected them is the reasoning that
  constrains what may be added later.

## Context

ADR-0003 put optimization behind `solve(problem): Itinerary` and named the reason: "Optimization is
the riskiest, most-likely-to-change part of the app." It kept the two-phase heuristic as the
*default* solver, explicitly bounded and swappable, and wrote down the exit: "A stronger solver
(unified VRPTW, OR-Tools, etc.) may be introduced later as a new implementation of the same
interface, selected by config — no caller changes." This ADR takes that exit.

What we have is a hand-rolled approximation of a named, well-studied problem. `optimizer.ts`
clusters into days by k-means, orders within each day by nearest-neighbour plus 2-opt, then
evaluates feasibility *after the fact*. The two phases cannot talk: clustering assigns
geographically with no clock, sequencing discovers the day does not fit, and there is no path back.
Time windows enter as `windowPenaltyKm` — a km-equivalent fudge factor standing in for a constraint.
`hoursJson` is populated by enrichment on every Location and read by nothing, because the objective
can express one flat `openTime`/`closeTime` and cannot say "closed Tuesdays" at all.

The problem has a name: multi-depot heterogeneous vehicle routing with time windows. VROOM
(BSD-2-Clause, distributed as a container) lists **MDHVRPTW** among its problem types. One vehicle
per trip-day, `start`/`end` = the lodging you woke and slept at, `time_window` = that day's hours,
and the shape fits without contortion. Trip scale is 10–60 Locations over 3–14 days — small enough
that a mature solver returns in well under a second.

Reconnaissance established the swap is safe at the seam. The UI's entire contract with the optimizer
is `placements[{locationId, date, order}]` plus `locations`, projected by `deriveDays`.
`feasibilityViolations` is discarded by `tripStore.optimize` before anything reads it, `unplaced` is
destructured away at the API route, and no per-stop timing is displayed anywhere.

**This is a surgical cut, not only a solver swap.** Features whose complexity outgrew the foundation
come out with it. Regression is intended where what remains is simpler and can be rebuilt better.

## Decision

### 1. One solve for the whole trip; a trip-day is a vehicle

`solve()` (ADR-0003) survives unchanged as the seam. Behind it, the whole trip becomes **one VROOM
instance**: one `job` per placeable activity, one `vehicle` per trip-day with `id` = the 1-based day
number, and `start_index`/`end_index` from ADR-0005's existing anchor derivation
(`lodgingOnNight(d-1)` / `lodgingOnNight(d)`).

**Assignment and sequencing are decided together, by one search.** This is the load-bearing property
and the reason the whole ADR exists. "Day 2 does not fit" is not a dead end reached after
assignment; it is a move the local search makes and reverses. A travel day — wake at one lodging,
sleep at another — is an open path with `start ≠ end`, which VROOM models natively and our clusterer
could only approximate.

Day 1's start and the last day's end remain available as the trip-edge override ADR-0005 §54
described; under this shape it is setting two fields rather than a distinct code path.

### 2. The objective is VROOM's, it is fixed, and `objective.ts` is deleted

VROOM's comparator is lexicographic and not configurable through the API. Its tiers are: `priority_sum`,
then assigned task count, then cost (travel seconds by default), then number of vehicles used.

ADR-0016 asked for exactly this structure — "feasibility ≫ travel, compared lexicographically, not
summed" — and implemented it as km-equivalent penalties because nothing better was available. Under
VROOM, **feasibility stops being scored at all**: time windows are a hard admission test run before
the search and enforced throughout. A stop that cannot fit is not a worse solution, it is an
unassigned stop.

So `objective.ts` is deleted outright rather than reimplemented. There is no shared objective module
any more, because there is nothing left for it to do — a consequence ADR-0003 did not anticipate and
that is recorded here so a future reader does not go looking for it.

ADR-0016's removal of category balance from the authoritative objective **stands and is
strengthened**: VROOM has no balance term either.

### 3. Time windows are hard, and `hoursJson` finally becomes readable

A job's `time_windows` is the cross-product of trip dates × the weekday hours already stored in
`hoursJson`. A Tuesday-closed museum on a ten-day trip gets nine windows, none on a Tuesday.

The rules, in order: an absent weekday key means **closed that day, so emit no window** — the
capability `openTime`/`closeTime` could not express at all, and the single strongest argument that
VROOM subsumes `objective.ts`; `close === null` means open to day end; **`close <= open` clamps to
day end**, because `extractWeeklyHours` flattens an overnight period (18:00→02:00) into a backwards
window that VROOM rejects as an input error; no `hoursJson` but `openTime`/`closeTime` applies that
pair to every day; neither means omit the key entirely.

A Location closed on every trip date would produce a job with an empty window array. Such a job
**must not be emitted at all** — it becomes a pre-flight exclusion (§7).

### 4. Semantic constraints are expressed in VROOM's vocabulary, never as distance penalties

Rules about what makes a *good day* — no two dinners, breakfast before 10:30, at most one demanding
activity — are expressed as VROOM constraints, not folded into a distance metric and not resolved by
a clustering pre-pass:

| Rule | Mechanism |
| --- | --- |
| At most one dinner per day | A `capacity` dimension on the day-vehicle; the job carries a matching `delivery` amount. Dimensions are integer arrays of arbitrary arity, so meal types and "demanding" get their own axes. |
| Meal-time preferences | Intersect the category window with the opening-hours window when building `time_windows`. |
| At most N stops per day | `vehicle.max_tasks`. |
| Metro eligibility, if needed | `job.skills ⊆ vehicle.skills` (§6). |

**Every one of these is hard.** An over-tight constraint does not produce a worse-but-valid plan; it
produces unassigned stops. They are therefore **added one at a time, each with a measured
unassignment cost**, starting generous. A constraint that costs five placed stops to enforce a
preference is a bad trade, and only measurement identifies which those are.

The category a rule keys off is an **attribute on an Activity, not a new Location `kind`**. A
restaurant is an activity you eat at. Adding union members would put new arms on every exhaustive
switch in the codebase to serve constraints that never read the arm, and would contradict ADR-0015's
three-kind model. The same attribute is what will later seed `visitDuration` by category — the
rebuild path for the `DEFAULT_VISIT_MINS` constant this work deletes.

### 5. `priority` is used, in a narrow band

VROOM's `priority` is an integer in `[0, 100]` and `priority_sum` sits in a tier **above** assigned
count. One job at `priority: 100` therefore outscores fifty at `0` — a plan that keeps one must-see
and drops everything else wins.

That is an argument about magnitude, not about the concept. Must-see versus ordinary is a real
distinction a traveler holds, and `priority` is exactly the field for it. We use a **narrow band —
`0` / `1` / `2`** — so that a single elevated stop can never outweigh a meaningful number of ordinary
ones. Where the comparator actually flips is measured by prototype A, not assumed.

### 6. Day balance has no solver-side answer, so it has an escalation ladder

VROOM's fourth tier **minimizes the number of vehicles used**, and its third tier independently
rewards emptying a day, because each used day pays a lodging→first-stop and last-stop→lodging leg
that an empty day does not. For a delivery fleet that is correct. For a holiday it is backwards, and
there is no VROOM-side fix.

The response is a ladder, climbed only as far as measurement requires:

| Rung | Mechanism | Gives up |
| --- | --- | --- |
| 0 | Honest `vehicle.time_window` + real `service` durations | nothing |
| 1 | `vehicle.max_tasks` = `ceil(placeable / days) + slack` | nothing |
| 2 | `job.skills` ⊆ `vehicle.skills` — ADR-0020's metro masks, re-derived | nothing |
| 3 | Clustering *seeds* the skill sets; VROOM still chooses within them | nothing structural |
| 4 | Clustering *fixes* the day assignment | **the single solve** |

Rung 0 is the principled one and ships as the default. **Prototype A picks the rung**, and must run
before any translator code is written. Rung 4 is recorded as a designed fallback rather than a
panic — but taking it reintroduces the information asymmetry this ADR exists to remove, so it is
taken only on evidence.

**`costs.fixed` is forbidden as a balance lever.** It biases toward *fewer* used vehicles — the wrong
direction — and reads as a plausible fix, which is why it is named here.

### 7. Exclusions are decided before the request, with reasons VROOM could not give

`unassigned[]` carries `{id, type}` and never says why. Three exclusions are therefore computed
ourselves, before the request is built, each with a specific reason:

- no coordinates yet → *"Not yet geocoded."*
- metro with no covering lodging → ADR-0020's existing string, from `clusterByMetro` **unchanged**
- closed on every trip date → *"Closed on every day of the trip."*

ADR-0020's coverage half therefore **survives**; only its mask plumbing is deleted. Ungeocoded
activities entering the Unassigned tray rather than being sprayed round-robin across days is a
deliberate behaviour change: today they are placed without ever being routed, which is a fiction.

### 8. Violations return as a second, optional plan-mode pass

ADR-0017 required `solve()` to carry its feasibility outcome rather than discard it. Under hard time
windows that outcome is structurally empty — an assigned stop *cannot* violate its hours, because
VROOM refuses to schedule it — and VROOM's own documentation says violations in regular optimization
mode are "guaranteed to be void."

So `FeasibilityViolation` and `Itinerary.feasibilityViolations` are **deleted rather than kept
empty**, and ADR-0017's intent is served differently: a second call in **plan mode**, feeding the
solved routes back as `vehicle.steps`. Plan mode softens every constraint and reports
`violations[{cause, duration}]` per step in real seconds.

This is one extra sub-second call and it returns strictly richer data than the field being deleted —
minutes late rather than a km-equivalent penalty, with a cause. It is what makes §4's hard
constraints safe to add: without it, a stack of hard constraints produces a pile of unassigned stops
with no explanation, which reads to a user as failure even when the solver behaved correctly.

### 9. What this deletes

`optimizer.ts` (581 lines) except its anchor derivation, which moves into the request builder;
`objective.ts` (80 lines) entirely, `DEFAULT_VISIT_MINS` with it; `DistanceLookup` and
`buildDistanceLookup`; ADR-0020's `eligibleDaysOf` and mask plumbing; `FeasibilityViolation`;
`EdgeAnchors`; `DayPlan.startAnchor`; and `docs/agents/optimizer-rebuild.md`, a planning tracker for
the gap this ADR closes.

`service = visitDuration ?? 0` replaces `DEFAULT_VISIT_MINS = 60`. The constant was an invented
number; under a hard day window it would consume real time we have no evidence is needed, shrinking
plans against today's behaviour. Inventing nothing is the honest default, and enrichment seeding
duration from category is the real fix.

> ### Amended 2026-08-07 — Prototype A's findings settle §5/§6, correct §6, and add a §8 note
>
> Prototype A ran (throwaway, `prototype/vroom-day-balance-a`, never merged; findings in
> `docs/research/vroom-day-balance-a.md`). It settles the two sections this ADR named as gated and
> revises §6's own guidance in one place.
>
> **§6's ladder is confirmed, but rung 1 and rung 2 are not independent alternatives — the
> practical destination is both together.** On a 41-activity, 10-day, two-metro fixture, rung 1
> alone (`max_tasks`) balances perfectly (CoV 0.11–0.16, zero empty days) but leaves 6–8 cross-metro
> leaks — a fifth of jobs landing on the wrong metro's day. Rung 2 alone (`skills`) eliminates
> leakage completely but does nothing for balance, because skills restrict *which* vehicle a job may
> go to, not *how many* jobs pile onto the vehicles it's allowed to use. Combined, both defects
> resolve simultaneously (max 4/day, 0 leaks, 1 empty day of 10) at a measured, bounded cost (7.9%
> structurally unassigned — see below), holding identically across every `visitDuration` coverage
> level tested. The rung ladder should be read as "climb until §1's problem (balance) *and* §7's
> problem (leakage) both resolve," not as a single rung selected in isolation.
>
> **§6's `max_tasks` slack guidance is corrected: slack itself is the balance-quality knob, and
> zero slack measurably outperforms any nonzero slack tested** (CoV 0.11–0.16 at slack 0; 0.52 at
> slack 1; 0.67–0.72 at slack 2, with empty days reappearing at both). `max_tasks = ceil(placeable /
> days) + slack` should default to slack 0, not a cushioned value.
>
> **A real interaction between §4 and §6 surfaced, not previously named.** Metro `skills` (§6) can
> structurally exclude every instance of an archetype whose §4 semantic hours partition disjointly
> from the metro-day partition — e.g. a weekend-only activity in a metro whose only lodging-covered
> weekend falls entirely inside a different metro's leg. This is not a duration-data or
> coverage-sizing artifact (confirmed: the same jobs dropped at every `visitDuration` coverage level
> from 0% to 100%); it is structural to combining a per-day metro mask with weekday-scoped hours.
> Worth checking for once real category-based hours (#153/#154) replace invented test data, not
> assumed away.
>
> **§8 gains a deployment constraint.** Plan mode (`-c`) requires a glpk-linked VROOM build; the
> reference Homebrew formula (`brew install vroom`, v1.15.0) is compiled **without** libglpk and
> cannot run `-c` at all (`"VROOM compiled without libglpk installed."`, a compile-time condition,
> not a missing runtime library). The prototype validated §8's mechanism and its "violations are
> void under hard time windows" claim directly against a real solve, but only after building
> `vroom-docker` from source pinned to `v1.15.0`. Whatever ships to production needs an explicitly
> glpk-enabled build — PR 2's infrastructure work should name this rather than assume the reference
> formula suffices.
>
> **§5's `0/1/2` priority banding is not contradicted, but remains unvalidated by measurement.** The
> prototype's fixture had too much slack relative to demand (`max_tasks` × days exceeded assignable
> jobs by enough margin) for the comparator's `priority_sum` tier to ever need to trade a job away —
> no flip point was observed at any band from `1` to `100`. §5's choice still stands on the a priori
> magnitude argument; it has not yet been confirmed or refuted by a fixture with real capacity
> pressure.

> ### Amended 2026-08-12 — §7 exclusions must remove a Location from the matrix, not just from `jobs`;
> a fourth reason is recorded but deferred
>
> Diagnosing a live optimize failure (`ROUTE_NOT_FOUND` on a Location whose coordinates had been
> mis-resolved to another continent by an unrelated enrichment defect, now fixed) forced a precise
> answer to a question §7 left implicit: does a pre-flight exclusion remove a Location from the travel
> matrix, or only from the `jobs` VROOM is asked to place?
>
> **It must remove from both.** The Location in question was already excludable under §7's existing
> second reason — "metro with no covering lodging" — verified against the live data: it formed its own
> single-activity metro cluster with zero covering lodgings, exactly what `clusterByMetro` (ADR-0020,
> unchanged) already detects. But removing it from `jobs` alone while leaving it in the matrix would
> still ask every registry provider to answer for it, including metered ones — paying for, and
> potentially failing on, a cell whose Location was never going anywhere. Excluding a Location must
> mean it never reaches `buildTravelMatrix` at all, matching how ADR-0024 §4's composer already
> subsets points to bound a metered provider's exposure.
>
> **A fourth exclusion reason — "too far from the rest of the trip for any provider to route to" — is
> recorded here but deliberately not built.** The triggering case this ADR-0018-adjacent investigation
> turned up turned out to already be reason two (above): a metro-coverage gap, not a routability gap.
> No Location in real use has yet demonstrated a case reason two misses — inside a metro with covering
> lodging, but which no non-terminal registry provider can answer for, so the cell falls through to
> `haversine`'s terminal, distance-uncapped straight line. Building a detector for a hypothesis with no
> demonstrated instance trades simplicity for speculation. **The condition that should trigger building
> it:** the first real Location, inside an otherwise-covered metro, whose matrix cells resolve to
> `basisOfCost: straightLine` from every provider but the terminal one. Until then, `haversine`'s
> uncapped straight line is a known, accepted rough edge (see also #162 on its speed model being wrong
> in both directions), not a silent one — every such cell is visibly stamped, not hidden.
>
> This does not change what `googleRoutesProvider` does with a cell it *is* asked to answer — see
> ADR-0018's 2026-08-12 amendment, decided alongside this one, for why it declines rather than throws
> on "no route." The two are complementary: §7 stops a hopeless cell from ever being asked; the
> provider's decline is the safety net for the cells that still reach it.

## Alternatives considered

- **Keep the two-phase heuristic and improve it.** Rejected: the defect is structural, not a tuning
  problem. Clustering commits the day assignment before anything with a clock has run, and no
  improvement to the clusterer creates a path back.
- **Cluster first with a better clusterer — hierarchical agglomerative clustering over a semantic
  dissimilarity matrix, then route each day independently.** A serious proposal, and it correctly
  identified that our objective is under-specified: pure travel-time minimization has no vocabulary
  for "two dinners on one day." Rejected because the remedy reintroduces the original defect. Folding
  semantic rules into a distance number (`+50 km` for a second dinner, `×0.5` for temporal harmony)
  compiles constraints *down* into a metric that cannot represent them, and freezes the assignment
  before scheduling. Nearly every rule it encoded maps onto a VROOM constraint **exactly** rather
  than approximately (§4) — and the ones that do not, such as the temporal-harmony discount, exist
  only to make a clusterer with no clock behave as though it had one. Its one genuine advantage —
  halting at exactly N clusters guarantees N non-empty days — survives as rung 4 of §6's ladder.
- **An iterative arbitrator: cluster, solve each day in parallel, eject overflow into the next day's
  bucket, repeat.** Offered as the compromise between the two. Rejected: "eject a stop from day 1
  into day 2 and re-solve" is `relocate`; swapping stops between days is `exchange`; moving a run is
  `or_opt`. VROOM ships those plus `cross_exchange`, `swap_star`, `route_split`,
  `unassigned_exchange` and `priority_replace`. The loop is a reimplementation of the solver's inner
  search in application code, with no acceptance criterion, no cycle detection and no termination
  proof — and being greedy, it cannot accept a temporarily worse move, which is the local optimum a
  metaheuristic exists to escape. Its motivating instinct was right and is served by §8 instead.
- **Decomposing by day to bound matrix size and API cost.** Rejected on the facts. VROOM has no
  time-dependent matrices and OSRM has no traffic model, so there are no per-time-slice matrices to
  fetch either way; and clustering cannot shrink the fetch, because every pairwise distance is needed
  *to cluster at all*. At 60 Locations the matrix is 3,600 cells — one call to a container we host,
  with nothing metered on the routing path (ADR-0024).
- **OR-Tools instead of VROOM.** Rejected as more machinery for the same answer: OR-Tools is a
  toolkit requiring us to model the problem, VROOM is a service that already has. VROOM ships a
  container and speaks one JSON POST. Revisit only if a constraint proves inexpressible.
- **`costs.fixed` to encourage using every day.** Rejected — it pushes toward *fewer* used vehicles.
  Recorded in §6 because it looks like the obvious lever and is not.
- **A wide `priority` spread (0 / 50 / 100).** Rejected: `priority_sum` outranks assigned count, so a
  wide band buys "the must-see survives" at the price of plans that keep almost nothing else.
- **Accepting `unassigned[]` as the entire violation story.** Rejected in favour of §8's second pass.
  It is one extra sub-second call for a strictly better answer, and without it hard constraints have
  no diagnostic at all.

## Consequences

- **`dayBudgetHours` changes meaning** — from "hours of visiting" to "length of the day, including
  travel and waiting." `OptimizeModal`'s copy ("Only applies when locations have durations set")
  becomes false and must be edited.
- **There is no "no budget" option any more.** `DEFAULT_DAY_BUDGET_MINUTES` is load-bearing:
  `optimizeTrip(tripId)` with no options is a real call path, and VROOM's default window is
  `[0, 2^32-1]`, so an unbounded day lets tier 4 cram the whole trip onto day 1.
- **`solve()` gains an infrastructure dependency.** An unconfigured machine must fail with a clear
  error rather than silently producing a straight-line plan.
- **`solver.ts` now owns `LocationInput`/`StayPlan`/`DayPlan`/`Unplaced`**, rehomed from
  `optimizer.ts` — removing the inversion where the seam imported its shapes from the implementation
  it wraps.
- **Times are absolute Unix seconds** from the trip's day-1 midnight, computed as the codebase
  already does dates. UTC arithmetic stands in for trip-local wall clock — the same fiction
  `addDaysIso` already relies on, and honest because no epoch value reaches a user.
- **`step.arrival` and `step.waiting_time` are carried through** as an optional per-stop array. They
  are free in the response, and re-deriving them later would mean re-solving.
- **Prototype A has run and settled the gate on §5 and §6** — see the 2026-08-07 amendment above and
  `docs/research/vroom-day-balance-a.md`. Translator code (`src/lib/vroom/*`) may now be written
  against rung "1+2" (§6) as the answer; §5's banding remains unvalidated by measurement but is not
  contradicted.
- **A bill comes due on cross-day sequencing.** VROOM's vehicles are unordered — nothing expresses
  "do not put the demanding hike the day after the overnight flight," or "make day 3 lighter." The
  lodging case is covered by per-vehicle anchors; pacing is not, and no alternative considered here
  offers it either. It needs its own ADR when it becomes real.
- **ADR-0020's `unplaced[]` and ADR-0017's violations remain separate**, as ADR-0020 decided — a
  coverage gap has no day number and a different lifecycle from a lateness.
