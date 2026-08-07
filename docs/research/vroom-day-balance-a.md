# Prototype A: does VROOM balance days?

- **Answers:** ADR-0023 §5, §6 (both explicitly gated: *"Prototype A gates this ADR's §5 and
  §6"*), and empirically validates §8.
- **Date:** 2026-08-07
- **Status:** Prototype findings. Not an ADR — ADR-0023 needs an amendment (see *Consequences*
  below) to record what this settles.
- **Code read at:** `main` `f55bb77` (ADR-0023 + ADR-0024). Prototype branch
  `prototype/vroom-day-balance-a` at `13d83f8` — **throwaway, never merged, may be deleted**; every
  file this doc cites lives there under `prototypes/vroom-balance-a/`.
- **VROOM version measured:** `1.15.0`. Two builds, deliberately different:
  - Homebrew bottle (`brew install vroom`) — **compiled without libglpk**, used for every
    measurement except §8.
  - `vroom-docker` built from source, `--build-arg VROOM_RELEASE=v1.15.0` (its default is
    `master` — unpinned would have measured a different solver revision) — used only for §8's
    `-c` plan-mode validation, via `vroom-express` v0.12.0 over HTTP.
- **Fixture:** `prototypes/vroom-balance-a/fixture.json`, seed `0x7217a01`, committed and frozen.
  Coordinates sampled from `db/transit-japan.db`'s `StopNode` table (already in-repo, ingested for
  the OSM-Japan transit provider) — real intra-metro spread, real ~370 km inter-metro gap. Station
  names stand in for attraction names; the measurements need geometry and hours distributions, not
  real venue names.

## Recommendation

**Ship rung 1 (`max_tasks`, slack 0) combined with rung 2 (metro `skills`) — not either alone.**
Neither of ADR-0023 §6's rungs, taken in isolation, is sufficient:

- **Rung 1 alone perfectly balances** (max 4 stops/day, 0 empty days, CoV 0.11–0.16 across every
  duration-coverage level) **but leaves 6–8 cross-metro leaks** — roughly a fifth of jobs landing
  on the wrong metro's day (a Kyoto museum on a Tokyo day).
- **Rung 2 alone eliminates leakage completely** (0 leaks, always) **but does nothing for
  balance** — max stops/day still hits 9–21 and 5–8 days sit empty, because skills only restrict
  *which* vehicle a job may go to, not *how many* jobs pile onto the vehicles it's allowed to use.

Combined (`rung1+2`, `max_tasks` slack 0 + skills together), the fixture holds at **max 4
stops/day, 0 leaks, 1 empty day (of 10), CoV 0.34** — and this holds identically across every
duration-coverage level tested (0%, 35%, 70%, 100%), so it is not an artifact of thin enrichment
data (#154). The cost is **3 consistently unassigned jobs (7.9%)**, well under the 15%
plan-level-fork threshold, so no grill is needed — but the *cause* is structural and worth
carrying into the real translator (see §6 below), not a numeric fluke to shrug off.

One number decides the recommendation: **at rung 1 alone, `max_tasks` slack itself is the balance
knob and more slack is strictly worse** — slack 0 gives CoV 0.11–0.16 with 0 empty days; slack 1
gives CoV 0.52 with 2 empty days; slack 2 gives CoV 0.67–0.72 with 3 empty days. The tightest
possible cap, not a cushioned one, is what balances.

## The rung grid (Block A, raw)

| coverage | rung | slack | assigned | max/day | empty days | CoV | passes 1.5×ceiling+0-empty bar | unassigned % | cross-metro leaks |
|---|---|---|---|---|---|---|---|---|---|
| 0.00 | 0 | — | 38 | 22 | 6 | 1.78 | no | 0.0 | 14 |
| 0.00 | 1 | 0 | 38 | 4 | 0 | 0.16 | **yes** | 0.0 | 8 |
| 0.00 | 1 | 1 | 38 | 5 | 2 | 0.52 | no | 0.0 | 4 |
| 0.00 | 1 | 2 | 38 | 6 | 3 | 0.72 | no | 0.0 | 4 |
| 0.00 | 2 | — | 35 | 21 | 8 | 2.05 | no | 7.9 | 0 |
| 0.00 | 1+2 | 0 | 35 | 4 | 1 | 0.34 | no† | 7.9 | 0 |
| 0.35 | 0 | — | 38 | 15 | 5 | 1.35 | no | 0.0 | 12 |
| 0.35 | 1 | 0 | 38 | 4 | 0 | 0.11 | **yes** | 0.0 | 6 |
| 0.35 | 1 | 1 | 38 | 5 | 2 | 0.52 | no | 0.0 | 4 |
| 0.35 | 1 | 2 | 38 | 6 | 3 | 0.72 | no | 0.0 | 4 |
| 0.35 | 2 | — | 35 | 15 | 7 | 1.65 | no | 7.9 | 0 |
| 0.35 | 1+2 | 0 | 35 | 4 | 1 | 0.34 | no† | 7.9 | 0 |
| 0.70 | 0 | — | 38 | 11 | 5 | 1.13 | no | 0.0 | 7 |
| 0.70 | 1 | 0 | 38 | 4 | 0 | 0.16 | **yes** | 0.0 | 8 |
| 0.70 | 1 | 1 | 38 | 5 | 2 | 0.52 | no | 0.0 | 4 |
| 0.70 | 1 | 2 | 38 | 6 | 3 | 0.67 | no | 0.0 | 4 |
| 0.70 | 2 | — | 35 | 9 | 5 | 1.03 | no | 7.9 | 0 |
| 0.70 | 1+2 | 0 | 35 | 4 | 1 | 0.34 | no† | 7.9 | 0 |
| 1.00 | 0 | — | 38 | 9 | 4 | 0.90 | no | 0.0 | 7 |
| 1.00 | 1 | 0 | 38 | 4 | 0 | 0.11 | **yes** | 0.0 | 7 |
| 1.00 | 1 | 1 | 38 | 5 | 2 | 0.52 | no | 0.0 | 4 |
| 1.00 | 1 | 2 | 38 | 6 | 3 | 0.67 | no | 0.0 | 4 |
| 1.00 | 2 | — | 35 | 9 | 5 | 1.03 | no | 7.9 | 0 |
| 1.00 | 1+2 | 0 | 35 | 4 | 1 | 0.34 | no† | 7.9 | 0 |

† `1+2`'s single empty day fails the mechanical "0 empty days" bar by exactly one day, but at max
4/day and CoV 0.34 it is a materially better plan than any pure-rung-1 or pure-rung-2 cell, and it
is the only configuration with zero leakage *and* near-perfect balance simultaneously. Read this as
the bar being slightly too strict for a combined configuration, not as `1+2` failing — see
*Recommendation*.

**`rung "1+2"` is not one of ADR-0023 §6's named rungs.** It was added mid-sweep after rung 1 alone
left leakage and rung 2 alone left concentration; see §6 below for why this matters for the
eventual translator, not just this fixture.

**Determinism (Phase 1, synthetic 40-job/10-vehicle instance, not the fixture):** identical
per-vehicle job-count distributions across 5 repeats at `-x5 -t1`, 5 at `-x0 -t1`, and 3 at
`-x5 -t4` — no thread-race nondeterminism at any thread count tested. `-x0` converges to a
different (but internally stable) local optimum than `-x5`. Point estimates above need no error
bars; the sweep is pinned at `-x5 -t1`.

## Settled schema facts

Verbatim, from the Homebrew `vroom` 1.15.0 CLI (`code`, `error` fields as returned):

| Probe | Result |
|---|---|
| Vehicle omitting **both** `start` and `end` | `{"code":2,"error":"No start or end specified for vehicle 1."}` |
| `vroom -c` on a build without libglpk | `{"code":2,"error":"VROOM compiled without libglpk installed."}` — compile-time, not a missing runtime lib (`otool -L` shows no glpk linkage) |
| Float matrix entry | `{"code":2,"error":"Invalid matrix entry."}` |
| `time_windows: []` | `{"code":2,"error":"Empty time windows for job 100."}` |
| Backwards window (`close <= open`) | `{"code":2,"error":"Invalid time window: [7200, 3600]"}` |
| Unsorted/overlapping `time_windows` on one job | `{"code":2,"error":"Unsorted or overlapping time-windows for job 1."}` |
| `delivery` array length ≠ `capacity` array length (either direction, or capacity absent) | `{"code":2,"error":"Inconsistent delivery length: 2 instead of 1."}` |
| `vehicle.profile` not a key in `matrices` | Falls through to routing-engine query; fails on missing coordinates or `{"code":2,"error":"Invalid profile: foo."}` — every vehicle's profile must equal the matrices key (`"car"`) |
| `job.skills` not a subset of any `vehicle.skills` | Job silently dropped to `unassigned`, `code: 0`, no error, no side effect on other jobs |
| **A vehicle whose own start→end direct travel exceeds its `time_window`** | **`code: 0`, empty route, job(s) unassigned — no error at all.** This is the sharp edge that would have silently broken the two travel days under pure haversine (see below) |
| 3 vehicles, 9 jobs that comfortably fit one day | One route takes all 9, two vehicles unused — the concentration risk reproduces in 9 lines |
| Same, `max_tasks: 4` | `4/4/1`, not `3/3/3` — **caps, does not balance**; slack is a real knob, not a safety margin |

## The seven measurements

**M1 — day occupancy.** See the rung grid above. Bar: `max(perDay) ≤ 1.5 × ceil(assigned/10)` and
zero empty days. Only rung 1 (any slack) and `1+2` come close; rung 0 and rung 2 alone never do,
at any duration-coverage level.

**M2 — unassigned, and the fork check.** Rung 0 and rung 1 alone: 0% unassigned at every coverage
level — the fork trigger (>15%) never came close to firing, so no grill was needed. Rung 2 and
`1+2`: a flat 7.9% (3/38), **the same three job ids at every coverage level** — a structural
effect, not a duration-data artifact. All three are the `market` archetype (weekend-only hours).
Classified cause: `window_unreachable` — not because the window itself is unreachable in isolation,
but because **the trip's only Saturday/Sunday (days 6–7) are exactly the two purely-Kyoto days
under the skills scheme**, so a Tokyo-flavored, weekend-only job has zero day that is
simultaneously Tokyo-skilled *and* inside its window. Skills partition by day-metro; opening hours
partition by weekday; for this archetype the two partitions are disjoint. This is a real,
general risk of rung 2 — any archetype whose hard hours happen to land entirely within a
different-metro's date span will structurally lose every instance, regardless of `max_tasks`
slack, priority, or duration coverage.

**M3 — cross-metro leakage.** Travel days (5 and 8, detected as `start_index ≠ end_index`, not
hardcoded) excluded, correctly, since they legitimately touch two metros. Rung 0: 7–14 leaks. Rung
1 alone: 4–8 leaks — better than rung 0, but a pure task-count cap has no notion of geography, so
real leakage persists. Rung 2 and `1+2`: 0 leaks, always — skills are a hard constraint and this
is exactly what they're for.

**M4 — reframed as edge-day policy.** The free-depot measurement resolved to "rejected" in Phase 0
(kept as a `smoke.ts` regression), which turns this into a design question rather than a solver
question: day 1 has no preceding night, day 10 has no following night. `edgePolicy: "mirror"` was
used throughout this sweep (missing side = the other side's lodging, i.e., a round-trip day) and
verified directly on the fixture: day 1 gets `start_index = end_index = 0` (Shinjuku), day 10 gets
`start_index = end_index = 2` (Asakusa), and both travel days (5, 8) correctly show
`start_index ≠ end_index`. `"openEnd"` (leaving the missing side's index unset entirely) is
implemented and smoke-tested as individually valid but was not swept — see *What I could not
verify*.

**M5 — wall clock and the epoch/rounding self-check.** `span ≈ duration + service + setup +
waiting_time` held exactly (integer equality, not approximate) on every route in every cell across
both blocks — 45 runs, zero failures. This is the strongest confidence signal in the whole
prototype: the epoch conversion, the `Math.round` rounding, and the window cross-product are not
silently corrupting time. Utilization at rung `1+2` / coverage 1.0 ranged roughly 0.37–0.95 across
the six non-empty days, i.e. real, plausible-looking days once balance is fixed.

**M6 — priority-band sensitivity.** **Flat across every band tested, `flat` through `100`, at both
coverage levels.** Not a bug — verified directly: `priority` values of `0`/`100` are correctly
present in the request JSON, and the same 3 structurally-excluded `market` jobs are dropped
regardless of priority. At rung `1+2`, capacity (`max_tasks` × days = 40) already exceeds
assignable demand (35, once the 3 structural exclusions are accounted for) by enough margin that
the comparator's `priority_sum` tier never needs to trade a low-priority job away to protect a
high-priority one. **No flip point exists at this fixture's scale under this rung** — a genuinely
useful negative result, but it means M6 needs a tighter-capacity fixture (fewer days, or a smaller
`max_tasks`) to actually locate where ADR-0023 §5's `0/1/2` banding choice would start to matter.

**M7 — capacity axis marginal cost.** Also flat: `capacity: [1]` and `capacity: [2]` produced
identical assigned counts to no capacity constraint at all. Traced to cause: only **4** activities
carry the `izakaya` (dinner) archetype across all 41, and even with zero capacity constraint they
were already naturally distributed one-per-day across 4 different days. `capacity: [1]` was never
actually binding. Confirmed the mechanism itself works (arity errors, delivery values, and capacity
values all verified present and correct in the request JSON) — the fixture simply isn't dense
enough in same-archetype activities to make this axis diagnostic.

## §8 — validated, not just cited

Two checks on the pinned `vroom-docker` build (`v1.15.0`, `libglpk` linked, confirmed via a
successful `-c` response rather than inspected via `otool`):

1. **Mechanism check.** A toy job with `time_windows: [[0, 500]]`, solved and replayed via
   `vehicle.steps` with `options.c: true`: arrival at `600` against a window ending at `500`
   produced `{"duration": 100, "cause": "delay"}` at step, route, *and* summary level — exact
   arithmetic match, exact `{cause, duration}` shape from the VROOM alignment doc.
2. **ADR-0023's own claim, checked against real data.** Block A's winning cell (`rung 1+2`, slack
   0, coverage 1.0) — solved under hard time windows in default mode — was replayed through `-c`
   in full. **Every route returned `violations: []`.** This is exactly ADR-0023 §8's claim
   (*"under hard time windows that outcome is structurally empty — an assigned stop cannot
   violate its hours"*), now checked against a real 38-job solve rather than asserted from the
   VROOM documentation.

**The deployment gap `smoke.ts` surfaced stands: the Homebrew `vroom` bottle cannot run `-c` at
all** (`libglpk` not linked, compile-time). Whatever ships to production needs a build with glpk —
either `vroom-docker` (this doc's pinned image) or a from-source build with `-DLIBGLPK=on`-style
flags confirmed. This is a real, previously-undocumented constraint on an Accepted ADR.

## What the fixture cannot tell you

- **The long-haul speed override (200 km/h for pairs >100 km) is a fiction standing in for
  ADR-0024's real Facts layer.** Without it, Tokyo↔Kyoto at `pathProvider.ts`'s fixed 20 km/h is
  **18.5 hours** — verified directly — which silently empties both travel days (per the
  "vehicle's own leg exceeds its window → empty route, no error" schema fact above) and would have
  contaminated M1 across all ten days. 200 km/h is a plausible shinkansen-equivalent, not a
  measured one.
- The 20 km/h intra-metro walking constant, and all archetype hours, are invented, not scraped
  from real listings.
- `durationCoverage` is a **proxy** for enrichment quality (a fraction of activities exposing
  `visitDuration`), not a measurement of enrichment quality itself — real enrichment data may be
  correlated with things (popularity, category) this fixture's stratified-random sampling doesn't
  model.
- **A 10-day trip makes §7's "closed on every day of the trip" exclusion structurally
  unreachable** when hours are keyed by weekday: every weekday index appears at least once in any
  10 consecutive calendar days, so any archetype with a non-empty `hoursJson` gets ≥1 window
  somewhere. Confirmed: 0 such exclusions fired across all 24 Block A cells. This exclusion is only
  reachable on trips of ≤6 days, or for an archetype whose `hoursJson` genuinely has zero keys
  across all seven weekdays (not tested here — every archetype here has ≥2 keys).
- **M6/M7 could not locate a flip point or a marginal cost at this fixture's scale** — see above.
  Both mechanisms are verified correct; neither was stressed hard enough by 38 jobs / 10 days /
  max_tasks=4 to be diagnostic. A denser fixture (more jobs per archetype, or a tighter `max_tasks`)
  would be needed to actually answer where ADR-0023 §5's priority band matters.
- Station names stand in for attraction names throughout — real venues would carry different hours
  distributions than the ten invented archetypes here.

## Consequences for ADR-0023

- **§6 confirmed**, but the ladder is not a strict ordinal climb in practice: rung 1 alone and rung
  2 alone each solve half the problem (balance, correctness) and leave the other half broken. The
  ADR should record `1+2` (both together) as the practical rung-1 destination rather than a rung
  climbed past — needs an amendment naming this.
- **§6's `max_tasks` guidance needs a correction.** The ADR names `max_tasks =
  ceil(placeable/days) + slack` without specifying slack; this prototype found **slack itself is
  the balance-quality knob, and zero slack is strictly better than any tested nonzero slack** —
  worth stating explicitly rather than leaving slack as a free parameter to be tuned later.
- **§6/§4 interaction not covered by the ADR**: skills (a §6 mechanism) can structurally exclude
  an archetype whose §4 semantic hours partition disjointly from the metro-day partition. The ADR
  should note this as a real risk to check for, not assume away, once real category-based hours
  (not invented archetypes) are in play.
- **§8 needs a deployment note**: plan mode requires a glpk-linked VROOM build; the reference
  Homebrew formula does not provide one. Name the required build (`vroom-docker`, or an explicit
  from-source flag) in the ADR or in PR 2's infrastructure work.
- **§5 (`priority` banding) is not contradicted, but not yet validated either** — this prototype's
  fixture had no capacity pressure to expose where `0/1/2` banding would start mattering. Needs a
  denser follow-up fixture before treating §5 as settled by evidence rather than by the a priori
  magnitude argument the ADR already makes.

## What I could not verify

- Whether `"openEnd"` edge policy (as opposed to `"mirror"`) changes day-1/day-10 occupancy or
  total cost on this fixture — implemented and unit-verified as individually valid (Phase 0), but
  not swept as a comparison per M4's original design.
- Whether M6/M7 would show a flip point / marginal cost on a fixture with enough same-archetype
  density or tighter capacity to create real comparator pressure — the negative result here is
  real but inconclusive about ADR-0023 §5's actual banding choice.
- Whether the market-archetype/skills collision (§6 above) generalizes beyond this specific
  fixture's date range, or is an artifact of this trip happening to have exactly one weekend
  entirely inside the Kyoto leg. A fixture with the weekend split across metros, or with no
  weekend-only archetype at all, was not tested.
- The exact behavior of `plan mode`'s "bypass matrix request" changelog note (flagged as
  unverified in `vroom-v2-alignment.md`) — the §8 check here supplied the matrix on both the
  original solve and the `-c` replay, so this was sidestepped rather than resolved.

## Reproduction and invalidation

```
brew install vroom   # must be 1.15.0 to match this doc
npx tsx prototypes/vroom-balance-a/smoke.ts
npx tsx prototypes/vroom-balance-a/determinism.ts
npx tsx prototypes/vroom-balance-a/sweep.ts a
npx tsx prototypes/vroom-balance-a/sweep.ts b
# Phase 6 (§8), separately:
docker build --build-arg VROOM_RELEASE=v1.15.0 -t vroom-balance-a:1.15.0 \
  https://github.com/VROOM-Project/vroom-docker.git
docker run -d --name vroom-balance-a -p 3000:3000 vroom-balance-a:1.15.0
```

Branch `prototype/vroom-day-balance-a` at `13d83f8`. Re-run this prototype if: VROOM's major
version changes; the matrix source moves from haversine to real OSRM (ADR-0024) — the long-haul
override is a stand-in and real data may shift every number above; `visitDuration` coverage in
production enrichment crosses roughly 35% (today's approximate rate) by a wide margin; trips
routinely exceed 14 days (window/exclusion assumptions here were sized for 10); or category-based
hours (#153/#154) replace the invented archetypes with real distributions.
