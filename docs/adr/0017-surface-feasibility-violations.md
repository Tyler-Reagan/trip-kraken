# ADR-0017: The solver's result surfaces feasibility violations, not just an arrangement

- **Status:** Accepted
- **Date:** 2026-07-06
- **Supersedes:** —
- **Superseded by:** —
- **Amends:** ADR-0016 (extends "feasibility is a real, measured gate" one step further — the
  measurement must be visible in the result, not absorbed into an internal-only score)
- **Constrains:** ADR-0003 (the `Itinerary` type)

## Context

ADR-0016 established that feasibility (closed-hours violations, day-budget overstuffing) is a
real, measured gate the solver's comparator checks — not a vague aspiration approximated by a
large weight. But today, and in the O1–O3 plan as scoped so far, that measurement is
**write-only**: `optimizeItinerary` returns just `DayPlan[]`, a bare list of stops per day. The
window/day-budget penalties get computed during construction to *decide* placement, then thrown
away — nothing downstream (the orchestrator, an eventual UI) can ever learn that a returned
itinerary still has, say, a stop arriving 40 minutes after close, or a day 90 minutes over budget.
There is no equivalent today of the old locking system's rule (ADR-0006, superseded) that "a
locked set that is itself infeasible is a surfaced warning state, not a crash" — nothing tells the
user when the optimizer couldn't fully satisfy feasibility.

## Decision

**`solve()`'s result (ADR-0003's `Itinerary`) carries its feasibility outcome alongside the
arrangement** — at minimum, which stops/days violated which feasibility rule and by how much — not
just the sequence of stops. The comparator already computes this to rank candidates; O3 must keep
it attached to the winning candidate instead of discarding it once a decision is made.

This ADR scopes only the **plumbing**: the type must be able to carry this information, and
`solve()` must populate it truthfully. It does **not** scope a UI for displaying violations to the
user, nor does it change how `optimizeTrip`/the API persist or expose it beyond making it
available — those are separate, later decisions.

## Alternatives considered

- **Leave the result as bare stops (status quo).** Rejected: having spent ADR-0016 establishing
  feasibility as a real, measured concept, letting the one place that measurement happens remain a
  black box to every caller contradicts the point of measuring it at all.
- **Surface only a boolean (`feasible: true/false`).** Rejected as the sole signal: it's cheap but
  throws away exactly the information (which stop, which rule, how bad) that would make a future
  UI warning ("2 stops couldn't make their hours") more useful than a generic red flag. A richer
  violations list can still be reduced to a boolean by any caller that only wants that.

## Consequences

- `Itinerary` (ADR-0003) gains a feasibility-violations field (shape TBD when O3 is actually
  built — e.g. a list of `{ locationId, rule, magnitude }`), populated by the same objective
  functions (`objective.ts`) already computing these penalties.
- `optimize.ts`'s orchestrator and the `/api/trips/[id]/optimize` route can pass this through
  without designing anything new yet — surfacing it in the UI is separate, unscoped future work.
- Test coverage should assert the violations list accurately reflects known-infeasible fixtures
  (e.g. a stop placed outside its window intentionally, to confirm it's reported), not just that
  the arrangement itself looks reasonable.
