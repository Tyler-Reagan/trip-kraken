# ADR-0020: Multi-lodging optimizer scoping via per-activity eligible-day masks, with per-cluster coverage as a hard gate

- **Status:** Accepted
- **Date:** 2026-07-15
- **Supersedes:** —
- **Superseded by:** —
- **Amends:** ADR-0003 (default solver's clustering gains lodging-derived per-activity eligible-day
  masks + a per-cluster coverage check + an `unplaced` output), ADR-0015 (concrete optimizer
  consumption of the multi-lodging model)
- **Constrained by:** ADR-0001 (feasibility ranks above travel/balance), ADR-0016 (feasibility is a
  hard gate, not a weighted term)
- **Depends on:** `src/lib/metroCluster.ts` (#116)

## Context

The data model already supports multiple `kind: lodging` Locations per Trip (ADR-0015), but the
optimizer never consumed that: `optimizer.ts`'s k-means clusters every activity against the single
`StayPlan` anchor for whichever day it's iterating, with no concept of "this activity's city has no
bed on this day." A trip spanning two distant metros (e.g. Osaka + Tokyo, ~400km apart) with only
one lodging entered produces a degenerate plan — activities from the un-lodged city get crammed
into arbitrary days, days end up geographically incoherent, and closed-hours violations spike.

The wayfinder map "Stay timeline" (#111, decision ticket #115) worked out the fix in detail; this
ADR records the resulting model as implemented (#118), the same relationship ADR-0017 has to its
own wayfinder ticket.

## Decision

**Per-activity eligible-day masks, not per-lodging sub-problems.** The optimizer keeps its single
k-means over all days. Each activity gains a hard eligible-day mask — the set of day numbers it may
be assigned to — derived from which lodging(s) cover its metro:

```
eligibleDays(L) = { d : lodgingOnNight(d) == L OR lodgingOnNight(d-1) == L }
```

For one contiguous stay this collapses to a single range: `[startNight, endNight + 1]`, clipped to
`[1, numDays]`. The `+1` is deliberate — it's what makes a travel day (the seam where you wake at
one lodging and sleep at another) eligible for *both* cities' activities, since a hard per-lodging
partition would make the two sub-problems overlap on that day. Multiple lodgings covering one metro
(e.g. a mid-stay hotel change) union their eligible-day sets.

**Coverage is decided per metro cluster, not per activity.** A lone activity 90km from the nearest
lodging looks like a plausible solo day trip; a whole cluster of them, with no lodging in reach of
any of them, is the actual "no bed in this city" case ADR-0001's feasibility criterion should
reject. Metro clustering reuses `metroCluster.ts`'s `clusterByMetro` (#116, itself promoted from
the throwaway heuristic in #110) — the same geo-clustering the post-import wizard (#119) will use,
so there is exactly one detector, not three independently-tuned ones.

**An orphaned metro (no covering lodging) is a hard gate, not a soft warning**, consistent with
ADR-0016. Mechanically this falls out of the mask for free: an orphaned cluster's activities get an
**empty** mask, k-means has nowhere eligible to put them, and they receive no `Placement`. The
result carries them in a new `unplaced: { locationId, reason }[]` field, populated by
`optimizeItinerary`/`solve()`/`optimizeTrip` — deliberately **not** merged into ADR-0017's
`feasibilityViolations`, since a coverage gap has no `dayNumber` (it never reached a day) and a
different lifecycle (add a bed and it places, rather than needing a rearrangement). No new UI is
required to surface it: an activity with no `Placement` already lands in the existing Unassigned
tray; only rendering the `reason` is left to a later ticket (#120).

**Masking is inactive when no lodging in the run has real coordinates.** An ungeocoded lodging
can't establish geographic coverage — same convention `optimizer.ts` already uses for anchor
resolution ("falls back to no anchor"). Concretely: a trip with zero lodgings, or lodgings that are
all ungeocoded, clusters exactly as before this ADR (every day eligible for every activity). A
single geocoded lodging is the degenerate one-metro case: normally every activity clusters into that
one metro and takes the lodging's full eligible-day range, i.e. unrestricted, so ordinary
single-lodging trips are unaffected.

**Transition-day open-path routing is unchanged.** `optimizer.ts` already routes a travel day as an
open path from the wake lodging to the sleep lodging (`seqStart`/`seqEnd`); that logic is orthogonal
to the mask and untouched by this ADR.

## Alternatives considered

- **Per-lodging sub-problems (partition the trip, optimize each city independently).** Rejected: a
  travel day is a seam shared by two beds, so the sub-problems aren't independent — an orchestrator
  would have to special-case the seam day anyway, which is exactly what the mask expresses without
  one.
- **Per-activity nearest-bed coverage** (each activity checks its own distance to the nearest
  lodging, no clustering step). Rejected: too lenient — every lone far-flung stop reads as a
  feasible solo day trip, so a real "no lodging in this city" case would instead produce many
  individually-plausible-looking placements, none of which add up to a sane plan.
- **Soft warning instead of a hard gate** (place orphaned activities anyway, flag them). Rejected by
  ADR-0016: feasibility is a gate the solver must honor structurally, not a penalty a large enough
  travel saving could out-bid.
- **A separate, hand-tuned distance threshold for coverage matching**, instead of reusing
  `metroCluster.ts`. Rejected: #115 explicitly requires reusing the #110-derived detector so the
  optimizer, the post-import wizard, and the old cross-metro warning share one radius and one
  clustering algorithm instead of three that could drift out of sync.

## Consequences

- `optimizeItinerary` returns `{ days, unplaced }` instead of a bare `DayPlan[]`; `Itinerary`
  (solver.ts) and `OptimizeResult` (optimize.ts) both gain an `unplaced` field alongside the
  existing `feasibilityViolations`, threaded through with no new caller-facing behavior yet.
- `metroCluster.ts`'s `MetroCluster` now carries `lodgings: L[]` (every covering lodging) rather
  than a single nearest match, since the eligible-day mask needs the *union* across all lodgings
  covering one metro, not just the closest one.
- #119 (post-import wizard) and a future #110-retirement both consume the same `clusterByMetro` —
  no second heuristic to keep in sync.
- #120 (surfacing `unplaced` reasons in the UI) is unblocked; today the affected activities are
  already visible in the Unassigned tray, just without an explanation of why.
- A single-lodging trip whose activities happen to split into two clusters more than
  `METRO_CLUSTER_RADIUS_METERS` apart (a real day-trip beyond the metro radius) now produces an
  `unplaced` entry for the distant cluster instead of clustering it onto an arbitrary day — a
  behavior change from before this ADR, but the intended one: it's the same "no bed in this city"
  case the ADR exists to catch, just with one lodging instead of zero.
