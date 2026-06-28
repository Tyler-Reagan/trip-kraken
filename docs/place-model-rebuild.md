# Place & Plan Model Rebuild — Status & Roadmap (ADR-0015)

> **Handoff doc.** To resume cold, read this + [ADR-0015](adr/0015-locations-typed-by-kind-constraints-and-plan.md) + [`CONTEXT.md`](../CONTEXT.md). As of 2026-06-28.

## TL;DR

**ADR-0015 is the authoritative model**; all preceding docs and issues have been reconciled so
nothing stale outranks it. The **code still implements the old model** (Stay table, `Stop` + locks,
reconcile, datetime/day-number duality, stored trip edges). The work ahead is a **layer-by-layer
rebuild of the code to ADR-0015**, sequenced as **five stacked PRs, D1→D5**, off `main`.

---

## Where we are

### The model (ADR-0015 — Accepted, authoritative)

- **One primitive:** `Location`, typed by `kind` (`activity` / `transit` / `lodging`, leaf types
  added lazily). A **discriminated union over a single table**, consumed via
  **functions-over-typed-records** that narrow on `kind` — no runtime classes, no table-per-type.
- **The seam — constraint vs. plan:** intrinsic temporal facts are **fields on the typed Location**
  (optimizer *inputs*) — lodging `checkIn`/`checkOut` dates, transit times (shape parked). The
  **Plan** is the *output*: stored **`Placement`s** `{ date, locationId, order }`, clustered by Day.
- **Presence is projection:** lodging/transit day-presence is *derived* from their fields across the
  dates they cover — never stored. A one-night stay touching two days is projection, not multiplicity.
- **One temporal axis:** every Trip has a **required date range**; day-numbers derive.
- **Derived, never stored:** roles (`lodging`/`arrival`/`candidate`), anchors, and trip edges
  (earliest/latest transit).
- **Removed:** the `Stay` entity (dates fold onto `Lodging`), **locking**, same-place
  **multiplicity**, the date/day-number dual mode, stored roles/`isLodging`, stored edges.

Glossary: [`CONTEXT.md`](../CONTEXT.md). Visual brief: `scratchpad/trip-model-brief.html`.

### Docs reconciled (nothing stale outranks 0015)

- **Superseded by 0015:** ADR-0006 (lock-and-fill), ADR-0013, ADR-0014 — status + index rows flipped.
- **Amended by 0015** (cross-ref headers): ADR-0002, 0003, 0005, 0007, 0008, 0010, 0011, 0012.
- **`CONTEXT.md`** rewritten to the kind taxonomy + `Placement` + constraint-vs-plan seam.
- **Issues:** #50 (lock dialog) and #19 (day-count suggestion) **closed** as won't-do; **#21**
  (→ parked partial re-optimization), **#20** (stop→placement; notes on Location), **#17**
  (transit as a `kind`) **reframed** under 0015.

### The gap — what the code still does (and D1–D5 replaces)

| Concern | Code today (old model) | Lives in |
|---|---|---|
| Place type | flat `Location`, no `kind` | `schema.ts`, `types` |
| Lodging | `Stay` table `{lodgingLocationId, checkInDate, checkOutDate}` | `schema.ts`, `setStays`, `StayEditor` |
| Schedule | `ItineraryStop {dayId, ord, locked}` + `ItineraryDay` | `schema.ts`, `reconcileItinerary` |
| Trip edges | stored `arrivalLocationId` / `departureLocationId` | `schema.ts`, `setTripEndpoints` |
| Time axis | `numDays` + optional `startDate` (dual mode) | `schema.ts`, `updateTrip` |
| Manual intent | `locked` + `reconcileItinerary` diff + `LockViolationError` | `db/index.ts`, lock UI |

---

## Where we're going — the D1→D5 rebuild

### Layer changes (old → ADR-0015)

| Layer | Old | Target |
|---|---|---|
| Schema | `Location` (no kind); `Stay`; `ItineraryStop{dayId,ord,locked}`; `Trip{numDays,startDate?,edges}`; `ItineraryDay` | `Location += kind` + lodging date fields; **no `Stay`**; `Placement{date,locationId,order}`; `Trip{startDate,endDate}` required, **no edges/numDays**; `ItineraryDay` dissolves (labels → map on `Trip`) |
| Types | flat `Location`, `Stay`, `LocationRole` | union `Activity\|Transit\|Lodging`; `Placement`; role/anchor **helpers** |
| Derivation | `Stay`→night-ranges; anchors by date rule; reconcile diff | projection of constraint-fields across covered dates; edges from earliest/latest transit |
| Optimizer | night-ranges + edges + lock honoring | constraint-field inputs → `Placement`s by day; **no locks**; reconcile dissolves |
| UI | `StayEditor`, lock toggles, `ScheduleView`/`DayCard`/`Unassigned` | **Manifest** (Locations by kind, inline edit) + **Timeline** (day-clustered placements + projected bookends) |

### Slices (stacked, bottom-up — off `main`)

| # | Slice | Scope | Repo state after |
|---|---|---|---|
| **D1** | **Engine** | `schema.ts` (kind, fold lodging dates, drop `Stay`, `Stop`→`Placement`, required dates, drop edges/`Day`); `types`; db repository (projection-based `getTripWithDetails`, kind-aware place CRUD, drop `setStays`/lock/reconcile); regenerate migration; rewrite `lodging.test.ts` → `model.test.ts` | `src/lib/**` + tests **green**; `src/app`/`src/components` **tsc-red** |
| **D2** | **Optimizer** | `src/lib/optimizer.ts`: lodging dates → night anchoring, transit → edges, as inputs; emit `Placement`s; travel-day/edge routing over projection; remove lock handling; optimizer tests | engine fully green |
| **D3** | **Store + API** | `tripStore.ts` + `src/app/api/**`: drop `saveStays`/lock/move-with-reconcile; add forced-date trip creation, kind-aware add, lodging-date + placement edits | store/API green; components red |
| **D4** | **Manifest** | kind-grouped inventory + role-aware inline editing (lodging dates, exclude, duration); forced trip date range on create; **retire** `StayEditor` + manual `AddLocationModal` bits; search-add assigns kind | Manifest demoable |
| **D5** | **Timeline + cleanup** | day-clustered placements + projected lodging/transit bookends; rework/retire `ScheduleView`/`DayCard`/`UnassignedCard`; `MapView`; delete lock UI + dead reconcile paths; `knip`/`build` clean | **whole app green + demoable** |

### The honest caveat

This is a **model swap, not a feature-add** — so unlike the Phase C stack it is **not incrementally
demoable**. Between D1 and D5 the app does not fully run; `tsc` goes fully green again only at **D5**.
Chosen strategy: **(A) stacked layer-PRs** D1→D5, each a coherent reviewable layer, mid-stack
intentionally mid-rebuild.

### Locked decisions

- **Sequencing:** (A) stacked PRs, D1→D5.
- **Day labels:** a small `{ date → label }` map on `Trip` (not a `Day` entity).
- **`kind`:** an **explicit** stored field, **default `activity`**, elevated to `lodging`/`transit`
  by the gesture that attaches its constraint (dates / transit time). `categories` (the Google
  Places `types[]`, stripped of `point_of_interest`/`establishment`) stays pure enrichment metadata
  — available later as an optional "looks like a hotel" *hint*, never the authority for `kind`
  (it's `null` for My Maps/manual until enriched, and async).

### Reused / retired

- **Reused:** the Phase C proto-Manifest (`candidateLocations` in `TripClient`, search-add in
  `AddLocationModal`) graduates into the real D4 Manifest.
- **Retired:** `StayEditor`, lock toggles, `reconcileItinerary`, `LockViolationError`, the
  StayEditor date-pair pickers, `setStays`/`setTripEndpoints`.

---

## Resume instructions (cold start)

1. Read [ADR-0015](adr/0015-locations-typed-by-kind-constraints-and-plan.md) + [`CONTEXT.md`](../CONTEXT.md) + this doc.
2. Cut **D1** off `main`: `schema.ts` → `types` → db repository → `model.test.ts`. Regenerate the
   Drizzle migration and recreate `db/dev.db` (pre-launch: no data migration, per no-backwards-compat).
3. Goal for D1: `npm test` + `tsc` green for `src/lib/**`; the UI is intentionally tsc-red until D3–D5.
4. Open as the first stacked PR; proceed D2→D5, each cut off the previous, app green at D5.
