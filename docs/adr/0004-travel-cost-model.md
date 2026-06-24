# ADR-0004: Travel cost behind a pluggable provider

- **Status:** Accepted
- **Date:** 2026-06-23
- **Supersedes:** —
- **Superseded by:** —
- **Constrained by:** ADR-0001 (feasibility/travel objective)
- **Feeds:** ADR-0003 (solver), ADR-0011 (transit)

## Context

Every cost in the optimizer ultimately comes from "how far / how long between two
places." Today that's hard-coded haversine straight-line distance plus a fixed
20 km/h speed assumption, called directly throughout the optimizer. Realistic travel
(driving, walking, and eventually transit — a stated goal) needs real times, but we
don't want to take an API dependency or rewrite the optimizer to get there.

## Decision

We will route all travel queries through a **travel-cost provider** interface:

```
cost(from, to, mode): { distanceMeters, durationSeconds }
costMatrix(points[], mode): Cost[][]      // batch, for solver inner loops
```

- `mode` is an enum (`walking | driving | transit | …`) so the transit goal (ADR-0011)
  is a new mode, not a new code path.
- The **default provider** is haversine distance + a per-mode speed constant,
  preserving current behavior with zero external dependencies.
- A **routing-API provider** (real durations, traffic, transit schedules) may be
  introduced later as another implementation, with caching, selected by config.
- The optimizer and objective consume **durations**, not raw distances, as the primary
  travel cost — so swapping in real times changes results without changing callers.
- Providers expose a **matrix** form because solvers query the same pairs repeatedly;
  this is also the natural caching and batching boundary.

## Alternatives considered

- **Haversine only (status quo).** Rejected: can't ever model transit or one-way/
  traffic asymmetry, which the product goal explicitly wants.
- **Real routing API now.** Rejected for now: external dependency, cost, rate limits,
  and caching complexity before the optimizer is stable. The interface lets us defer
  it without lock-in.
- **Bake mode into the optimizer.** Rejected: makes transit a fork of the algorithm
  instead of a parameter.

## Consequences

- The optimizer becomes provider-agnostic; haversine's inaccuracy is now an explicit,
  swappable choice rather than a buried assumption.
- A cost matrix + cache becomes the integration seam for any future routing API and
  the place to enforce rate limits.
- Travel cost can be unit-tested with a stub provider returning known values.
- Asymmetric costs (A→B ≠ B→A) become representable, which some solvers and transit
  modes require.
