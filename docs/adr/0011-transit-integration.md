# ADR-0011: Transit integration

- **Status:** Accepted
- **Date:** 2026-06-24
- **Supersedes:** —
- **Superseded by:** —
- **Amended by:** ADR-0015 (transit becomes a Location `kind`; times are constraint fields),
  ADR-0018 (resolves the deferred time-of-day complexity as a representative-time
  approximation policy; regional providers demoted to gap-assessment-contingent
  enhancements behind a Google Routes default)
- **Constrained by:** ADR-0001 (scope-out: real-time, booking), ADR-0004 (travel cost)
- **Mirrors:** ADR-0009 (pluggable providers with regional applicability)
- **Note:** Decided in the 2026-06-24 grilling session.
- **Constrained by ADR-0013 (2026-06-25):** accommodation check-in/check-out datetimes are
  optimizer time-window constraints (vacate-by / settle-after); the within-day transition routing
  they imply is time-of-day-dependent, part of this ADR's deferred time-of-day complexity.

## Context

Transit is a stated future goal ("eventually incorporate transit options"). ADR-0004
already routed all travel cost through a provider with a `mode` enum that includes
`transit` and `walking`, so the optimizer-facing side is architected: realism is "a
provider that answers transit/walking durations." What remains is the user-facing scope
and the source strategy — bounded by ADR-0001, which scoped out real-time conditions and
booking.

Transit shows up two ways: making the **optimizer** realistic (transit/walking times
instead of haversine when sequencing) and helping the user **navigate** a leg.

## Decision

### Cost-provider mode + directions handoff

- **Optimizer realism** comes from ADR-0004's travel-cost provider answering the
  `transit`/`walking` modes (cached). No new optimizer surface — transit is a cost.
- **Navigation** is a **handoff**: deep-link out to an external maps/transit app for
  turn-by-turn. We do **not** render in-app schedules, real-time arrivals, or booking —
  those stay outside the app, inside ADR-0001's scope-out.

### Transit sources are pluggable, with regional applicability

Mirroring ADR-0009's `DiscoveryProvider`: routing/transit cost is served by **pluggable
providers** that **declare where they apply**. A global routing provider (e.g. Google
Routes) is the default; region-specific transit providers (e.g. a Japan transit source,
analogous to Tabelog for discovery) can register and take precedence within their region.
The **handoff target** (Google / Apple / a regional transit app) is likewise pluggable,
chosen by platform or region.

This keeps the heavy, volatile parts (schedules, real-time, booking) outside the app and
makes adding a region's transit provider a contained addition, not a routing rewrite.

## Alternatives considered

- **Full in-app transit** (feeds, live options, turn-by-turn). Rejected: enormous scope
  and cost, and reintroduces the real-time/booking concerns ADR-0001 excluded; mature
  apps already do this better.
- **Cost-provider mode only, no navigation.** Rejected: leaves an obvious gap — optimized
  for transit with no way to see how to ride it.
- **A single hardcoded routing provider.** Rejected per the user's caveat: transit data
  quality is strongly regional, so the provider must be pluggable like discovery
  (ADR-0009), not fixed to one vendor.

## Consequences

- A pluggable routing/transit provider layer is introduced as the concrete implementation
  of ADR-0004's non-haversine modes, with the same "declare regional applicability"
  contract as ADR-0009's discovery providers.
- The UI gains a "directions" affordance per leg that deep-links out; no in-app transit
  rendering is built.
- **Open complexity (deferred grill):** ~~transit duration is **time-of-day dependent**,
  which interacts with the optimizer's arrival-time simulation (ADR-0003) — the provider
  may need the simulated departure time as input, and cost becomes time-varying and
  asymmetric. To be designed when the first real routing provider is built.~~
  **Resolved by ADR-0018** (2026-07-07): a representative-time approximation policy —
  one matrix per trip at a representative departure datetime; the feasibility clock
  stays exact; exact schedule-aware re-checks can later slot into `solve()`'s
  violation pass.
- Caching and rate-limit handling live in the provider layer (as for travel cost and
  discovery), not the optimizer.
- **Open question (conditional — only if a regional provider is ever built, per
  ADR-0018):** a Japan-specific transit provider (e.g. NAVITIME-based) may not accept
  raw lat/lng directly for routing — some transit APIs require a separate
  name/coordinate → provider-internal-POI resolution call before a route can be
  computed. If so, `costMatrix()` calls need an internal resolve-and-cache step on top
  of ADR-0004's cost-matrix cache, adding a network hop and its own cache layer. Not a
  concern for the Google Routes default, which accepts the `placeId`s committed
  Locations already carry (ADR-0009). To be confirmed against the provider's actual
  API docs if a gap assessment ever demands a regional provider — informed by a
  2026-07-07 transcript of the NAVITIME/JapanTravel agent describing its own tool
  contract (`docs/japantravel-agent-transcript.md`), which is evidence of behavioral
  shape only, not authoritative API documentation.
