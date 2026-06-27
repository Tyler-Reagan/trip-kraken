# ADR-0013: Accommodations as timed bookings; day anchors derived

- **Status:** Accepted
- **Date:** 2026-06-25
- **Supersedes:** —
- **Superseded by:** —
- **Amended by:** ADR-0014 (2026-06-26): check-in/out become **dates**, not datetimes; the time
  dimension moves to optional Lodging policy and Phase-2 optimizer constraints. "Booking is the
  primitive" and "anchors are derived" stand.
- **Amends:** ADR-0002 (Stay definition), ADR-0005 (per-Day Anchors)
- **Constrained by:** ADR-0001 (intent ranks above optimality), ADR-0008 (persistence)
- **Constrains:** ADR-0003 (time-window constraints), ADR-0011 (time-of-day transit)

## Context

ADR-0002 modeled a **Stay** as a Lodging over an integer **night-range** (`startNight..endNight`),
and ADR-0005 derived each Day's start/end Anchor from it. Integer nights are the wrong unit:

1. **Real lodging is booked as a check-in datetime and a check-out datetime** — the form every
   booking confirmation (hotel, Airbnb) carries, and the form users actually reason in: *"I check
   into Hotel A at 3pm on the 24th and check out at 11am on the 26th."* A future booking
   integration (ADR-0001 scope-out today, but a stated goal) must map field-for-field onto our
   model; night-ranges have nothing to map to.
2. **Night-ranges can't express within-day transitions.** Checking out of A late morning and into
   B mid-afternoon is common, and *when* the base changes is real routing information. The
   in-flight UI exploration (a per-Day "overnight" picker) made the mismatch concrete: the
   night/stay vocabulary leaked into the interface and produced meaningless artifacts ("nights
   3–3"). The user's correction: the booking is the primitive; the routing view is derived.

## Decision

We model accommodations in **two layers**, the booking layer being the source of truth.

### Booking layer — what the user enters (maps 1:1 to real reservations)

A **Stay** is a booking: a **Lodging** with a **check-in datetime** and a **check-out datetime**.
The user reasons only here. A Trip has an ordered set of Stays; revisiting a hotel is a second
Stay sharing one Lodging (place vs. occupancy, unchanged from ADR-0002). This **replaces**
`startNight/endNight`.

### Routing layer — derived, consumed by the optimizer

A Stay's check-in and check-out are **timed location events** (`at this Lodging, at this
datetime`). Overlaid on the Day timeline they yield, per Day:

- a **start anchor** — the Lodging you are checked into at the Day's start (where you woke);
- an **end anchor** — the Lodging you are checked into at the Day's end (where you sleep);
- any **mid-day transition waypoint(s)** — a check-in (or check-out) whose datetime falls
  *within* the active Day is a place you physically visit at that time.

So an accommodation can be **both a mid-day stop and the Day's end anchor**: you check into B at
3pm (a visit), keep exploring, and return to B to sleep. Lodging is therefore *not* only a
bookend — the model must allow a Day to visit an accommodation mid-route.

**Bookend invariant.** Every Day starts and ends at a booked accommodation — except the trip's
**first** Day (starts at an **arrival** anchor) and **last** Day (ends at a **departure** anchor).
Arrival/departure are transport, not lodging, filling the same anchor slot.

**Times are optimization constraints (the "location relevancy").** Check-out imposes a
*vacate-by* time on the start anchor; check-in imposes a *settle-after* time plus a visit to the
new Lodging at ~that time. These feed the optimizer's time-window machinery (ADR-0003) and become
time-of-day-dependent once real transit cost lands (ADR-0011).

**Nights are derived, not stored.** "How many nights at A" and "which Stay bounds which Day"
derive from the check-in/out datetimes. There is no stored night-range.

### Phasing — what we build now vs. defer

- **Phase 1 (now):** store check-in/check-out datetimes; derive each Day's start/end anchor at
  **day granularity** (which Lodging bounds the Day). Entry UI is a **booking list** (Lodging +
  check-in/out datetime); Days display the derived start/end read-only. Lodging stays derived,
  never a stored Stop (ADR-0005, already in force).
- **Phase 2 (deferred — explicit):**
  1. **Mid-day transition waypoints** — materializing a within-day check-in/out as a timed point
     in the Day's route (the "visit the new hotel midday" case). Phase 1 shows only start/end
     anchors and does **not** yet place the mid-day check-in as a waypoint.
  2. **Time-window constraints** — *vacate-by* (checkout) and *settle-after* (check-in) as
     optimizer constraints; time-of-day-dependent transit (ADR-0011).
  3. **Arrival/departure anchors** — the first-Day-start / last-Day-end transport anchors
     (airport/station) with their datetimes.
  4. **Booking-integration import** — ingesting real reservations into the Stay (check-in/out)
     shape; the model is chosen so import is a field-for-field map.

The Decision above describes the **full** model; Phase 2 items are deferred in implementation but
**must not be precluded** — in particular the derived-anchor representation must leave room for a
Day to have mid-day accommodation visits, not only bookend anchors.

## Alternatives considered

- **Keep night-ranges (ADR-0002/0005 status quo).** Rejected: lossy versus real bookings, cannot
  express within-day transitions or check-in/out times, and the vocabulary leaks into the UI.
- **Per-Day "overnight" picker as canonical entry (the in-flight exploration).** Rejected: a
  booking spans Days, so editing it one Day card at a time is the night-range modal's mismatch
  inverted, and it drops the times real bookings and optimization need. At most a derived
  convenience, not the source.
- **Model only Day start/end anchors, no booking layer.** Rejected: users think in check-in/out,
  not "Day origin/terminus," and a booking integration would have nothing to map onto.
- **Full time-aware transition routing now.** Rejected: large, and depends on time-of-day transit
  (ADR-0011) not yet built. Deferred to Phase 2 with the data captured up front so it is additive.

## Consequences

- **Persistence (ADR-0008):** `Stay` becomes `{ lodgingLocationId, checkIn, checkOut }` (datetimes);
  `startNight/endNight` are removed. Pre-launch: recreate the schema, no data migration. The
  repository's stay write/derivation paths (`setStays`, `setDayLodging`, the `getTripWithDetails`
  anchor derivation) are rewritten against datetimes.
- **ADR-0002 amended:** Stay = Lodging + check-in/out datetimes; Day→Stay membership and "nights"
  derive from datetimes; an Anchor gains a time dimension and a possible mid-day transition
  waypoint.
- **ADR-0005 amended:** a Day's start/end anchors derive from booking events; arrival/departure
  anchors are the trip edges.
- **ADR-0003 / ADR-0011 constrained:** check-in/out are time-window constraints; transition
  routing is time-of-day-dependent (Phase 2).
- **UI:** entry becomes a booking list (datetimes). The in-flight per-Day "overnight" editor and
  night-based summary are **superseded** and will be reworked into the booking list plus a derived
  read-only Day display. (The earlier "lodging is derived, not a stored Stop" refactor stays.)
- **Glossary:** `CONTEXT.md`'s Stay entry updates to "timed booking."
- **Deferred bills (explicit, per Phasing):** mid-day transition waypoints; time-window
  constraints; arrival/departure anchors; booking-integration import.
