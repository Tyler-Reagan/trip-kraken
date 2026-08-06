# VROOM as trip-kraken's optimizer: what it replaces, and what it does not

- **Date:** 2026-08-06
- **Status:** Research findings. Not an ADR — the decisions below need one (or amendments to
  ADR-0003/0016/0017/0020) before implementation.
- **Code read at:** `main` (`a7e9051`). `src/lib/solver.ts` (169 lines), `src/lib/optimizer.ts`
  (581 lines), `src/lib/objective.ts`, `src/lib/travelMatrix.ts`, `src/lib/optimize.ts`,
  `src/lib/db/schema.ts`.
- **VROOM version read:** `master` as of 2026-08-06; latest release
  [`v1.15.0`](https://github.com/VROOM-Project/vroom/releases) (2026-03-12). `vroom-express`
  latest release `v0.12.0` (2023-11-16). Sources are VROOM's own
  [`docs/API.md`](https://github.com/VROOM-Project/vroom/blob/master/docs/API.md), its C++ source,
  its [wiki](https://github.com/VROOM-Project/vroom/wiki), `vroom-express`, `vroom-docker`, and
  first-party license texts. No third-party writing is cited.
- **Builds on:** `docs/research/osrm-viability-149.md` (OSRM findings are not re-derived here).

---

## Recommendation

**Adopt VROOM as the Decision layer. It deletes roughly 500 of the 750 lines in
`optimizer.ts` + `solver.ts`, plus most of `objective.ts` and the optimizer's use of
`travelMatrix.ts`.** The fit is genuinely good: our problem is a multi-depot VRPTW with per-task
service durations and per-task eligibility, and that is precisely the problem class VROOM names
([README](https://github.com/VROOM-Project/vroom/blob/master/README.md): "MDHVRPTW (multi-depot
heterogeneous vehicle VRPTW)").

The modelling is: **one VROOM `vehicle` per trip-day**, `start` = the lodging you woke at, `end` =
the lodging you sleep at, `time_window` = that day's waking hours as absolute Unix seconds. Each
activity is a `job` with `service` = `visitDuration`, `time_windows` = every interval that place
is open across the whole trip, and `skills` = its ADR-0020 eligible-day mask. Days, lodging
anchors, travel-day open paths, eligible-day masks, and orphaned-metro rejection all fall out of
VROOM's existing vocabulary without a single custom term.

**Four things you must not assume, in descending order of how much they'd hurt:**

1. **VROOM's objective actively prefers to use fewer days.** Its solution comparator is a fixed
   lexicographic tuple whose fourth tier is *minimize used vehicles*
   ([`solution_indicators.h`](https://github.com/VROOM-Project/vroom/blob/master/src/structures/vroom/solution_indicators.h)),
   and its third tier (cost) already rewards emptying a day, because every used day-vehicle pays a
   lodging→first-stop and last-stop→lodging leg. Left alone, VROOM will cram a 12-stop trip into
   four days and leave three empty. There is **no load-balancing objective and no way to add one
   through the API**. The only levers are hard caps: `max_tasks`, `max_travel_time`,
   `max_distance`, and a tight per-day `time_window`. §9.1.
2. **Time windows are hard, and the failure mode is "unassigned", not "scheduled late".** In
   default solving mode a task whose windows can't be met on any vehicle is simply dropped —
   `Input::set_extra_compatibility` marks it incompatible with every vehicle before the search
   even starts
   ([`input.cpp`](https://github.com/VROOM-Project/vroom/blob/master/src/structures/vroom/input/input.cpp)).
   This is *more* aligned with ADR-0016's lexicographic gate than our current soft
   `windowPenaltyKm` is, but it changes what the user sees: a museum that can't be fitted
   disappears from the plan instead of appearing with a violation badge. §3.3, §9.2.
3. **`violations` is always empty in default solving mode.** API.md says so outright: "When using
   regular optimization, violations are still reported for consistency, but are guaranteed to be
   'void'". ADR-0017's violation surfacing therefore does **not** come free — it needs either a
   second `-c` (plan-mode) pass over the solved route, or our own evaluator. §4.3, §9.3.
4. **`-g` geometry cannot serve Path narration.** VROOM asks OSRM's `route` service with
   `steps=false&overview=full` and returns `routes[0].geometry` verbatim — one encoded
   polyline (precision 5) for the entire day's route, with no per-step, per-leg, or per-mode
   breakdown
   ([`osrm_routed_wrapper.cpp`](https://github.com/VROOM-Project/vroom/blob/master/src/routing/osrm_routed_wrapper.cpp),
   [`http_wrapper.h`](https://github.com/VROOM-Project/vroom/blob/master/src/routing/http_wrapper.h)).
   ADR-0022's "a Path ends at every discernible shift" needs `steps=true`, which VROOM never
   requests. We still own `describeJourney`. §4.4.

### The "customizing optimizations" answer

vroom-project.org's third feature card reads, in full: *"Customize your optimizations — Build
optimization programs with the specific variables important for your business. It's open source,
so build your own extensions if needed."* ([vroom-project.org](http://vroom-project.org/), read
2026-08-06).

That is a claim about the **input vocabulary**, not about a tunable objective. Read against the
source, it means exactly three things:

- **Rich per-vehicle and per-task constraint fields** you compose to express your problem:
  `costs {fixed, per_hour, per_task_hour, per_km}`, `skills`, `priority`, `capacity`,
  `max_tasks`, `max_travel_time`, `max_distance`, `speed_factor`, `breaks`, `time_windows`,
  `setup`/`service` (and, since v1.15.0, `setup_per_type`/`service_per_type`). §1.
- **A custom `matrices.costs` array** — an arbitrary per-pair cost, used in *all route cost
  evaluations*, independent of the `durations` matrix used for timing checks
  ([API.md#matrices](https://github.com/VROOM-Project/vroom/blob/master/docs/API.md#matrices)).
  **This is the sharpest lever available to us** and the one worth designing around: it lets the
  Facts layer say "this A→B hop costs 40 minutes of clock time *and* we'd rather you didn't take
  it" without lying about the clock. §6.
- **Fork the C++.** The objective function itself is not exposed. It is compiled into
  `SolutionIndicators::operator<` as a fixed seven-element lexicographic tuple. §2.

What it does **not** mean: there is no objective-weight parameter, no per-request objective
selection, and no "minimize vehicles vs minimize travel" switch. The closest thing is
`costs.fixed`, which adds a per-used-vehicle constant into `eval.cost`
([`helpers.cpp`](https://github.com/VROOM-Project/vroom/blob/master/src/utils/helpers.cpp),
`route_eval_for_vehicle`: `eval.cost += v.fixed_cost()` for non-empty routes) and so biases the
third tier toward fewer vehicles. There is no inverse lever biasing toward *more*.

The honest summary: the phrase sharpens the plan less than hoped in the direction the user
guessed (a tunable objective) and more than hoped in a direction they didn't (a custom cost
matrix decoupled from durations).

---

## What this deletes

Every row is against `main`. "Delete" means the code stops existing; "rebuild" means the concept
survives but its implementation moves.

### Deleted outright — VROOM does this

| Ours (`optimizer.ts` / `solver.ts`) | Replaced by | Evidence |
| --- | --- | --- |
| `kMeans`, `seedCentroids`, `nearestCentroidIndex`, `STAY_ANCHOR_WEIGHT`, `Centroid` (~120 lines) | Assignment of `jobs` to `vehicles`. One vehicle per trip-day; VROOM decides which day each activity lands on. | [README](https://github.com/VROOM-Project/vroom/blob/master/README.md) "MDHVRPTW"; [API.md#vehicles](https://github.com/VROOM-Project/vroom/blob/master/docs/API.md#vehicles) |
| `nearestNeighborOrder` (~48 lines) | VROOM's construction heuristics (up to 32 concurrent parameterised searches at `-x 5`) | [`helpers.h`](https://github.com/VROOM-Project/vroom/blob/master/src/utils/helpers.h) `get_nb_searches`; [`vrp.h`](https://github.com/VROOM-Project/vroom/blob/master/src/problems/vrp.h) |
| `twoOpt` (~44 lines) | VROOM's local-search operator set — `two_opt`, `reverse_two_opt`, `intra_two_opt`, `or_opt`, `relocate`, `exchange`, `cross_exchange`, `swap_star`, `route_split`, `unassigned_exchange`, `priority_replace`, … | [`src/problems/vrptw/operators/`](https://github.com/VROOM-Project/vroom/tree/master/src/problems/vrptw/operators) |
| `sequenceDay`'s cheapest-insertion branch (~32 lines) | Same. VROOM makes no distinction between a round-trip day and an open path; `start` and `end` are independent per vehicle, and either may be omitted. | [API.md — `vehicle` locations](https://github.com/VROOM-Project/vroom/blob/master/docs/API.md#vehicle-locations) |
| `simulateArrivalAt` (~17 lines) | `step.arrival` on every output step | [API.md#steps](https://github.com/VROOM-Project/vroom/blob/master/docs/API.md#steps) |
| The `placeable.length <= days` small-N special case (~20 lines) | Nothing — VROOM handles N < D natively (empty routes) | — |
| `seqStart`/`seqEnd` derivation, `EdgeAnchors` routing (~25 lines) | `vehicle.start` / `vehicle.end`. Day 1's start override and the last day's end override become "set that vehicle's `start`/`end` to the edge Location". | [API.md#vehicles](https://github.com/VROOM-Project/vroom/blob/master/docs/API.md#vehicles) |
| `solve()`'s `buildDistanceLookup` call and `precomputedDist` threading (#82's whole fix) | VROOM issues the `table` request itself, once per profile, in parallel across profiles | [`osrm_routed_wrapper.cpp`](https://github.com/VROOM-Project/vroom/blob/master/src/routing/osrm_routed_wrapper.cpp) `build_query`; [`input.cpp`](https://github.com/VROOM-Project/vroom/blob/master/src/structures/vroom/input/input.cpp) `set_matrices` |
| `evaluateDayFeasibility`'s arrival-clock simulation (~35 lines) | `step.arrival`, `step.waiting_time`, `step.setup`, `step.service`, `route.duration` | [API.md#steps](https://github.com/VROOM-Project/vroom/blob/master/docs/API.md#steps) |
| `windowPenaltyKm`, `routeWindowPenalty`, `WINDOW_EARLY_KM_PER_MIN`, `WINDOW_LATE_KM_PER_MIN` (`objective.ts`) | `job.time_windows` — a **hard** constraint, checked as an admission test before search and enforced throughout | [API.md — Time windows](https://github.com/VROOM-Project/vroom/blob/master/docs/API.md#time-windows); [`input.cpp`](https://github.com/VROOM-Project/vroom/blob/master/src/structures/vroom/input/input.cpp) `set_extra_compatibility` |
| `dayBudgetPenaltyKm`, `DAY_BUDGET_KM_PER_HOUR` (`objective.ts`) | `vehicle.time_window` (hard), plus optionally `max_tasks` / `max_travel_time` | [API.md#vehicles](https://github.com/VROOM-Project/vroom/blob/master/docs/API.md#vehicles) |
| ADR-0020's mask plumbing: `eligibleDaysOf`, the `masks` map, `nearestCentroidIndex`'s `mask` parameter (~30 lines) | `job.skills` ⊆ `vehicle.skills`. One skill id per distinct mask group, granted to exactly the day-vehicles in that mask. | [API.md — Skills](https://github.com/VROOM-Project/vroom/blob/master/docs/API.md#skills); [`input.cpp`](https://github.com/VROOM-Project/vroom/blob/master/src/structures/vroom/input/input.cpp) `set_skills_compatibility` |
| The `Unplaced` emission path inside `optimizeItinerary` | `unassigned[]` — array of `{id, type}` plus `description`/`location`/`location_index` when supplied | [API.md#output](https://github.com/VROOM-Project/vroom/blob/master/docs/API.md#output) |
| `DistanceLookup` / `buildDistanceLookup` **as the optimizer's currency** (`travelMatrix.ts`) | Nothing on the road-kind path — VROOM talks to OSRM directly. Survives only as the shape we hand VROOM under `matrices` when the Facts layer is authoritative (rail, Google, haversine). | §6 |

### Rebuilt, not deleted — VROOM has no equivalent

| Ours | Why VROOM can't take it | What we do instead |
| --- | --- | --- |
| `FeasibilityViolation` / ADR-0017 violation surfacing | "When using regular optimization, violations are still reported for consistency, but are guaranteed to be 'void'" ([API.md — Violation](https://github.com/VROOM-Project/vroom/blob/master/docs/API.md#violation)). Only `-c` plan mode populates them, and plan mode requires you to already know the route. | Either (a) accept `unassigned[]` as the whole violation story, or (b) run a second `-c` pass feeding the solved route back as `vehicle.steps`, which softens all constraints and reports `lead_time`/`delay` durations per step. (b) is one extra sub-second call and gives strictly richer output. |
| `Unplaced.reason` ("No lodging covers this area of the trip.") | `unassigned[]` carries no cause. VROOM does not distinguish "skills mismatch" from "time windows impossible" from "would have been assigned but the objective preferred not to". | Derive the reason ourselves from the same inputs (`metroCluster.ts` already computes coverage). Keep `metroCluster.ts` — it *feeds* the skill sets. |
| ADR-0022 `Path[]` decomposition / `describeJourney` | VROOM requests `steps=false`; the returned geometry is a single route-level polyline with no mode tags. §4.4. | Unchanged from `osrm-viability-149.md` §3: our own OSRM `route` call with `steps=true&geometries=geojson`, grouping consecutive steps by `mode`. This is Narration, not Decision — the layering already says so. |
| Round-robin distribution of coordinate-less Locations (`invalid` in `optimizeItinerary`) | VROOM requires either `location` or `location_index` for every task; `-g` additionally errors with "Route geometry request with missing coordinates" if any location lacks coordinates ([`input.cpp`](https://github.com/VROOM-Project/vroom/blob/master/src/structures/vroom/input/input.cpp) `run_basic_checks`). | Ungeocoded activities never enter the VROOM request. Either surface them as unassigned-pending-geocode, or keep a thin post-pass. This is arguably an improvement — today they are silently sprayed across days without being routed. |
| `DEFAULT_VISIT_MINS = 60` fallback | `job.service` defaults to `0`, not 60 | Keep the constant; apply it when building the request. Note the current asymmetry (arrival clock uses 60, day-budget uses 0) disappears — VROOM has one number. |
| Day → calendar-date mapping, `dayLabels`, `Placement` persistence (`optimize.ts`) | Out of scope for a VRP solver | Unchanged. `vehicle.id` = day index is the join key. |
| `travelCostRegistry.ts` provider selection | Facts layer, by design | Unchanged, but its *consumer* changes: for road kinds we hand VROOM nothing and let it query OSRM; for rail/Google/haversine we materialise a matrix and pass it under `matrices`. §6. |

### Net

`optimizer.ts` disappears as a module. `solver.ts` survives as the same
`solve(problem): Itinerary` seam ADR-0003 defines, reimplemented as: build VROOM JSON → POST →
map `routes[].steps[]` back to `DayPlan[]`. `objective.ts` shrinks to `DEFAULT_VISIT_MINS` and
whatever advisory scoring survives ADR-0016's deferred-balance clause. `metroCluster.ts`,
`pathProvider.ts`, `travelCostRegistry.ts`, `pathKind.ts` are untouched — they are Facts.

---

## Evidence

### 1. Complete input spec

Global notes, verbatim from
[API.md](https://github.com/VROOM-Project/vroom/blob/master/docs/API.md): coordinates are
`[lon, lat]`; **all timings are in seconds**; **all distances are in meters**; a `time_window` is
`[start, end]` with **both ends inclusive**; a "task" is a job, a pickup, or a delivery.

Top-level keys: `jobs`, `shipments`, `vehicles`, optional `matrices`. (`matrix` is deprecated.)

#### `job`

| Key | Required | Default | Semantics |
| --- | --- | --- | --- |
| `id` | yes | — | integer; duplicates are an input error |
| `description` | no | — | string, echoed into output steps |
| `location` | see §6 | — | `[lon, lat]`. Mandatory when no custom matrix; optional-but-echoed when one is supplied |
| `location_index` | see §6 | — | row/column index into the custom matrices. Mandatory when custom matrices are supplied |
| `setup` | no | `0` | seconds. Charged **only on arriving at a new location** — not re-charged for a second task at the same place |
| `service` | no | `0` | seconds at the location |
| `setup_per_type` / `service_per_type` | no | — | `{vehicleType: seconds}` override; falls back to `setup`/`service` for unlisted types. New in v1.15.0 |
| `delivery` / `pickup` | no | — | integer arrays, arbitrary dimensionality |
| `skills` | no | `[]` | integer array. **Mandatory**: job `j` is eligible for vehicle `v` iff `j.skills ⊆ v.skills` |
| `priority` | no | `0` | integer in `[0, 100]` |
| `time_windows` | no | one default window `[0, 2^32-1]` | array of `[start, end]` pairs; service **start** must fall in one of them |

The default time window is literally `[0, numeric_limits<uint32_t>::max()]`
([`time_window.cpp`](https://github.com/VROOM-Project/vroom/blob/master/src/structures/vroom/time_window.cpp)),
so absolute Unix timestamps fit until 2106.

#### `vehicle`

| Key | Required | Default | Semantics |
| --- | --- | --- | --- |
| `id` | yes | — | integer |
| `profile` | no | `car` | routing profile; selects which `-a`/`-p` server or which `matrices` entry |
| `start` / `end` | at least one | — | coordinates. Omit `end` → route stops at the last visited task (chosen by the optimizer). Omit `start` → route begins at the first visited task. Same coordinates for both → round trip. |
| `start_index` / `end_index` | see §6 | — | matrix indices |
| `capacity` | no | — | integer array |
| `costs` | no | see below | `{fixed, per_hour, per_task_hour, per_km}` |
| `skills` | no | `[]` | integer array |
| `type` | no | — | string; keys `service_per_type`/`setup_per_type` |
| `time_window` | no | default window | **singular** — one working-hours window per vehicle, not an array |
| `breaks` | no | `[]` | `{id, time_windows[], service, description, max_load[]}` |
| `speed_factor` | no | `1.0` | double in `(0, 5]`, two decimal places honoured; scales **all** travel times for this vehicle |
| `max_tasks` | no | unlimited | hard cap on tasks in the route |
| `max_travel_time` | no | unlimited | seconds, hard |
| `max_distance` | no | unlimited | meters, hard; setting it forces distance retrieval |
| `steps` | no | — | `vehicle_step[]`; see §2.4 |

`costs` defaults, from
[`typedefs.h`](https://github.com/VROOM-Project/vroom/blob/master/src/structures/typedefs.h):
`fixed = 0`, `per_hour = 3600`, `per_task_hour = 0`, `per_km = 0`. `per_hour = 3600` is chosen so
that **the default cost of a route equals its travel time in seconds** —
`cost = d·per_hour/3600 + m·per_km/1000`
([`cost_wrapper.cpp`](https://github.com/VROOM-Project/vroom/blob/master/src/structures/vroom/cost_wrapper.cpp)).
Setting a non-default `per_hour` together with a custom `costs` matrix is an input error.

`shipment` (`{pickup, delivery, amount, skills, priority}` where each of `pickup`/`delivery` is a
job-shaped `shipment_step`) is **not needed for trip planning** — we have no paired-visit
semantics. Skip it.

### 2. Customizing optimizations, run down

#### 2.1 The objective is fixed and lexicographic

[`solution_indicators.h`](https://github.com/VROOM-Project/vroom/blob/master/src/structures/vroom/solution_indicators.h)
defines the *entire* solution comparator. Decoded, VROOM prefers, in strict order:

1. **higher** `priority_sum` (sum of `priority` over assigned tasks)
2. **higher** `assigned` (number of assigned tasks)
3. **lower** `eval.cost`
4. **lower** `used_vehicles`
5. **lower** `eval.duration`
6. **lower** `eval.distance`
7. lower `routes_hash` (a tiebreak over sorted route sizes, for determinism)

This is not configurable through the API at any level. It is the whole "how VROOM chooses between
competing solutions" answer.

**Two consequences worth internalising.** First, tiers 1–2 mean VROOM is an *assign-as-much-as-
possible* solver before it is a *travel-minimising* one — which maps onto ADR-0016's
"feasibility ≫ travel" better than our current weighted sum does. Second, tier 4 is the
load-concentration problem in §9.1.

**A trap in tier 1.** Because `priority_sum` outranks `assigned`, a solution assigning one
`priority: 100` task scores better than one assigning fifty `priority: 0` tasks (100 > 0). If you
use `priority` at all, use it sparingly and understand you are buying "this must survive" at the
possible cost of "everything else". Uniform priorities (all `0`) make tier 1 tie and hand control
to tier 2, which is what a trip planner wants by default.

#### 2.2 The levers that do exist

| Lever | Effect | Where it bites |
| --- | --- | --- |
| `costs.per_hour` (default `3600`) | multiplies travel *time* into cost | tier 3 |
| `costs.per_km` (default `0`) | adds travel *distance* into cost — the time-vs-distance trade | tier 3; also forces a distance matrix ([`input.cpp`](https://github.com/VROOM-Project/vroom/blob/master/src/structures/vroom/input/input.cpp), `_profiles_requiring_distances`) |
| `costs.per_task_hour` (default `0`, new in v1.15.0) | makes `setup + service` count toward cost, not just clock | tier 3 |
| `costs.fixed` (default `0`) | flat charge for using this vehicle at all — `eval.cost += v.fixed_cost()` for non-empty routes | tier 3; the "fewer vehicles" bias |
| `speed_factor` | scales all travel times for one vehicle | matrix, so tiers 3/5 and all timing checks |
| `matrices.<profile>.costs` | arbitrary per-pair cost, decoupled from `durations` | tier 3 only — timing checks still use `durations` |
| `priority` | tier 1 | see the trap above |
| `max_tasks` / `max_travel_time` / `max_distance` / `time_window` | hard feasibility, not objective | admission + search |

There is **no** lever that biases toward *more* vehicles, toward even distribution, or toward any
per-day balance.

#### 2.3 `-x` (exploration) and `-t` (threads)

`-x` maps to two internal numbers
([`cl_args.cpp`](https://github.com/VROOM-Project/vroom/blob/master/src/structures/cl_args.cpp),
[`helpers.h`](https://github.com/VROOM-Project/vroom/blob/master/src/utils/helpers.h)):

```
depth       = exploration_level
nb_searches = 4 * (exploration_level + 1)  + 4 if level >= 4  + 4 if level == 5
```

So `-x 0` → 4 searches at depth 0; `-x 5` (the default) → **32** searches at depth 5, capped by
the number of available heuristic parameter sets
([`vrp.h`](https://github.com/VROOM-Project/vroom/blob/master/src/problems/vrp.h):
`nb_searches = min(nb_searches, parameters.size())`). Each search is an independent
construction + local-search run; the best by §2.1's comparator wins. `-t` (default 4) bounds
concurrency at `min(nb_searches, nb_threads)`, hard-capped at 32 by a `counting_semaphore<32>`.
`-l` sets a wall-clock budget in seconds, divided across searches, with input-loading time already
subtracted
([`input.cpp`](https://github.com/VROOM-Project/vroom/blob/master/src/structures/vroom/input/input.cpp)).

At our problem size (§7) `-x 5` costs nothing worth tuning. Leave it at the default.

#### 2.4 `steps` — warm-starting from a known solution

Setting `vehicle.steps` in **default solving mode** forces the search to start from that solution
instead of running several concurrent searches: "a single search path is followed, starting from
the provided solution", and only `type=job|pickup|delivery` entries are used. An invalid
user-supplied route is an error, not a warning. This is a real capability for "re-optimize but
keep most of what the user has already arranged" — worth remembering, but note ADR-0015's
re-optimize is wholesale with no pinned state, so nothing wants it today.

### 3. Time model

#### 3.1 There is no time zero

VROOM has no calendar, no timezone, and no epoch. Times are unsigned integers of seconds on one
flat axis; `UserDuration` is `uint32_t`. API.md leaves the interpretation entirely to the caller:

- **relative** — `[0, 14400]` is a four-hour window from the start of the planning horizon, and
  output `arrival` values are relative to that same origin;
- **absolute** — real timestamps, and output `arrival` values are timestamps.

VROOM's own `docs/example_1_sol.json` uses absolute Unix seconds (`"arrival": 1600417272`).

**Use absolute Unix seconds.** A multi-day trip needs one axis spanning the whole trip, and
relative-to-horizon offsets buy nothing while making every debug print unreadable. Trip start
midnight in the trip's local timezone is the natural origin, and `uint32_t` covers it until 2106.

#### 3.2 "Open 09:00–17:00 but closed Tuesdays"

Enumerate. A job's `time_windows` is an array, so for a 10-day trip the Tuesday-closed museum gets
**nine** windows — one per non-Tuesday day, each `[dayStart + 9h, dayStart + 17h]` in absolute
seconds. VROOM then picks whichever window a feasible schedule lands in. This is exactly the shape
`Location.hoursJson` (`Record<weekday, {open, close}>`) already holds, so the transform is a
straight cross-product of trip dates × that record. A 14-day trip with ~40 activities produces at
most ~560 window pairs across the whole request — trivial.

This is the single strongest argument that VROOM subsumes `objective.ts`: our current model
(`openTime`/`closeTime`, one window, no weekday awareness) can't express "closed Tuesdays" at all,
and `hoursJson` is populated but unread by the optimizer. VROOM makes the richer field usable
without new machinery.

#### 3.3 Unreachable windows → unassigned, silently

Before the search runs, `Input::set_extra_compatibility` tests each (vehicle, job) pair against
capacity and — when any time window is present — whether the job is a valid addition to that
vehicle's *empty* route. A job that fails on every vehicle has an empty `compatible_vehicles_for_job`
and can never be assigned. It appears in `unassigned[]`. No error, no violation, no diagnostic.

The practical consequence: **the reason a stop was dropped is ours to compute**, not VROOM's. See
§9.3.

#### 3.4 `waiting_time`

API.md: service start happens "potentially after some waiting time, if arrival is strictly before
time window start; right before setup and service times (those can extend past the time window
end)". So the window constrains the *start* of service only, and `waiting_time` on a step is the
idle time between arriving and being allowed to start. It surfaces per step, summed per route, and
summed in `summary`.

For narration this is genuinely useful and we currently have nothing like it — "you'll arrive at
08:20 and wait 40 minutes for it to open" is a sentence we can't write today.

### 4. Output spec

#### 4.1 Envelope

`{code, error?, summary, unassigned, routes}`. Status codes: `0` ok, `1` internal, `2` input,
`3` routing.

#### 4.2 `summary` / `route` / `step`

`summary`: `cost`, `routes`, `unassigned`, `setup`, `service`, `duration` (total travel time),
`waiting_time`, `priority`, `violations`, optional `delivery`/`pickup`, and `distance` when `-g`
is used **or** distance matrices are in play.

`route`: `vehicle`, `steps[]`, `cost`, `setup`, `service`, `duration`, `waiting_time`, `priority`,
`violations`, optional `delivery`/`pickup`/`description`, `geometry` (with `-g`), `distance`.

`step`: `type` ∈ `{start, job, pickup, delivery, break, end}`, `arrival`, `duration` (cumulated
travel time *on arrival at this step*), `setup`, `service`, `waiting_time`, `violations[]`,
optional `description`, `location`, `location_index`, `id`, `load`, `distance` (with `-g`).

Note `route.duration` and `step.duration` are **travel time only** — `setup`, `service`, and
`waiting_time` are reported separately and are not folded in. Wall-clock day length is
`end.arrival − start.arrival`.

`_report_distances` is set when `-g` is passed, **or** distance matrices are supplied, **or** any
vehicle has non-zero `per_km` / a `max_distance`
([`input.cpp`](https://github.com/VROOM-Project/vroom/blob/master/src/structures/vroom/input/input.cpp)).
So you can get distances without paying for geometry: set `per_km` to a nominal non-zero value, or
supply the distance matrix yourself.

#### 4.3 `violations`

Causes: `delay`, `lead_time` (each carrying a `duration` = lateness/earliness in seconds), `load`,
`max_tasks`, `skills`, `precedence`, `missing_break`, `max_travel_time`, `max_distance`,
`max_load`. They appear at step, route, and summary level (see `docs/example_3_sol.json`).

And the sentence that matters: *"reporting only really makes sense when using `-c` … When using
regular optimization, violations are still reported for consistency, but are guaranteed to be
'void', i.e. `violations` arrays are empty."*

Two of these causes (`delay`, `lead_time`) map cleanly onto ADR-0017's `closed-hours` rule with a
**better** magnitude than ours (real seconds of lateness, not a km-equivalent). None maps onto our
`day-budget` rule directly, though `max_travel_time` is close.

#### 4.4 `-g` geometry — the decisive negative

The chain, read end-to-end:

1. `HttpWrapper::add_geometry` collects every non-break step location and issues one `route` query
   ([`http_wrapper.cpp`](https://github.com/VROOM-Project/vroom/blob/master/src/routing/http_wrapper.cpp)).
2. `OsrmRoutedWrapper`'s constructor fixes the routing arguments to
   `alternatives=false&steps=false&overview=full&continue_straight=false`
   ([`osrm_routed_wrapper.cpp`](https://github.com/VROOM-Project/vroom/blob/master/src/routing/osrm_routed_wrapper.cpp)).
3. `HttpWrapper::get_geometry` returns `result["routes"][0]["geometry"]` as a string
   ([`http_wrapper.h`](https://github.com/VROOM-Project/vroom/blob/master/src/routing/http_wrapper.h)).

Because `geometries` is not set, OSRM's default applies: **encoded polyline, precision 5**. So:

- **Encoding:** polyline5 string. Not GeoJSON. ADR-0022 (amended) narrowed `PathGeometry` to
  `GeoJSON.LineString` precisely to avoid a bare polyline string; VROOM's geometry would have to be
  decoded at the boundary, which the amendment already anticipates ("a provider that speaks
  polyline decodes at its own boundary").
- **Source:** the routing engine, relayed verbatim by VROOM. VROOM computes no geometry itself.
- **Granularity:** one string for the whole vehicle route — start → all stops → end. No per-leg,
  no per-step, and critically **no `mode` tags**, because `steps=false`.

**Verdict: `-g` cannot serve Journey narration and cannot delete `describeJourney`.** It is
adequate for one thing only — drawing the day's road route on a map as a single line — and even
that needs a polyline5 decoder. If we want that, it's cheap. If we want ADR-0022's Path chain, we
issue our own `steps=true&geometries=geojson` call to the same OSRM, exactly as
`osrm-viability-149.md` §3 describes.

Two operational notes: `-g` costs one extra OSRM `route` request **per vehicle** (per day), and it
hard-errors if any task lacks coordinates
([`input.cpp`](https://github.com/VROOM-Project/vroom/blob/master/src/structures/vroom/input/input.cpp),
`run_basic_checks`: "Route geometry request with missing coordinates").

### 5. Routing-engine integration

- **Which engine.** `-r osrm | libosrm | ors | valhalla`, default `osrm`. `libosrm` links OSRM's
  C++ library in-process instead of speaking HTTP.
- **Which endpoints.** `GET /{path}table/v1/{profile}/{lon,lat};…?annotations=duration,distance&radiuses=…`
  for the matrix, and `GET /{path}route/v1/{profile}/…?alternatives=false&steps=false&overview=full&continue_straight=false&radiuses=…`
  for geometry. Both from `OsrmRoutedWrapper::build_query`. Coordinates are formatted to six
  decimal places. Snapping radius is hard-coded at **35000** meters
  (`DEFAULT_OSRM_SNAPPING_RADIUS` in
  [`typedefs.h`](https://github.com/VROOM-Project/vroom/blob/master/src/structures/typedefs.h)) —
  a 35 km snap radius, which is very permissive and will silently route from a far-away road
  rather than fail. Worth knowing given ADR-0022's explicit rejection of a `snapOffsetMeters`
  field: VROOM does not expose the snap at all.
- **Matrix annotations.** VROOM always asks for `annotations=duration,distance`, so **`--max-table-size`
  on `osrm-routed` must be raised past our trip size** (default 100 *locations*), exactly as
  `osrm-viability-149.md` §3 said. The wiki says so too: "if you plan to use a number of locations
  that overpass the default maximum in OSRM `table` and `route` plugins, you have to set the
  `--max-table-size` and `--max-viaroute-size` options accordingly"
  ([Usage wiki](https://github.com/VROOM-Project/vroom/wiki/Usage)).
- **Multiple profiles from one VROOM instance: yes.** `-a` and `-p` take `profile:value` pairs and
  may be repeated — `-a car:0.0.0.0 -p car:5000 -a foot:0.0.0.0 -p foot:5002`. `vehicle.profile`
  selects which server handles that vehicle, defaulting to `car`. `vroom-express` builds exactly
  these flags from its `routingServers` map, whose stock OSRM entry is `car:5000`, `bike:5001`,
  `foot:5002`
  ([`config.yml`](https://github.com/VROOM-Project/vroom-express/blob/master/config.yml),
  [`src/index.js`](https://github.com/VROOM-Project/vroom-express/blob/master/src/index.js)).
  This lines up exactly with `osrm-viability-149.md`'s finding that one `osrm-routed` process
  serves one profile: three OSRM processes, one VROOM.
- **Per-profile matrix requests run in parallel**, bucketed across `-t` threads
  ([`input.cpp`](https://github.com/VROOM-Project/vroom/blob/master/src/structures/vroom/input/input.cpp),
  `set_matrices`).
- **When the engine is unreachable:** `HttpWrapper::send_then_receive` catches `std::system_error`
  and throws `RoutingException("Failed to connect to " + host + ":" + port)`, which exits with
  code **3** and a JSON error body
  ([`http_wrapper.cpp`](https://github.com/VROOM-Project/vroom/blob/master/src/routing/http_wrapper.cpp)).
  `vroom-express` maps code 3 to HTTP 500. There is no retry and no fallback. This is the same
  fail-loud posture ADR-0018 §4 / ADR-0019 already chose — a configured-but-down provider errors
  the run.
- **Unroutable pairs are fatal, not degraded.** `HttpWrapper::get_matrices` collects `null` cells
  and calls `check_unfound`, which raises rather than filling. **VROOM does not use OSRM's
  `fallback_speed`** — the parameter is never sent. This is a regression against
  `osrm-viability-149.md` §3's finding that `fallback_speed` + `fallback_speed_cells` gives a
  free per-cell `basisOfCost` tag. If we want mixed-basis degradation, we must fetch the matrix
  ourselves and pass it in under `matrices` (§6).
- **Snapping errors** get a friendlier message: OSRM `code == "NoSegment"` is rewritten to
  "Could not find route near location [lon,lat]"
  ([`osrm_routed_wrapper.cpp`](https://github.com/VROOM-Project/vroom/blob/master/src/routing/osrm_routed_wrapper.cpp)).

### 6. Custom matrices

Shape, from [API.md#matrices](https://github.com/VROOM-Project/vroom/blob/master/docs/API.md#matrices):

```json
"matrices": {
  "car":  { "durations": [[0, 14], [21, 0]], "distances": [[0, 300]], "costs": [[0, 9]] },
  "bike": { "durations": [[0, 57], [43, 0]] }
}
```

- **`durations`** — used for *all* checks against timing constraints.
- **`distances`** — requires `durations` alongside it.
- **`costs`** — used within *all route cost evaluations*, independent of durations. This is the
  hook described in the recommendation.
- Arrays of unsigned integers, keyed by profile. Non-empty.

**`location_index` semantics.** When any custom matrix is present, `location_index` becomes
mandatory on every task and on `vehicle.start`/`end`; `location` becomes optional and is used only
to echo coordinates into the response. Mixing the two styles within one request is an input error
in both directions: "Missing location index" if matrices are present without indices, "Unexpected
location index while no custom matrices provided" otherwise
([`input.cpp`](https://github.com/VROOM-Project/vroom/blob/master/src/structures/vroom/input/input.cpp),
`set_matrices`). Since `-g` also needs real coordinates, **supply both `location` and
`location_index`** when going custom.

**Can custom and engine-queried matrices be mixed across profiles in one request? Yes for
durations, no for distances.** `Input::set_matrix_for_profile` (read at
[`input.cpp`](https://github.com/VROOM-Project/vroom/blob/master/src/structures/vroom/input/input.cpp))
resolves per profile: a profile with a custom `durations` entry uses it; a profile without one
gets a routing wrapper created and queried. But `distances` is checked globally — "Distances
matrices should be either always or never provided", raising "Missing distances matrix for
{profile} profile" otherwise. And a `distances` entry without a matching `durations` entry for the
same profile is an error.

Also: if you give `durations` but no `distances`, and distances are required (`-g`, non-zero
`per_km`, or `max_distance`), VROOM will still call the routing engine just to fetch distances.

**What this means for us.** The Facts layer keeps its authority exactly where ADR-0019 and
`osrm-viability-149.md` put it:

| Path kind(s) for the run | How VROOM gets the matrix |
| --- | --- |
| `walking` / `driving` / `bicycle` only | Let VROOM query OSRM. Send `location`, no `matrices`. Simplest and fastest. |
| Japan `rail` | We build it (`osmTransitProvider`) and send `matrices.rail.durations` + `location_index`. |
| Non-Japan `rail`/`bus` (Google) | Same — we build it, we send it. |
| Mixed multimodal | One profile, one composed `durations` matrix from our own provider. VROOM never sees the modes. §9.4. |

The `vroom-scripts` repo ships `add_osrm_matrices.py`, which does precisely the
"materialise the matrix once, embed it, solve offline" pattern
([Standalone-problem-instance wiki](https://github.com/VROOM-Project/vroom/wiki/Standalone-problem-instance)) —
useful as a test-fixture generator so our solver tests need no OSRM at all.

### 7. Limits and performance

**In VROOM core: none documented.** No maximum job or vehicle count exists in the API or the
source. The practical ceiling is the routing engine's `--max-table-size` and memory.

**In `vroom-express` ([`config.yml`](https://github.com/VROOM-Project/vroom-express/blob/master/config.yml)),
the actual keys:**

| Key | Default | Meaning |
| --- | --- | --- |
| `maxlocations` | `1000` | `jobs.length + 2 × shipments.length`; exceeding it returns HTTP **413** |
| `maxvehicles` | `200` | exceeding it returns HTTP 413 |
| `limit` | `'1mb'` | Express body-parser request-size cap |
| `timeout` | `300000` | ms, `server.setTimeout` |
| `threads` | `4` | default `-t` |
| `explore` | `5` | default `-x` |
| `geometry` | `false` | default `-g` |
| `planmode` | `false` | default `-c` |
| `override` | `['c','g','l','t','x']` | which flags a request may override via `body.options` |
| `router` | `'osrm'` | |
| `port` / `baseurl` | `3000` / `'/'` | |
| `logdir` / `logsize` | `'..'` / `'100M'` | |

Per-request overrides ride in `body.options` as `{g, c, t, x, l}`, gated by `override`
([`src/index.js`](https://github.com/VROOM-Project/vroom-express/blob/master/src/index.js)).
Note `vroom-express` writes each request body to a **temp file on disk** before spawning `vroom`
and deletes it after — relevant to any privacy or disk-space thinking.

**Measured performance**, from the project's own
[Benchmarks wiki](https://github.com/VROOM-Project/vroom/wiki/Benchmarks) (v1.12.0, `-x 5`,
Intel Xeon E5-1620 @ 3.50 GHz, 4c/8t):

| Benchmark | Size | Avg | Median | Longest | Quality vs best-known |
| --- | --- | --- | --- | --- | --- |
| Solomon VRPTW | 56 instances × 100 jobs | 359 ms | 382 ms | 716 ms | median gap +1.12%, worst +7.54% |
| Cordeau MDVRP | 33 instances, 48–360 jobs, 2–9 depots | 1080 ms | 451 ms | 4092 ms | median gap +1.20%, worst +4.90% |

So "milliseconds" means **~350 ms at 100 jobs with time windows** and degrades toward seconds in
the low hundreds of jobs with many depots. Our trips are 20–60 activities over 3–14 days
(≤14 vehicles), well inside the fast region. The public demo server caps requests at 100 jobs
([Demo-server wiki](https://github.com/VROOM-Project/vroom/wiki/Demo-server)) — do not use it for
anything but smoke tests; its policy forbids commercial use and guarantees nothing.

No first-party memory or CPU figures exist for `vroom` itself. See "what I could not verify."

### 8. Deployment

[`vroom-docker`](https://github.com/VROOM-Project/vroom-docker) is **one image** containing
`vroom` + `vroom-express`, not a compose stack. There is no `docker-compose.yml` in the repo — the
tree is `Dockerfile`, `docker-entrypoint.sh`, `README.md`, `tests/`, CI workflows.

```bash
docker run -dt --name vroom --net host \
  -v $PWD/conf:/conf \
  -e VROOM_ROUTER=osrm \
  ghcr.io/vroom-project/vroom-docker:v1.15.0
```

- **It does not include a routing engine.** The README is explicit: "you should have access to a
  self-hosted instance of OSRM, Valhalla or OpenRouteService for the routing server." Wiring is
  your job — `--net host`, or a shared Docker network plus editing `config.yml`'s
  `routingServers` host entries to the OSRM container names.
- **Config files:** exactly one, `/conf/config.yml` (the `vroom-express` config above), plus
  `/conf/access.log`. Editing requires `docker restart vroom`.
- **Env:** `VROOM_ROUTER` only, and it takes precedence over `config.yml`'s `router`. Defaults
  assume `localhost:5000` (OSRM), `:8080` (ORS), `:8002` (Valhalla).
- **Tags follow `vroom` core releases**; build args `VROOM_RELEASE` / `VROOM_EXPRESS_RELEASE`
  pin the two components independently, with a warning that "not all versions are compatible with
  each other."

**Official clients: there is no Node or TypeScript client.** The `VROOM-Project` org contains
`vroom` (C++), `vroom-express` (JS server, not a client), `vroom-frontend` (JS web UI),
`vroom-scripts` (Python), `vroom-docker` (Shell), `pyvroom` (Python) and `pyvroom-docs`. We write
our own request builder and response parser — which is the right outcome anyway, since the mapping
from our domain to VROOM's is the interesting part and a thin generic client would add nothing.

Practically: `vroom-express` is a `POST` of the input JSON to `/`, returning the output JSON.
That is the whole protocol. A `fetch` call and two mapper functions.

### 9. What VROOM does not do

#### 9.1 Load balancing — the big one

There is no balancing objective, no makespan term, and no way to express "spread these evenly
across days." Worse than neutral: tier 4 of §2.1's comparator **minimizes used vehicles**, and
tier 3 (cost) independently rewards emptying a day, because each used day-vehicle pays a
lodging→first-stop and last-stop→lodging leg that an empty day does not.

For a delivery fleet that is correct — fewer trucks is cheaper. For a holiday it is exactly wrong.

**Honest workarounds, all hard caps rather than objectives:**

- `vehicle.max_tasks` — cap stops per day. Blunt but effective and trivially derived
  (`ceil(activities / days) + slack`).
- `vehicle.time_window` — a realistic waking day (say 09:00–20:00) plus honest `service` durations
  makes cramming physically infeasible. **This is the principled one**, and it also replaces
  `dayBudgetPenaltyKm`.
- `vehicle.max_travel_time` — cap the day's travel.
- Do **not** reach for `costs.fixed`: it pushes the wrong way (toward fewer days).

Note that all three are hard, so an over-tight cap converts "an unbalanced plan" into "unassigned
activities". The tuning is real and should be treated as a product decision, not a constant.

There is no VROOM-side fix. The only alternative is post-processing our own rebalancing pass,
which reintroduces the code we are trying to delete. **Recommendation: rely on honest
`time_window` + `service` first, add `max_tasks` as a guard, and treat visible imbalance as a
signal that `visitDuration` data is too thin rather than as an optimizer bug.**

#### 9.2 Optional-visit-with-penalty

There is no "cost of skipping this job." `priority` is the entire vocabulary, it is soft, it is an
integer in `[0, 100]`, and it sits in a tier *above* the assigned count (§2.1's trap). You cannot
say "dropping the Ghibli Museum costs 400 units, dropping this café costs 5." You can only say
"prefer to keep the museum."

Workaround: uniform `priority: 0` for ordinary activities, and a single elevated band (say `50`)
for genuinely must-see stops, accepting that a solution keeping only must-sees outranks one
keeping everything else. If finer control is ever needed, the honest answer is a second solve with
the must-sees as the only jobs, then a warm-started second pass via `vehicle.steps` (§2.4).

#### 9.3 Diagnostics for dropped tasks

`unassigned[]` gives `{id, type}` and echoes `description`/`location`/`location_index`. It never
says why. And `violations` is empty in default mode (§4.3). So both of ADR-0017's and ADR-0020's
user-facing stories — "this stop violates its closing hours by 40 minutes", "no lodging covers
this area" — must be computed on our side, from the same inputs.

The good news is that both are cheap and *more* honest than today's: coverage comes from
`metroCluster.ts` before the request is even built, and lateness comes from a second `-c` pass
that returns real seconds instead of km-equivalents.

#### 9.4 Multimodal routing within a route

`vehicle.profile` is **one profile for the entire route**. There is no per-leg mode, no mode
change mid-route, and no concept of a route that walks to a station, takes a train, and walks
again. This is precisely #140's deferred multimodal question and ADR-0022's "making Paths the
optimizer's currency would turn each edge from a number into a set of alternative chains."

VROOM's position is the same as ours: the Decision layer sees one number per pair. The escape
hatch is `matrices` (§6) — our Facts layer composes the multimodal cost into a scalar, VROOM
optimizes over scalars, and Narration decomposes the chosen edges back into Paths afterward. That
is the architecture already chosen, and VROOM neither helps nor hinders it.

#### 9.5 Smaller absences, each with its workaround

| Missing | Workaround |
| --- | --- |
| Calendar / weekday awareness | Enumerate windows per day (§3.2) |
| Timezones | Pick one axis in trip-local time; convert at the boundary |
| Multiple time windows per **vehicle** (`time_window` is singular) | One vehicle per day already gives one window per day; a split day (morning + evening, closed midday) would need two vehicles for that date |
| Soft time windows in solving mode | `-c` plan mode softens everything, but requires a pre-chosen route |
| A "must be assigned" hard flag on a job | None. Every job is droppable; `priority` is the only lever (§9.2) |
| `fallback_speed` / per-cell degraded basis | Fetch the matrix ourselves (§6) |
| Snap-distance reporting | Not exposed; 35 km snapping radius is hard-coded (§5) |
| Per-step or per-mode geometry | Our own OSRM `route` call (§4.4) |
| Ordering *preferences* (e.g. "lunch spots around midday") | Only expressible as time windows, which are hard |

---

## Constraint mapping

Our concept → VROOM field → confidence. "High" means the API documents it and I read the source
path; "medium" means the mapping is sound but unexercised; "low" means it needs a prototype.

| trip-kraken | VROOM | Confidence | Note |
| --- | --- | --- | --- |
| Trip day (1..N) | one `vehicle`, `id` = day index | High | The central modelling choice |
| Activity `Location` | `job` | High | |
| `Location.visitDuration` | `job.service` (× 60 → seconds) | High | `DEFAULT_VISIT_MINS` applied by us |
| `Location.openTime`/`closeTime` | `job.time_windows` | High | |
| `Location.hoursJson` (weekday hours, closed days) | `job.time_windows`, one per open day of the trip | High | §3.2 — the field finally becomes usable |
| Lodging you woke at (ADR-0005) | `vehicle.start` | High | |
| Lodging you sleep at | `vehicle.end` | High | Different from `start` on a travel day = open path, native |
| Trip-edge arrival/departure (ADR-0005 #54) | day-1 `vehicle.start`, last-day `vehicle.end` | High | |
| No lodging for a day | omit `start` and/or `end` | High | "route begins at the first visited task" |
| Eligible-day mask (ADR-0020) | `job.skills` ⊆ `vehicle.skills`; one skill id per mask group | Medium-high | Inclusion semantics verified in `set_skills_compatibility` |
| Orphaned metro (no covering lodging) | job holds a skill no vehicle has → `unassigned[]` | High | Reason string stays ours |
| `dayBudgetMinutes` | `vehicle.time_window`; optionally `max_travel_time` / `max_tasks` | Medium | Hard, where ours was soft |
| `dayStartMins` | `vehicle.time_window[0]` | High | |
| ADR-0016 tier 1 (feasibility gate) | tiers 1–2 of the comparator (`priority_sum`, `assigned`) + hard TW admission | Medium-high | Structurally lexicographic, which is what ADR-0016 asked for; failure mode differs |
| ADR-0016 tier 2 (minimize travel) | tier 3 `eval.cost` (= travel seconds by default) | High | |
| ADR-0017 `feasibilityViolations` | `-c` second pass → `violations[{cause, duration}]` | Low-medium | Not available from the solve itself |
| ADR-0020 `unplaced[]` | `unassigned[]` | High | minus the reason |
| `Trip.allowedPathKinds` | `vehicle.profile`, or baked into `matrices` | Medium | One profile per vehicle for the whole day |
| `Placement.order` | index of the `job` step within `route.steps` | High | |
| `Placement.date` | the date the vehicle id denotes | High | Ours |
| ADR-0022 `Path[]` | **nothing** | High (that it's absent) | §4.4 |
| `TravelCost.basisOfCost` per cell | **nothing** | High (absent) | VROOM errors on unroutable pairs rather than tagging them |
| Locations without coordinates | **nothing** | High (absent) | Excluded from the request |

---

## Licensing

**VROOM: BSD 2-Clause.** [`LICENSE`](https://github.com/VROOM-Project/vroom/blob/master/LICENSE) —
"Copyright (c) 2015-2025, Julien Coupey", the standard two-condition redistribution clause plus
the AS-IS disclaimer. Permissive, no copyleft, no network-use clause.

**`vroom-express`: BSD 2-Clause**, "Copyright (c) 2016, Julien Coupey"
([LICENSE](https://github.com/VROOM-Project/vroom-express/blob/master/LICENSE)). `vroom-docker`
carries its own `LICENSE` in the same repo layout.

So the whole stack — OSRM (BSD 2-Clause, per `osrm-viability-149.md` §6), VROOM, `vroom-express` —
is uniformly BSD 2-Clause. Running them as network services creates no source-disclosure
obligation.

**ODbL: nothing new.** VROOM adds no data of its own; every geographic fact it returns originates
in the OSM extract OSRM was built from. `osrm-viability-149.md` §6's analysis applies unchanged:
the prepared graph is a Derivative Database used internally (ODbL §4.5(c)); a route shown to a
user is a Produced Work that does **not** trigger share-alike on our code (§4.5(b)); §4.3
attribution and §4.6 "publish the alterations or the method" both attach.

One VROOM-specific addition worth noting, because it is the project's own statement of what a
VROOM+OSRM deployment should credit — the demo-server usage policy requires attribution to
OpenStreetMap (ODbL), Vroom (optimization), and OSRM (travel times and routes)
([Demo-server wiki](https://github.com/VROOM-Project/vroom/wiki/Demo-server)). BSD 2-Clause does
not compel the VROOM credit for a self-hosted binary we do not redistribute, but it is the
project's stated expectation and costs one line.

**The pre-existing gap `osrm-viability-149.md` §6 flagged is unchanged and still open:** there is
no OSM attribution anywhere in `src/`. Adding VROOM does not create the obligation, but it adds a
third thing that would sit naturally in the same credit line.

---

## What I could not verify

- **Whether the one-vehicle-per-day model produces sane plans at our scale.** Every mapping in
  the constraint table is individually sound against the docs and source, but the composite —
  ~40 jobs, ~10 day-vehicles each with distinct start/end lodgings, per-day skills, and
  enumerated multi-day time windows — is not something I ran. **This is the single highest-value
  thing to prototype**, and it is an afternoon: build one real trip's JSON, POST it at a
  `vroom-docker` container pointed at a Japan OSRM, and look at the routes. Specifically watch
  for §9.1's concentration behaviour, which I predict from the comparator source but did not
  observe.
- **How badly §9.1 actually bites, and which cap fixes it most cheaply.** The prediction that
  VROOM empties days follows directly from tiers 3–4 of `SolutionIndicators::operator<` plus the
  per-day anchor legs. I did not measure it. If it turns out mild, `max_tasks` may be unnecessary.
  If severe, the `time_window` + `service` data quality question (§9.1) becomes load-bearing.
- **Whether the `-c` second pass actually produces useful `lead_time`/`delay` numbers for our
  shape.** API.md says plan mode softens all constraints and reports violations, and
  `example_3_sol.json` shows the shape — but plan mode also bypasses the matrix request (v1.15.0
  changelog: "Bypass matrix request in `plan` mode"), and I did not confirm what that means when
  the first pass queried the engine and the second is a separate process invocation. Likely fine
  (matrices can be passed in), but unverified.
- **VROOM's own memory and CPU footprint.** No first-party figures exist for anything but solve
  *time*. The wiki benchmarks report milliseconds and nothing else. Given the process is a
  short-lived spawn per request under `vroom-express`, this probably does not matter, but it is
  genuinely unmeasured.
- **Whether `vroom-express`'s default 300-second `timeout` and per-request temp-file write cause
  any problem at our request rate.** Not exercised.
- **Whether `speed_factor` is a useful calibration knob for OSRM's flat-speed `foot` profile.**
  `osrm-viability-149.md` §1 flagged OSRM's stock walking profile as a flat 5 km/h with no
  elevation model, and `speed_factor` scales all of a vehicle's travel times by a constant in
  `(0, 5]`. A per-day-vehicle `speed_factor` of, say, 0.8 in hilly Kyoto is *mechanically*
  possible; whether it improves accuracy or just moves the error around is exactly what the
  J5-style manual eval would answer, and I have no basis for a recommendation.
- **`vroom-express` and `vroom` version compatibility.** `vroom-docker`'s README warns "not all
  versions are compatible with each other" without publishing a matrix. `vroom` is at v1.15.0
  (2026-03-12); `vroom-express`'s last release is v0.12.0 (2023-11-16), two `vroom` majors ago.
  The `vroom-docker` v1.15.0 tag pins `VROOM_EXPRESS_RELEASE=v0.12.0`, which is the strongest
  available signal that the pairing works, but I found no explicit compatibility statement.
- **Whether any VROOM release policy or LTS exists.** Release cadence is slow and irregular —
  v1.11.0 (2021-11), v1.12.0 (2022-05), v1.13.0 (2023-01), v1.14.0 (2024-01), v1.15.0 (2026-03).
  Four majors in five years, with a two-year gap before the latest. `docs/release.md` exists in
  the repo but I did not read it. This is not dormancy (master has post-1.15 commits), but it is
  a slower project than OSRM, and pinning a release rather than tracking master is the obvious
  posture.
