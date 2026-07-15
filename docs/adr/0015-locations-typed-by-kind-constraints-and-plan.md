# ADR-0015: Locations typed by kind; temporal facts as fields; the plan as day-clustered placements

- **Status:** Accepted
- **Date:** 2026-06-28
- **Supersedes:** ADR-0006 (lock-and-fill), ADR-0014 (Stay entity + reference-derived roles)
- **Superseded by:** —
- **Amends:** ADR-0002 (Location gains `kind`), ADR-0003 (constraint-field inputs, `Placement` output, no locks), ADR-0005 (arrival/departure fold into Transit; edges derived), ADR-0008 (schema reshaped), ADR-0010 (Manifest by kind)
- **Amended by:** ADR-0020 (concrete optimizer consumption of the multi-lodging model: per-activity
  eligible-day masks, per-cluster coverage, `unplaced`)
- **Constrained by:** ADR-0001 (intent ranks above optimality)

## Context

ADR-0014 collapsed *lodging* and the *timed Stay* into a Location + a dated `Stay` + roles
derived from references. That removed a class of recurring bugs and stands as progress. But
building the Manifest/Timeline surface (ADR-0010, Phase C) and validating it by hand exposed that
the model still carries structure no longer paying rent:

1. **"Lodging" is modeled as a role derived from a `Stay` reference** — yet a place's
   lodging-ness is just *what kind of place it is*. The reference-derivation is an indirection
   around an intrinsic property.
2. **A separate `Stay` entity exists only to carry dates** (and a theoretical repeat-stay). Its
   single load is the date range.
3. **The schedule keeps `Stop` rows with `locked` state and a reconcile diff** (ADR-0006) whose
   purpose was forcing lodging into stop-rows across re-optimize — load that vanished once lodging
   left the plan.
4. **Trips support both real dates and abstract day-numbers** — a dual mode fundamentally
   incompatible with date-sensitive places (you cannot place a check-in or a flight on "Day 2").

Underneath, the model has been conflating two orthogonal axes: **what a place intrinsically is**
(a taxonomy) and **how it is used in this trip** (a plan). Separating them removes the redundancy
and is the spine of this ADR.

## Decision

### 1. One place primitive, typed by `kind`

`Location` is the only place object. It carries a discriminant **`kind ∈ { activity, transit,
lodging }`**, with leaf interfaces (`Restaurant`, `Airport`, `Hotel`, …) added **lazily** — only
when a leaf carries fields of its own. We model this as a **discriminated union over a single
table** (`kind` column, subtype columns nullable) and consume it through **functions-over-typed-
records that narrow on `kind`** — never runtime classes, never table-per-type. Subtype *depth*
(restaurant vs. retail vs. airport) stays in the Places `categories` data, not in the type system.

A hotel **is** a Location: every `f(location)` works on it; lodging-specific logic narrows on
`kind`. No duplicated handling per "kind."

### 2. The seam — constraint vs. plan

Two kinds of information, kept apart:

- **Intrinsic temporal facts are fields on the typed Location** (optimizer *inputs*): a Lodging's
  `checkInDate` / `checkOutDate`; a Transit's times (exact shape **parked**, see below). A booking
  is Jun 24→27 and a flight departs 14:00 *regardless of planning* — they are facts about the
  place, so they live on it.
- **The Plan is the optimizer's output**: stored **`Placement`s** `{ date, locationId, order }`,
  **clustered by Day**. Only **activities** are placed.
- **Lodging/transit day-presence is a derived projection** of their fields across the dates they
  cover — never a stored placement. A one-night stay touching two days is *projection*, not
  multiplicity (this generalizes ADR-0014's "lodging is a derived anchor, not a stored stop").

### 3. One temporal axis

Every `Trip` has a **required date range**; day-numbers are a *derived label* over it. This kills
the date/day-number dual mode. **Days** are a first-class clustering of the Plan: placements
bucket by date, and a day may carry a label.

### 4. Roles are derived adjectives, never stored

"lodging / arrival / departure / candidate / anchor" are *computed reflections*, not stored state.
No `isLodging`, no role column, no `Lodging` entity. **Trip edges** (arrival/departure of the whole
trip) are **derived** from the earliest/latest transit, not stored singletons.

### 5. Remove `Stay`, locking, and multiplicity

- **`Stay` dissolves** into `Lodging` fields. Multiple lodgings in a trip = multiple
  `kind: lodging` Locations, each with its own dates.
- **Locking is removed**: `locked`, the lock UI, `LockViolationError`, and the lock-preserving diff
  in `reconcileItinerary`. Re-optimize is **wholesale and explicit** — it regenerates all
  placements; manual edits persist until the next optimize.
- **Same-place multiplicity is unsupported**: one continuous binding per constraint (no
  check-out-then-re-check-in, no repeat layover). Revisit only if it ever earns its keep.

**Vocabulary invariant:** entities are nouns (`Trip`, `Location`, `Placement`); roles are
adjectives. The stored activity unit is renamed `Stop` → **`Placement`**.

## Alternatives considered

- **Keep ADR-0014's `Stay` + reference-derived roles.** Rejected: "lodging" is a *kind*
  (intrinsic), not a role derived from a reference; `Stay` existed only to carry dates, which fold
  onto the typed Location. With multiplicity out of scope, the separate entity and the
  role-derivation are structure paying no rent.
- **Class/interface inheritance with runtime instances, or table-per-subtype.** Rejected:
  re-introduces specialized shapes and a row→object hydration layer. A discriminated union over one
  table gives the same polymorphism over plain rows.
- **A type per category (`Restaurant`, `Airport` minted up front).** Rejected: the taxonomy is the
  open-ended Places category list; a type per leaf is unmaintainable and turns "add a category" into
  a code change. Leaves are added only when they carry a field.
- **Collapse the schedule into a `dayNumber` field on Location.** Rejected: transit hubs and
  central places legitimately recur across days; the plan must be a recurrence-capable placement
  structure, not a single field.
- **Keep locking / lock-and-fill (ADR-0006).** Rejected: its load was pinning forced stay-rows
  across re-optimize; with stays gone from the plan it is vestigial. Partial re-optimization, if
  wanted, returns later as its own feature — independent of a per-placement lock.
- **Keep the date / day-number dual mode.** Rejected: date-sensitive places can't sit on an
  abstract day; forcing a real date range removes the split handling at its source.

## Consequences

- **Persistence (ADR-0008):** `Location` gains a `kind` column and nullable kind-specific constraint
  columns (lodging `checkInDate` / `checkOutDate`; transit fields parked). The `Stay` table is
  removed. `ItineraryStop` → `Placement` `{ date, locationId, order }`; `locked` dropped. `Trip`
  start/end dates become **required**; `numDays` derives; `arrivalLocationId` / `departureLocationId`
  are removed (edges derived). `ItineraryDay` likely dissolves to derived dates — **open bill:** where
  a day *label* lives (a thin `Day` row vs. a map on `Trip`). Pre-launch: recreate the schema, no
  data migration (no-backwards-compat).
- **Derivation:** lodging/transit anchors and day-presence derive from constraint fields by one
  projection rule; ADR-0014's night-range / Stay machinery and the `getTripWithDetails` anchor logic
  collapse into it. `reconcileItinerary`'s lock-preserving diff dissolves; `optimize` simply replaces
  the placement set.
- **Types (`src/types`):** `Location` becomes a discriminated union (`Activity | Transit | Lodging`)
  tagged by `kind`; lodging carries dates; role helpers compute the derived adjectives. The `Stay`
  type is removed.
- **Optimizer (ADR-0003):** consumes constraint fields as inputs (lodging dates anchor nights,
  transit times anchor edges) and emits `Placement`s. Travel-day routing and edge-anchoring are
  re-expressed over the projection rather than stored Stays/edges; lock handling is removed.
- **Manifest / onboarding (ADR-0010):** the Manifest groups Locations by `kind`; the Timeline is the
  day-clustered Plan. The create-and-discover surface aligns with this model; a place is never hidden
  for carrying a role.
- **Amends ADR-0002** (Location gains `kind`; place taxonomy), **ADR-0005** (arrival/departure fold
  into Transit; trip edges derived), **ADR-0006** (locking removed). **Supersedes ADR-0014** — flip
  its header to *Superseded by: ADR-0015*.
- **`CONTEXT.md` glossary:** replace `Stay` with the `kind` taxonomy + `Placement`; add the
  constraint-vs-plan seam; record that "lodging / arrival / candidate" are derived adjectives.
- **Parked bills (must not be precluded):** the exact transit constraint-field shape; the optimizer
  *using* mid-trip scheduled transit; partial re-optimization; same-place multiplicity.
