# ADR-0018: Transit cost — time-of-day policy and provider shape

- **Status:** Accepted
- **Date:** 2026-07-07
- **Supersedes:** —
- **Superseded by:** — (superseded-in-part — see ADR-0019 for the Japan regional
  provider that fires §5's contingent-enhancement clause and generalizes provider
  selection into a registry)
- **Amends:** ADR-0004 (provider interface gains `departureTime` and `describeLeg`),
  ADR-0011 (resolves its deferred time-of-day complexity; demotes regional providers
  to contingent enhancements)
- **Constrained by:** ADR-0016 (objective stays feasibility ≫ travel), ADR-0017
  (surface degradation, don't discard it)
- **Note:** Decided in the 2026-07-07 grilling session, informed by
  `docs/japantravel-agent-transcript.md` (behavioral evidence of a transit API's
  contract shape, not authoritative documentation).

## Context

ADR-0011 deferred a known complexity: transit duration is time-of-day dependent, and
"the provider may need the simulated departure time as input." Taken literally this is
unimplementable: the O2 architecture fetches **one** `costMatrix` upfront and reads it
synchronously inside sequencing's inner loops (`nearestNeighborOrder`/`twoOpt`
evaluate thousands of candidate orderings), but a candidate ordering *determines* the
departure times, and with transit the departure time determines the cost — a circular
dependency. Per-pair provider calls inside the inner loop are impossible (latency,
rate limits, cost). So the deferral must be resolved as an **approximation policy**,
not a literal input.

Two distinct time-dependencies must not be conflated:

1. **Time-dependent feasibility (opening hours)** — already simulated *exactly*:
   `routeWindowPenalty` walks the clock stop-by-stop during sequencing, and
   `evaluateDayFeasibility` re-simulates it in `solve()`'s violation pass.
2. **Time-dependent travel cost (transit schedules)** — the new thing. Only here is
   approximation proposed: the simulated clock stays exact; only the travel-time
   *inputs* to that clock are approximate.

Separately, a transit journey has display-worthy structure (line names, transfer
count) that a bare `{ distanceMeters, durationSeconds }` cannot carry, and ADR-0011's
per-leg directions affordance needs it.

## Decision

### 1. Representative-time matrix; exact clock; no time buckets

`costMatrix` gains an optional **`departureTime`** (an **absolute datetime** —
timetables differ by calendar date: weekday/weekend/holiday). The solver fetches
**one matrix per trip**, at a representative datetime (first full trip day at
`dayStartMins`). Providers may ignore it (haversine does). Sequencing tolerates
time-of-day duration noise; feasibility simulation continues to use exact clocks fed
by these approximate durations. Schedule-*constraint* edge cases (last trains,
infrequent lines) are a feasibility concern; an exact schedule-aware re-simulation of
the final route can later slot into `solve()`'s existing violation pass, using
`describeLeg` (below) per final leg. Time-bucketed matrices are rejected outright.

`OptimizationProblem` gains the trip's **start date** — also correcting an existing
gap against the domain model (a Trip has a *required date range*; the problem
previously carried only `numDays`).

### 2. Transit detail is display-only, via a separate lazy `describeLeg`

The optimizer's objective does not see transfers. Duration already prices the *time*
cost of transferring; a penalty beyond that prices *annoyance*, which has no ground
truth — the same species of unverifiable preference ADR-0016 ejected (category
balance). Transit stays purely "a cost" to tier-1 optimization (ADR-0011).

Line names and transfer counts are served by a new provider method,
**`describeLeg(from, to, mode, departureTime)`**, returning
`{ durationSeconds, transferCount?, lineNames?[] }` — called lazily, only for the
final plan's legs (N−1 per day), at display time. `costMatrix` stays lean; this also
matches real APIs, which split matrix endpoints (durations only, priced per element)
from directions endpoints (full journey detail).

**Deferred, not dropped — two-tier refinement:** preference-grade optimization
(e.g. transfer-aversion) may later run as a second, intra-day tier refining the
already-fixed day assignment, consuming `describeLeg` data. Whether that tier is
authoritative (reorders the plan — requires amending ADR-0016 with a third
lexicographic tier) or advisory (ADR-0016's suggestions feature), and how much tier-1
travel cost it may spend, are ungrilled category-B questions (build-and-compare, per
`docs/optimizer-rebuild.md`).

### 3. Mode-mixing is the provider's job

`transit` mode is defined as the **composite door-to-door journey**: walk to the
station, ride, walk from the station — walking-only when that's fastest. This is what
mature transit APIs natively compute; the solver stays one-matrix-one-mode and builds
no min-of-modes logic. The only downstream consequence is that `DEFAULT_MODE`
eventually becomes per-trip configuration rather than a constant.

### 4. Provider failure fails loudly

A network-backed provider failure (outage, rate limit) errors the optimize run — it
strikes at the single upfront fetch, before sequencing. **Silent fallback to haversine
is ruled out permanently**: it produces confident-looking wrong output, the failure
mode ADR-0017 exists to prevent. Explicit fallback (degrade to haversine and stamp the
`Itinerary` as cost-approximated) is the designed evolution if provider flakiness ever
actually blocks work — additive, no interface break.

### 5. Google Routes first; regional providers are contingent enhancements

The first real provider is **Google Routes API**: its matrix endpoint supports transit
with `departureTime` (→ `costMatrix`), its directions endpoint returns line/transfer
detail (→ `describeLeg`), and it accepts the Google `placeId`s every committed
Location already carries (ADR-0009) — no POI-resolution step. Google's Japan transit
coverage is historically strong; a region-specific provider (e.g. NAVITIME-based) is
built **only if a gap assessment demands it** — spot-checking Google's answers for the
actual trip's legs against a region-specific source. Until then, the
regional-precedence mechanism (ADR-0011's "declare where they apply" contract) stays
undesigned; haversine-vs-Google is plain config per ADR-0004.

## Alternatives considered

- **Exact time-dependent cost in the inner loop.** Rejected: circular (ordering ↔
  departure times) and architecturally impossible against a batched upfront matrix;
  per-pair network calls in a 2-opt loop are absurd on latency and cost.
- **Time-bucketed matrices (morning/midday/evening).** Rejected: multiplies API cost
  for sequencing-quality gains that don't materialize where headways are short (urban
  Japan: 3–6 min), while *not* solving the real edge cases (last trains), which are
  feasibility-shaped and belong in the violation pass.
- **Per-day matrix fetches.** Rejected for now: weekday/weekend duration variance is
  second-order for urban transit; the interface carries a full datetime, so moving to
  per-day later is a solver-internal change, not a contract change.
- **`transferCount` as an objective term.** Rejected: re-litigates ADR-0016 by
  smuggling an unverifiable preference back into the authoritative objective as a
  return field. If evidence shows the optimizer choosing transfer-heavy routes a human
  never would, that goes through the front door as an ADR-0016 amendment.
- **Fat `TravelCost` (optional transit fields on the matrix result).** Rejected:
  burdens N×N elements with data only N−1 displayed legs need, and matrix endpoints
  can't cheaply supply it anyway.
- **App-side min-of-modes (fetch walking + transit, take per-pair min).** Rejected:
  doubles matrix cost and reimplements, worse, a decision the provider already makes
  with actual schedule knowledge.
- **Silent haversine fallback on provider failure.** Rejected permanently (see above).
- **Building the NAVITIME provider and regional-precedence registry now.** Rejected:
  machinery before evidence; Google may simply suffice.

## Consequences

- `TravelCostProvider` grows: `costMatrix(points, mode, opts?: { departureTime })`
  and `describeLeg(from, to, mode, departureTime)`. Haversine implements both
  trivially (ignores time; `describeLeg` returns duration only).
- `OptimizationProblem` gains `startDate`; the solver derives the representative
  departure datetime from it.
- A **Leg** becomes domain vocabulary: the travel segment between consecutive
  Placements (or anchor → Placement) within a Day (see `CONTEXT.md`).
- The directions affordance (ADR-0011's handoff) gets its summary line from
  `describeLeg` and its deep-link built client-side; deep-link construction needs no
  provider.
- Bills that come due later: the exact schedule-aware violation re-check (slot exists,
  not built); explicit-fallback stamping if provider flakiness bites; the two-tier
  preference grill; the gap assessment before any regional provider work; per-trip
  mode configuration replacing `DEFAULT_MODE`.
- ADR-0011's POI-resolution open question narrows to conditional: it applies only if
  a regional provider is ever actually built.
