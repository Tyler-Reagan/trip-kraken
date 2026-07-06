# Place & Plan Model Rebuild — Status & Roadmap (ADR-0015)

> **Status: COMPLETE.** The D1→D5 rebuild shipped as five stacked PRs (#70–#74), all merged to
> `main` on 2026-06-29. `tsc`/`next build`/`knip` clean, tests green, and the create→add→lodging→
> optimize→Itinerary flow is browser-verified. This doc is kept as the record of the rebuild;
> [ADR-0015](adr/0015-locations-typed-by-kind-constraints-and-plan.md) + [`CONTEXT.md`](../CONTEXT.md)
> remain the authoritative model.

## TL;DR

**ADR-0015 is the authoritative model and the code now implements it.** `Location` is typed by
`kind`, the plan is stored as `Placement`s, and day-presence / trip edges are derived by projection.
**Removed:** the `Stay` table, locking, `reconcileItinerary`, stored trip edges, and the
datetime/day-number duality. The rebuild ran as **five stacked layer-PRs, D1→D5**, off `main`.

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

| # | Slice | Scope | PR |
|---|---|---|---|
| **D1** ✅ | **Engine** | `schema.ts` (kind, fold lodging dates, drop `Stay`, `Stop`→`Placement`, required dates, drop edges/`Day`); `types` + projection helpers; db repository (projection-based `getTripWithDetails`, kind-aware CRUD, drop `setStays`/lock/reconcile); regenerate migration; `lodging.test.ts` → `model.test.ts` | #70 |
| **D2** ✅ | **Optimizer** | lock-free `optimizer.ts`; new `optimize.ts` orchestrator (lodging dates → night-ranges → solver → `Placement`s); optimizer tests. Transit→edges left dormant (transit fields parked) | #71 |
| **D3** ✅ | **Store + API** | `tripStore.ts` + `src/app/api/**`: drop `saveStays`/lock/reconcile; forced-date creation, lodging-date + placement edits (`addPlacement`/`movePlacement`/`removePlacement`/`clearLodging`); `stops/`→`placements/`, `stays/import`→`lodging/import` | #72 |
| **D4** ✅ | **Manifest** | kind-grouped inventory + inline editing (lodging dates, exclude); forced trip date range on create; **retired** `StayEditor` + `LodgingSummary`; search-add via `AddLocationModal` | #73 |
| **D5** ✅ | **Timeline + cleanup** | `deriveDays` projection; rebuilt `ScheduleView`/`DayCard`/`UnassignedCard`/`MapView`/`NearbyDrawer` onto placements + projected lodging bookends; **optimistic updates**; deleted lock UI/dead paths; `knip`/`build` clean | #74 |

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

## Done — what's next

The rebuild is on `main` (D1–D5, #70–#74, merged 2026-06-29). The model now matches ADR-0015
end-to-end. **Parked by ADR-0015** (deliberately not built; must not be precluded):

- **Transit constraint fields** — `kind: transit` exists but carries no fields yet, so the
  optimizer's trip-edge (arrival/departure) routing stays dormant until a shape lands.
- **Partial re-optimization** — re-optimize is wholesale; per-region/partial is a later feature.
- **Same-place multiplicity** — one continuous binding per constraint; revisit only if it earns it.

Follow-on UI polish noticed during verification (lodging-date *set* and placement drag still
reloading instead of patching local state first) is **resolved as of 2026-07-06**. `movePlacement`,
`addPlacement`, and `saveLodgingDates` in `tripStore.ts` are now optimistic, matching
`updateLocation`/`removePlacement`. The reorder/re-densify algorithm (ADR-0015 §2) that
`movePlacement`/`addPlacement` depend on is extracted into `src/lib/placementOrdering.ts`, a pure
module shared by both the client (optimistic patch) and the server (`src/lib/db/index.ts`, which
was refactored to call it too) so the two can't drift — covered by
`src/lib/placementOrdering.test.ts`. `saveLodgingDates` rolls back via `reload()` on a failed save.
Drag-and-drop (`movePlacement`) was verified by code/tests + a manual state check (post-drag reload
showed no drift) rather than a live drag, since native HTML5 drag-and-drop can't be reliably
automated in a browser tool — worth a human pass in the browser to be fully sure. This closes out
the last open item under this doc; D1–D5 plus this follow-on are all shipped.
