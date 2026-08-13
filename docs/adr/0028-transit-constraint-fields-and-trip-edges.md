# ADR-0028: Transit carries `arriveAt` / `departAt`; trip edges are unique by construction, not derived by rule

- **Status:** Accepted
- **Date:** 2026-08-13
- **Supersedes:** —
- **Superseded by:** —
- **Amends:** ADR-0015 (pays its parked "exact transit constraint-field shape" bill; refines §4's
  "trip edges are derived from the earliest/latest transit" into a uniqueness invariant, and narrows
  §4's derivation from a read-time rule to a write-time guarantee), ADR-0005 (its trip-edge override
  becomes real for the first time, as ADR-0023 §1 anticipated)
- **Constrained by:** ADR-0001 (intent ranks above optimality), ADR-0015 (one place primitive; roles
  are derived adjectives, never stored)
- **Depends on:** ADR-0023 (the VROOM request builder that consumes `start_index` / `end_index`)
- **Note:** Decided in the 2026-08-13 design session against issue
  [#156](https://github.com/Tyler-Reagan/trip-kraken/issues/156). The first design this session
  produced reconstructed the trip edges at read time from dates and tie-breaks; it is recorded under
  *Alternatives considered* because the defect it carried — read-time reconciliation of a fact the
  write path already holds — is the defect this ADR's shape exists to remove.

## Context

ADR-0015 §2 put a Transit Location's times among the constraint fields that are optimizer inputs,
and then parked their exact shape: its Consequences list "the exact transit constraint-field shape"
first among **parked bills (must not be precluded)**. ADR-0015 §4 simultaneously removed
`arrivalLocationId` / `departureLocationId` from `Trip` and replaced them with a rule — trip edges
"are **derived** from the earliest/latest transit, not stored singletons."

That rule has never run. It was written against a model in which a Transit Location carries nothing:
`type Transit = LocationBase & { kind: "transit" }`. There is no time to be earliest or latest by.
Nor is there any way to make one — no code path in the application writes `kind: "transit"`, the
`PATCH` route's field whitelist does not accept it, and `Manifest.tsx` renders the Transit group as
a read-only list that is hidden entirely when empty. The kind exists in the schema and the type
system with no writer and no reader.

ADR-0023 §1 recorded what changes once a feeder exists: under VROOM, an edge anchor is
`vehicle.start_index` on day 1 and `vehicle.end_index` on the last day, so "it is setting two fields
rather than a distinct code path." §9 deleted `EdgeAnchors` as live code with no production feeder.
The solver side is therefore already cheap and already designed. **The cost of this work is entirely
the input surface**, which is why #156 is one issue and one change rather than a solver patch.

Two further facts constrain the shape:

- **The candidate pool filter is wrong in a way nothing can yet expose.** `solver.ts` builds
  candidates as `locations.filter((l) => !lodgingIds.has(l.id))` — everything that is not a Lodging.
  That is an out-of-date proxy for "is an Activity." The moment a Transit Location can exist, a
  railway station is sent to VROOM as a job to be placed.
- **A station the optimizer routes through is not reachable.** `osmTransitProvider` reads stop-node
  ids and station names during its shortest-path search and records none of them; its step type is
  `{ kind: "ride"; lineName: string }`, and the caller sees only totals plus a joined line-name
  string. The registry's own `describeJourney` docblock names this as the blocker for per-Path
  chaining, `describeJourney` is unused, and no Path or Journey reaches the UI at all.

## Decision

### 1. A Transit Location carries `arriveAt` and `departAt`; their presence is the kind

Two nullable constraint fields go on `Location`. `arriveAt` is when you get to the place. `departAt`
is when you leave it. Either field present makes the Location `kind: transit`; both absent makes it
an Activity.

This is the same rule Lodging already uses, and it is deliberately the *second instance of one
pattern* rather than a second pattern. `checkInDate` + `checkOutDate` are documented in the `PATCH`
route as "the kind-elevating gesture" — setting them makes a Location a Lodging, clearing
`checkInDate` relegates it to an Activity. Kinds in this codebase are written by writing constraint
fields, never by writing `kind` directly.

**Both fields on one Location is legal and is the common case.** A round trip through one airport —
into Haneda on day 1, out of Haneda on day 10 — is one Location carrying both fields. Day 1's
`start_index` and the last day's `end_index` then address the same matrix row, which VROOM accepts
without special handling.

**Two fields, not one.** A single `scheduledAt` would carry a moment without saying what the moment
*is*, forcing the reader to infer arrival-ness or departure-ness from the Location's position in the
trip. Splitting them states it. It also makes the round-trip case above expressible on one Location
instead of forcing two.

### 2. The trip edges are unique by construction, not reconstructed by rule

**At most one Location per Trip carries `arriveAt`. At most one carries `departAt`.** This is
enforced by a partial unique index on `(tripId)` where the field is not null, and maintained by the
write path: setting an edge clears any prior holder in the same transaction.

The derivation is then total and has one clause:

> The arrival is the Location that carries `arriveAt`. The departure is the Location that carries
> `departAt`. Either may be absent, independently; behaviour is then unchanged, and the Day falls
> back to its Lodging Anchors.

This is the load-bearing decision of the ADR, and it is a decision about *where a fact is
guaranteed*, not about what is stored. ADR-0015 §4's instinct — the edges are not stored singletons —
is preserved exactly: no `arrivalLocationId`, no role column, no boolean. What changes is that
agreement is made unrepresentable at write time instead of reconciled at read time.

The alternative shape, which this replaces, derived the arrival as "the Transit Location whose
`arriveAt` falls on day 1, earliest if several." That rule and its four companions — a date guard, a
tie-break for arrival, a tie-break for departure, and an inert-state rule for a `departAt` on day 1 —
all exist to reconstruct at read time a fact the input surface already knows unambiguously. Every one
of them is deleted by the uniqueness invariant, along with the failure mode they carried: a
connecting airport recorded as a Location would out-compete the real arrival on "earliest on day 1,"
and a change to the Trip's date range would silently move which Location qualified.

### 3. The date component is written by the system; the user edits only the time

An arrival's date is the Trip's first date. A departure's date is the Trip's last date. Neither is
typed by a user, and neither is a degree of freedom — the position defines it. When the Trip's date
range moves, the stored edge dates are rewritten with it, in one place.

The field's value is therefore date-or-datetime, and the precision carries meaning:

| Value | Meaning |
| --- | --- |
| `null` | Not an edge. |
| `"2026-09-14"` | Designated; the time is not known yet. |
| `"2026-09-14T14:00"` | Designated at a known time. |

**The date is not removable, and this is worth stating because it looks like it is.** An edge needs
three states — absent, designated without a time, designated with a time. A nullable time-of-day
string expresses two. A nullable date-or-datetime expresses exactly three. This is the minimal
encoding, not a flourish, and it is what lets a traveller record "I fly into Haneda, the flight is
not booked yet" without inventing a clock constraint that no evidence supports.

Storage is local ISO text with no time zone, extending the existing `IsoDate` convention one field
wider. It inherits the fiction ADR-0023's Consequences already recorded — UTC arithmetic standing in
for trip-local wall clock — and is honest on the same grounds: no epoch value reaches a user.

### 4. A Transit Location is an Anchor, never a Placement

Transit Locations are held out of the candidate pool by the same mechanism that holds out Lodgings.
They are never emitted as a Placement. `solver.ts`'s `!isLodging` filter is corrected to say what it
means — Activity is the only kind the optimizer *places*, as CONTEXT.md already states.

This is not an exclusion from optimization. A Lodging is held out of the candidate pool too, and it
is the most load-bearing input the solve has: it fixes every Day's start and end and, through metro
clustering, which activities are eligible for a Day at all. An edge Transit Location does the same
job at the trip's boundary. The distinction that matters is **Anchor versus candidate**, not
in-the-solve versus out-of-it.

Edge Transit Locations therefore enter the travel matrix, because `start_index` and `end_index` are
matrix rows. They skip §7's pre-flight exclusion checks for the same reason Lodgings do: an airport
lies outside every Lodging's metro by nature, and coverage exclusion is a test for candidates.

**An edge with no coordinates falls back to the Lodging Anchor and emits a warning.** This follows
the decision recorded during the VROOM translator work — a pending Lodging warns, it does not block.
Blocking a solve over a field that is only decorative until enrichment completes is
disproportionate; falling back in silence would make the feature look broken with no way to
diagnose it.

### 5. The edges constrain the Day window honestly

| Boundary | Rule |
| --- | --- |
| Day 1 opens | `max(default start, arriveAt)` — you cannot do anything before you land. |
| Day 1 closes | Unchanged. |
| Last Day closes | `min(default close, departAt)` — you must reach the airport by then. |
| Last Day opens | Unchanged. |

A late arrival makes day 1 **shorter**, not later. Sliding the close time to preserve a full budget
would hand a traveller who lands at 22:00 a day ending at 08:00, which is the "decorative" outcome
#156's acceptance criteria name and reject.

Where an edge time makes a window backwards, it is clamped rather than emitted reversed — the same
defence `dayWindowsFor` already applies to overnight opening hours under ADR-0023 §3, and for the
same reason: VROOM rejects a backwards window as an input error.

An edge whose value carries no time constrains nothing. It still anchors the geography, which is the
larger half — routing from Haneda rather than from a hotel changes the plan whether or not the clock
is known.

### 6. Authored Transit is a trip edge; a station the optimizer passes through is a different concept

Both are `kind: transit`. They share the primitive because a station is a place, and ADR-0015's one
place primitive is not worth breaking for a provenance difference. But they sit on opposite sides of
the solve and the distinction is recorded so the later work does not smear into this one:

- **Authored Transit** is stored, is written by a traveller, and is an optimizer **input**. Under
  §2's uniqueness invariant there are at most two per Trip.
- **Surfaced Transit** is a station a Journey's rail Path passes through. It is derived from a
  Journey — which CONTEXT.md defines as not stored and not scored, and which the optimizer never
  sees — so it is an optimizer **output**, projected at read time and never written.

**Surfaced Transit is not built here**, and materializing one as a Location row is rejected outright
in §Alternatives: it would write the optimizer's output back into its own input, so a re-solve would
no longer be a function of what the traveller provided. It is also blocked four layers down, in a
provider that currently discards the station identity it computes.

The consequence to accept knowingly: **a traveller cannot act on a surfaced station.** "I pass
through Kyoto Station anyway, put lunch there" needs a promote-to-authored gesture, which is a real
future flow and a deliberately one-directional door.

### 7. The input surface is two slots in the Manifest

The Manifest's Transit group renders **always**, not only when it is non-empty, and shows an
**Arriving** slot and a **Departing** slot. Each slot picks an existing Location and edits a time.

This follows the Lodging night strip: a purpose-built gesture in the Manifest that writes a
constraint field, rather than a generic field editor in the Inspector. The discoverability argument
is decisive — an empty slot is the only thing that can tell a traveller the capability exists, and a
field on a Location they have not created yet cannot. The `PATCH` route's whitelist gains the two
fields.

Because the slots are the only writer and each holds one Location, §2's uniqueness invariant is
maintained by the surface rather than defended against it.

### 8. Two anchor derivations, renamed, sharing one rule

`deriveDays` (the projection the Timeline and Map read) and `deriveTripDays` (the solver's request
input) both compute wake and sleep anchors from Lodgings. Both must learn the trip edges, or day 1
will start at Haneda in the Plan and at a Lodging on the screen.

They are **not** merged. They answer different questions — one reads a Plan that exists and returns
Locations for rendering; the other builds input before a Plan exists and returns matrix indices and
second-precision windows. Merging them would produce one function serving two consumers with
different return shapes. Instead a single shared rule, `anchorsOnDate`, answers "which Location
bookends the start and end of this date," and both call it.

Their names are corrected to carry the distinction:

| Before | After |
| --- | --- |
| `deriveDays` | `deriveTripPlanDays` |
| `deriveTripDays` | `buildSolverInputDays` |
| `TripDay` (type) | `SolverInputDay` |
| — | `anchorsOnDate` (new; the shared rule) |

`deriveTripDays` never derived anything from stored facts — it builds request input, and `build*`
matches the local idiom in `request.ts`. `TripDay` was actively misleading: it is the solver's day,
not the Trip's. `DerivedDay` is left alone; "derived" is ADR-0015's deliberate signal that
day-presence is never stored, and `deriveTripPlanDays` carries that signal at every call site.

## Alternatives considered

- **Store `arrivalLocationId` / `departureLocationId` on `Trip`.** The shape ADR-0015 deleted.
  Rejected, and the decisive point is that it is not an alternative to the times but a layer on top
  of them: the times are required regardless, because they constrain the Day window, so the pointer
  adds a second encoding of a fact the fields already carry. Two encodings can disagree — a pointer
  at a Location with no time, at a Location whose time was later cleared, or at a deleted Location —
  and each disagreement needs a reconciliation rule. It is also a foreign key with a lifecycle where
  §2's invariant has none, and it would put an exception into CONTEXT.md's "Role (derived)" entry,
  which is the same rule that makes Lodging work.
- **Derive the edges by rule: the earliest `arriveAt` on day 1, the latest `departAt` on the last
  day, guarded by date.** This session's first design. Rejected on simplification review: five rules
  reconstructing at read time what the write path holds unambiguously, carrying a wrong-airport
  failure mode on any recorded layover and a silent drift whenever the Trip's date range moves.
  §2's invariant deletes all five.
- **Auto-infer the edges from the earliest and latest Transit Location with no designation at all.**
  ADR-0015 §4's literal rule. Rejected: it cannot distinguish a layover, a mid-trip transfer, or a
  Location whose time is not filled in yet from a genuine trip edge, and it makes the edges move as
  a side effect of unrelated edits.
- **One `scheduledAt` field instead of two.** Rejected: see §1. It cannot say whether the moment is
  an arrival or a departure without inference from trip position, and it cannot express a round trip
  through one airport on one Location.
- **A nullable time-of-day instead of a date-or-datetime.** Rejected: two representable states
  against the three the domain needs. It cannot distinguish "not an edge" from "an edge whose time
  is unknown."
- **Authored mid-trip Transit, rendered as a display-only marker on its Day.** Held briefly, then
  rejected with §2. Under uniqueness it is unrepresentable, and it was answering a hypothetical
  rather than a demand: a traveller supplies Lodging, the two travel edges, and Activities, and a
  station in the middle of a trip is something the *optimizer* surfaces rather than something the
  traveller authors. The real story for a mid-trip station is §6's surfaced Transit.
- **Materializing a surfaced station as a stored Location.** Rejected on idempotency: the
  optimizer's output would become its own input, so successive solves of an unchanged Trip could
  diverge, and the divergence would be silent and compounding.
- **Keeping surfaced stations entirely outside the Location primitive**, as rail-graph vocabulary
  (CONTEXT.md's *stop node* / *station cluster*) surfaced as a property of the Journey. Defensible,
  and rejected only narrowly: a station is a place, and the Timeline would otherwise render two
  things that are identical to a traveller through two different type paths.
- **Unifying `deriveDays` and `deriveTripDays` into one derivation.** Rejected: see §8. They share a
  rule, not a return shape.

## Consequences

- **Persistence.** `Location` gains nullable `arriveAt` and `departAt` text columns, plus two
  partial unique indexes on `(tripId)` where each is not null. Pre-launch: recreate the schema, no
  data migration (no-backwards-compat).
- **The write path owns the invariant.** Setting an edge clears any prior holder in the same
  transaction. Changing the Trip's date range rewrites the stored edge dates. Both belong in the one
  place that already owns Location writes.
- **`Transit` stops being an empty marker type.** `type Transit = LocationBase & { kind: "transit" }`
  gains its constraint fields, and ADR-0015's first parked bill is paid. The remaining parked bills —
  the optimizer *using* mid-trip scheduled transit, partial re-optimization, same-place multiplicity
  — are untouched and stay parked.
- **`rolesOf` can finally return `arrival` and `departure`.** It currently returns only `["lodging"]`
  with a comment that the other roles "are not produced here yet."
- **A latent defect is closed on the way past.** `solver.ts`'s `!isLodging` candidate filter becomes
  an `isActivity` test. Without this, the first Transit Location a traveller creates is sent to VROOM
  as a job to place.
- **`DerivedDay.startAnchor` and `endAnchor` widen** from `Lodging | null` to
  `Lodging | Transit | null`. This ripples into `MapView.tsx`, where the anchors' coordinates draw
  the Day line. `deriveDays` has six call sites across the store, `tripMetros`, and three components;
  `deriveTripDays` is private to `request.ts` with one.
- **`CONTEXT.md` changes.** The **Transit (kind)** entry names the two fields and drops "The Trip's
  arrival/departure are *derived* from the earliest/latest transit" in favour of the uniqueness
  invariant. **Anchor (derived)** admits a Transit Location at the trip edges. **Role (derived)**
  keeps its "never stored" rule, which this ADR does not breach. A note records the authored-versus-
  surfaced distinction from §6.
- **The feature is verifiable by test, not by eye.** VROOM returns per-step arrival times and
  `response.ts` parses them into `PlacementTiming`, but `optimize.ts` persists only the Placement
  order, so nothing renders them. A day 1 that correctly opens at a 14:00 landing is invisible in the
  app. That is the same ground as issues
  [#155](https://github.com/Tyler-Reagan/trip-kraken/issues/155) and
  [#109](https://github.com/Tyler-Reagan/trip-kraken/issues/109), and is deliberately not widened
  into here.
- **Surfaced Transit gets its own issue**, and probably its own ADR — no existing decision covers a
  derived-from-Plan entity entering the read model as a Location. It is blocked on
  `osmTransitProvider` recording the station identity it currently discards, on the registry's
  deferred per-Path chaining, and on a first consumer for `describeJourney`.
- **Cross-day sequencing stays unaddressed.** ADR-0023's Consequences recorded that VROOM's vehicles
  are unordered and that pacing needs its own ADR. Trip edges do not change that; they fix the
  boundary, not the interior.
