# ADR-0001: North star & what makes an itinerary good

- **Status:** Accepted
- **Date:** 2026-06-23
- **Supersedes:** —
- **Superseded by:** —

## Context

Every downstream decision — the optimizer, the data model, the UI — exists to serve
one job. Before choosing algorithms or schemas we fix that job in words, so the
objective is the invariant and the implementation is negotiable. This ADR is the
fixed point the rest of the refactor is judged against.

## Decision

**The job:** turn a flat set of candidate locations into an efficient, feasible,
multi-day itinerary, and support an iterative *discovery → refinement* loop that
tightens it into a real plan.

A **good itinerary** is one that, in priority order:

1. **Is feasible.** No stop is scheduled when it is closed; no day is impossibly
   overstuffed relative to its time budget; every day is reachable from its active
   lodging (see ADR-0005).
2. **Minimizes wasted travel.** Geographically close stops share a day
   (low inter-day travel), and each day is visited in a near-optimal order
   (low intra-day travel).
3. **Respects the traveler's intent.** Stops the user has locked, excluded, or
   hand-placed are honored over the optimizer's preferences (see ADR-0006).
4. **Balances the experience.** Variety across days (not all museums on day one),
   reasonable pace, food and rest woven in.

These are **soft and ranked**: feasibility and intent dominate; balance is a
tie-breaker. The optimizer expresses them as one comparable cost (today: km-equivalent
penalties), but the *ranking* above is the contract — any solver (ADR-0003) must honor it.

**Out of scope for "good"** (deliberately): cheapest trip, real-time conditions,
booking/availability. These may enter later via their own ADRs.

## Alternatives considered

- **Optimize a single hard objective (min total distance).** Rejected: produces
  infeasible plans (visiting closed places) and ignores intent — technically optimal,
  practically useless.
- **Let the UI define "good" implicitly.** Rejected: leaves the objective unstated and
  unauditable, which is the trap this refactor avoids.

## Consequences

- Gives the optimizer ADRs a written objective to encode and a ranking to respect.
- Makes "feasibility before optimality" a hard rule: a solver may never trade a
  closed-hours violation for a shorter route.
- Success is measurable per criterion (hours-violations, inter/intra-day travel,
  honored-locks rate, category spread), enabling regression tests instead of vibes.
- Anything not serving these four criteria is a candidate for removal.
