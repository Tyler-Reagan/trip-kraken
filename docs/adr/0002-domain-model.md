# ADR-0002: Domain model & invariants

- **Status:** Accepted
- **Date:** 2026-06-23
- **Supersedes:** —
- **Superseded by:** —
- **Constrained by:** ADR-0001 (north star), ADR-0005 (topology), ADR-0006 (authority)
- **Note:** Vocabulary sharpened by the 2026-06-23 grilling session; see `CONTEXT.md`.
- **Amended by ADR-0013 (2026-06-25):** a **Stay** is a timed booking (Lodging + check-in/
  check-out datetimes), not an integer night-range; "nights" and Day→Stay membership derive
  from those datetimes, and an Anchor gains a time dimension and a possible mid-day transition
  waypoint (an accommodation can be both a mid-day visit and a Day's end Anchor).

## Context

We need one shared vocabulary for the entities the whole app manipulates, with
invariants stated explicitly so persistence, optimizer, and UI agree on what is
always true. This replaces the implicit model (`Location.isLodging`, a flat
`Trip → Location/Day/Stop` shape) with one that supports multi-lodging trips, locked
stops, and route anchoring. The canonical glossary lives in `CONTEXT.md`; this ADR
records the *decision* and the invariants.

## Decision

The core entities (definitions in `CONTEXT.md`):

- **Trip** — the whole plan: candidate Locations + the itinerary over an ordered run
  of Days.
- **Location** — a *candidate* place. Existence in the trip ≠ being scheduled. May be
  `excluded` (kept but ignored by the optimizer).
- **Lodging** — the *place* a traveler sleeps; a Location used as accommodation. Never
  a Stop, never a nearby-search candidate.
- **Stay** — a Lodging occupied for one contiguous range of nights. A Trip has an
  *ordered* list of Stays. Revisiting the same hotel is a second Stay sharing one
  Lodging (place vs. occupancy kept distinct).
- **Day** — one day of the itinerary; belongs to exactly one Stay; holds an ordered
  run of Stops. Membership is *derived* from the Stay's night-range, not stored
  (ADR-0008).
- **Anchor** — the fixed point a Day's route starts and ends at. A Day has a **start
  Anchor and an end Anchor**. Normally both are the Stay's Lodging (round trip); a
  travel day runs previous-Stay's-Lodging → current; arrival/departure use an
  entry/exit point.
- **Stop** — a *scheduled instance* of a Location on a Day, with an order and a
  `locked` flag (ADR-0006). The same Location appears as at most one Stop.

**Distinction that matters:** *Location* is a candidate (discovery); *Stop* is a
commitment (refinement). Enrichment attaches to Location; scheduling/locking attaches
to Stop. *Lodging* is a place; *Stay* is a time-bounded occupancy of it.

**Invariants:**

1. Stays within a Trip are ordered with non-overlapping night-ranges. A Day falls
   within **at most one** Stay. Lodging is optional: a Trip may have zero Stays
   (lodging-optional or blank-slate), and Days outside any Stay's range have no Stay.
2. A Lodging is never a Stop and never a nearby-search candidate.
3. A Day has a start Anchor and an end Anchor. When the Day belongs to a Stay, both
   default to that Stay's Lodging (non-travel day); a Day with no Stay has no Lodging
   anchor and uses the optimizer's anchor-less fallback.
4. A Stop references a Location in the same Trip; ordering within a Day is a dense
   sequence starting at 0.
5. `excluded` Locations and `locked` Stops are inputs the optimizer must respect, not
   overwrite (ADR-0006).
6. A Location with no valid coordinates can exist (pre-enrichment) but cannot be
   scheduled until coordinates resolve.

## Alternatives considered

- **One "Base" entity merging place + time (original draft).** Rejected during the
  grill: can't cleanly express revisiting the same hotel (one place, two occupancies)
  and re-introduced a term the codebase had deliberately dropped (`isAnchor` →
  `isLodging`). Split into Lodging (place) + Stay (occupancy).
- **Day stores its Stay via FK.** Rejected: deriving membership from the Stay's
  night-range makes contiguity structural instead of an enforced-on-write invariant
  (ADR-0008).
- **Single anchor per day (start only, open path).** Rejected: makes travel days
  incoherent under multi-Stay; a Day needs both a start and end Anchor.

## Consequences

- Persistence (ADR-0008) needs a `Stay` entity (Lodging + night-range), a `locked`
  column on stops, and per-Day start/end Anchors; `isLodging` is replaced by Lodging
  being referenced by a Stay.
- The optimizer (ADR-0003) consumes Locations + Stays + Anchors + locked Stops and
  produces Days of Stops sequenced between each Day's two Anchors.
- "Candidate vs committed" and "place vs occupancy" give the UI clean splits: a
  Location pool, a Stay timeline, and the scheduled itinerary.
