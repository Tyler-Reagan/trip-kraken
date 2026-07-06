# ADR-0016: Feasibility is a hard gate; category balance is deferred to advisory suggestions

- **Status:** Accepted
- **Date:** 2026-07-05
- **Supersedes:** —
- **Superseded by:** —
- **Amends:** ADR-0001 (narrows criterion #4 "balance," and clarifies criterion #1 "feasible" is
  a gate, not a weighted term in one summed cost)
- **Constrains:** ADR-0003 (the solver interface's itinerary comparator must implement this),
  `src/lib/objective.ts`

## Context

ADR-0001 defines four ranked criteria for "a good itinerary" — feasible ≫ minimizes travel ≫
respects intent ≫ balances — and says the optimizer expresses them "as one comparable cost
(today: km-equivalent penalties)," while the *ranking* is "the contract" any solver must honor.
Intent (locking) was later dropped by ADR-0015.

Scoping the O1–O3 optimizer rebuild (ADR-0003/ADR-0004) surfaced two problems with the existing
implementation of that objective:

1. **Feasibility was only a heavily-weighted additive term**, not a true gate. `windowPenaltyKm`'s
   late-arrival penalty is scaled large enough to *usually* dominate travel cost in a single
   summed score, but a weighted sum cannot structurally guarantee ADR-0001's own stated
   consequence — "a solver may never trade a closed-hours violation for a shorter route." A
   sufficiently large travel saving can, in principle, still outweigh a small lateness penalty in
   a flat sum. Approximating a hard rule via magnitude tuning is not the same as enforcing it.
2. **Category/variety balance has no ground truth.** Feasibility (was this place open?) and travel
   (which route is shorter?) are objectively checkable. "The right mix of categories per day" is
   not — there is no fact of the matter that a 2-2-2 museum/park/restaurant split across three
   days is better than 3-1-2 for a given traveler. Scoring an unverifiable preference inside the
   same authoritative cost as objectively-checkable criteria mismatched their epistemic status,
   and its actual mechanism (penalize exceeding an "ideal" per-day share of each category) is a
   proxy for variety, not a measurement of it.

## Decision

The optimizer's authoritative objective — the thing `solve()` (ADR-0003) is actually minimizing —
narrows to two tiers, **compared lexicographically, not summed**:

1. **Feasibility** — closed-hours violations (`windowPenaltyKm`/`routeWindowPenalty`) and
   day-budget overstuffing (`dayBudgetPenaltyKm`) — evaluated as a hard-dominant gate. Any
   candidate itinerary with a feasibility violation is worse than any candidate without one,
   full stop, regardless of relative travel cost. Only among itineraries tied on feasibility does
   travel cost get compared.
2. **Travel** — distance/duration among feasible candidates, minimized.

**Category/variety balance is removed from the authoritative objective entirely.** It becomes a
deferred, advisory **suggestions** feature: something surfaced to the user as an optional
recommendation (e.g. "day 3 concentrates 4 museums, day 1 has none — consider swapping"), never a
scored factor in what "correctly optimized" means. Its design (data model, UI, whether/how it gets
built) is future work, out of scope here.

The other half of ADR-0001's original balance criterion — "reasonable pace, food and rest woven
in" — remains unaddressed and out of scope for the optimizer itself. It may turn out to be a
candidate-curation concern (whether meal/rest stops exist as candidates at all) rather than a
placement-optimization concern; not decided here.

## Alternatives considered

- **Keep balance in the authoritative objective, just re-weighted.** Rejected: no amount of
  weight-tuning changes that there is no ground truth for "the right" category spread. An
  unverifiable preference doesn't belong scored alongside objectively-checkable criteria at any
  weight.
- **Keep feasibility as a large-weighted additive term (status quo).** Rejected: doesn't
  structurally guarantee ADR-0001's own "never trade a closed-hours violation for a shorter
  route" rule — only a true gate/lexicographic comparison actually honors that rule rather than
  usually satisfying it.
- **Drop category/variety balance from the product entirely.** Rejected: variety across days is
  still something users plausibly care about; demoting it to advisory suggestions preserves that
  value without pretending it's objectively optimizable the way feasibility/travel are.

## Consequences

- `categoryBalancePenaltyKm`/`CATEGORY_BALANCE_KM` removed from `objective.ts`; the
  `balanceCategories` option removed end-to-end (`optimize.ts`, the optimize API route,
  `tripStore`, the `OptimizeModal` UI checkbox). No behavior change relative to today's default
  (the option defaulted to off) — the capability itself is gone until a suggestions feature
  replaces it.
- `dayBudgetPenaltyKm` is confirmed feasibility-tier (ADR-0001 already placed "day overstuffed"
  under criterion #1). Its current implementation is still a soft additive term, not yet a true
  gate — restructuring it to actually behave as one is O3's job (see
  `docs/optimizer-rebuild.md`), not done by this ADR alone.
- O3 (ADR-0003's solver interface, specifically its composed whole-itinerary comparator) must
  implement feasibility-then-travel as two lexicographically compared tiers, not a single
  flattened sum. This is now a requirement of what "the objective" is, not an implementation
  detail left to the solver's discretion.
- A future category/variety **suggestions** feature is real, tracked, deliberately-deferred work —
  noted here so it isn't lost, but not specified. It gets its own ADR when actually designed.
- ADR-0001 should now be read with this amendment: criterion #4 (balance) no longer describes
  something the optimizer's objective scores — it describes a product aspiration served (in part)
  by a separate, later advisory feature, not by `solve()` itself.
