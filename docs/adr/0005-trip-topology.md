# ADR-0005: Multi-lodging sequential trip topology

- **Status:** Accepted
- **Date:** 2026-06-23
- **Supersedes:** —
- **Superseded by:** —
- **Constrains:** ADR-0002 (domain model), ADR-0003 (optimizer)
- **Note:** Term "Base" replaced by Lodging + Stay during the 2026-06-23 grilling
  session; see `CONTEXT.md` and ADR-0002.
- **Implementation note (2026-06-25):** A Lodging is a **derived day-anchor**, never a stored
  itinerary Stop.
- **Amended by ADR-0013 (2026-06-25):** a Day's start/end Anchors derive from **timed bookings**
  (a Stay = Lodging + check-in/check-out datetimes), not night-ranges. Check-in/out may also be
  mid-day transition waypoints, so an accommodation can be both a mid-day visit and the Day's end
  Anchor. Arrival/departure anchors and time-window routing are deferred there.

## Context

The current model assumes a single lodging that anchors every day. That breaks the
moment a trip spans multiple cities or changes hotels — a common real case
(Tokyo for 3 nights, then Kyoto for 2). We chose to generalize rather than
special-case.

## Decision

A trip has an **ordered timeline of Stays**. A **Stay** is a Lodging occupied for a
contiguous range of nights (ADR-0002). Each itinerary Day belongs to exactly one Stay
— the one whose night-range contains that night (the Stay you sleep at).

- Single-lodging trips are the degenerate case: one Stay covering all nights.
- The same Lodging revisited later is a *second Stay* sharing one Lodging.
- Clustering (ADR-0003) runs **within the scope of each Stay**: a Day's stops are
  chosen and anchored relative to that Stay's Lodging, not a single global anchor.
- A Lodging is an Anchor, never clustered as a Stop, and excluded from "nearby"
  candidate searches (the fix already made for lodging, now expressed via Stay
  membership rather than a boolean).
- **Travel between Stays** is a first-class case: the transition Day belongs to the
  destination Stay but is routed from the previous Stay's Lodging to the current one
  (ADR-0002's start/end Anchors), not left to clustering accident.

## Alternatives considered

- **Single lodging (status quo).** Simplest. Rejected: structurally can't express
  multi-city trips; would force a separate "trip" per city and lose cross-Stay
  sequencing.
- **No fixed lodging.** Pure free-roaming clustering. Rejected: most trips *do* have
  lodging that meaningfully anchors each day's start/end; throwing that away loses
  feasibility signal.
- **Lodging as just another location flag (today's `isLodging`).** Rejected: a boolean
  can't express *which* Stay is active on *which* night, which is the whole point.

## Consequences

- The domain model (ADR-0002) needs a `Stay` entity (Lodging + night-range); Days
  derive their Stay from that range (ADR-0008).
- Optimization becomes "scope days to their Stay, then cluster/sequence within each
  Stay between that Day's Anchors" — a structure the solver interface (ADR-0003) must
  accommodate.
- Migration: today's single `isLodging` location maps to a single Stay spanning all
  nights (ADR-0008).
- UI must let the user define the Stay timeline (which nights, which Lodging). Until
  that exists, default to one Stay over the whole trip.
