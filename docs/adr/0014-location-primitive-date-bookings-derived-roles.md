# ADR-0014: Location as primitive; stays as date bookings; roles and anchors derived

- **Status:** Accepted
- **Date:** 2026-06-26
- **Supersedes:** —
- **Superseded by:** —
- **Amends:** ADR-0002 (drop `isLodging`, roles derived), ADR-0013 (datetimes → dates)
- **Constrained by:** ADR-0001 (intent ranks above optimality), ADR-0008 (persistence)
- **Constrains:** ADR-0003 (time-window constraints), ADR-0011 (time-of-day transit)

## Context

Two specialized concepts — *lodging* and the *timed Stay* — have produced repeated bugs and
churn (most recently "a check-in day's lodging is its overnight, not its origin"). Stepping back,
the friction sits in two layers that have been conflated:

1. **Role identity is stored twice.** A place's "lodging-ness" lives in both
   `Location.isLodging` *and* "is referenced by a `Stay`." Two sources of truth for one fact, free
   to drift. ADR-0002's own Consequences said `isLodging` would be *replaced by* the Stay
   reference — the code kept both. Arrival/departure, likewise roles a place plays, aren't modeled
   as anything yet; they're implicit in anchor logic.

2. **The Stay carries a clock it doesn't need.** ADR-0013 modeled check-in/check-out as full
   **datetimes**, citing booking import: a confirmation carries a check-in *datetime*. True — but
   re-examine what the time *does*. Every structural question (which night you sleep where, which
   Stay bounds a Day, whether a Day is a travel day) is answered by the **date** alone. The time
   ("from 15:00 / until 11:00") is **property policy** — near-constant across bookings, and
   load-bearing only for optimizer realism (vacate-by / settle-after), which ADR-0013 *already*
   defers to Phase 2. So the datetime spends complexity where no structure rents it, and its
   ordering is exactly the seam the check-in/travel-day bugs breed in.

ADR-0013 made two calls that stand: the **booking is the primitive** the user enters, and
**anchors are derived**. This ADR keeps both and sharpens the rest.

## Decision

### Layer 1 — Location is the only place primitive; roles are derived

We will drop `Location.isLodging`. A Location's **roles** are *computed* from the structures that
reference it, never stored as flags:

- it is a **Lodging** because a `Stay` references it;
- it is an **arrival/departure** because it fills a trip-edge anchor;
- it is a **scheduled visit** because a `Stop` places it.

One source of truth per fact, nothing to drift. Place-vs-occupancy is unchanged (a `Stay`
references a Lodging Location; revisiting a hotel is a second Stay sharing one Lodging). ADR-0002's
"a Lodging is never a Stop nor a nearby candidate" still holds, now stated as: *a Location
referenced by a Stay is not also scheduled as a Stop.* Conditional handling keys off a derived
**role view**, not a column.

### Layer 2 — A Stay is a date booking; nights and anchors derive by date; times are policy

We will model a Stay as plain calendar dates:

```
Stay = { lodgingLocationId, checkInDate, checkOutDate }   // half-open [checkIn, checkOut)
```

- **Nights** = the date interval `[checkInDate, checkOutDate)`; night count = `checkOut − checkIn`.
  No stored night-range, no datetime.
- **Per-Day anchors** derive from one rule over the ordered Stays:
  - **end / overnight anchor** of day *D* = the Stay with `checkIn ≤ D < checkOut` (where you sleep);
  - **start anchor** of day *D* = the Stay with `checkOut == D` if one exists (a travel day → you
    woke there); otherwise the overnight Stay (round trip);
  - the first Day's start is an **arrival** anchor; the last Day's end is a **departure** anchor.
- **Check-in / check-out *times* are optional policy on the Lodging Location** (default 15:00 /
  11:00). They feed only optimizer realism (vacate-by / settle-after — Phase 2 per ADR-0013) and
  are **never** consulted to decide which night or which anchor. If a per-Stay time override ever
  proves necessary, add it then; we do not model it speculatively.

The mid-day transition ADR-0013 wanted is still derivable without a stored time: the travel day is
the date where one Stay's `checkOut == ` the next Stay's `checkIn`, giving start anchor A and end
anchor B. Phase 2 items from ADR-0013 (mid-day transition waypoints, time-window constraints,
arrival/departure anchors, booking-integration import) are preserved and **must not be
precluded** — they now rest on a date model.

## Alternatives considered

- **Keep datetimes (ADR-0013 status quo).** Rejected: the time decides no topology, yet its
  ordering is where the lodging derivation bugs live — complexity paying no structural rent. Import
  maps just as cleanly onto *date + property policy*, which is how confirmations are actually
  shaped (a fixed property check-in policy, per-booking dates).
- **Flatten Stay into a tag on Location** (the bare "lodging is just `isLodging`" instinct).
  Rejected: a tag cannot carry a duration or a revisit (same hotel twice = two occupancies).
  ADR-0002's grill already rejected merging place+time for this reason; the duration is essential,
  not ceremonial.
- **Make `isLodging` the source of truth and drop the Stay reference as authority.** Rejected:
  loses occupancy/duration and inverts ADR-0002's place-vs-occupancy split.
- **Keep both `isLodging` and the Stay reference (status quo).** Rejected: two sources of truth for
  one fact; the standing drift is itself a bug source.

## Consequences

- **Persistence (ADR-0008):** `Stay` becomes `{ lodgingLocationId, checkInDate, checkOutDate }`
  (dates); ADR-0013's datetime columns and the `Location.isLodging` column are removed. Pre-launch:
  recreate the schema, no data migration (project no-backwards-compat).
- **Derivation:** the `getTripWithDetails` anchor derivation collapses to a single
  date-comparison function over the ordered Stays. This is where the recurring check-in/travel-day
  bugs are expected to stop — there is now exactly one rule for night ownership.
- **Types (`src/types`):** `Location` loses `isLodging` (role is computed); `Stay.checkIn/checkOut`
  become dates; optional Lodging check-in/out *policy* times live on the Location if/when used. A
  derived role helper (Location + trip → roles) replaces the stored flag.
- **ADR-0002 amended:** `isLodging` removed; lodging-ness and other roles derived; Stay is a date
  booking.
- **ADR-0013 amended:** check-in/out are dates, not datetimes; the time dimension moves to optional
  Lodging policy and Phase-2 optimizer constraints. "Booking is the primitive" and "anchors
  derived" stand.
- **`CONTEXT.md` glossary:** Stay → "date booking"; add **Role** as a derived concept; remove
  `isLodging`.
- **UI:** the booking list edits a date pair, not datetime pickers; the derived read-only Day
  start/end display is unchanged in spirit.
- **Deferred bills:** unchanged from ADR-0013 (mid-day waypoints, time-window constraints,
  arrival/departure anchors, booking import), now resting on the date model.
