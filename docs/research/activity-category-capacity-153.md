# Measurement: the food-category capacity axis's unassignment cost (#153)

- **Answers:** #153's acceptance criteria — "Each axis added is accompanied by a recorded
  before/after unassignment count on a realistic trip" and "An axis that measurably costs
  placements is either widened or dropped, and the decision is written down."
- **Method:** same as Prototype A's M6/M7 (`vroom-day-balance-a.md`) — direct requests against the
  running VROOM container (`localhost:8080`), no app plumbing. Not shipped; this doc is the record.

## Why Prototype A's own capacity measurement didn't settle this

M7 tested `capacity: [1]` and `capacity: [2]` on Prototype A's 41-activity fixture and found both
flat against no constraint at all — traced to only 4 of 41 activities carrying the "izakaya"
(dinner) archetype, already naturally spread one-per-day across 4 different days. The mechanism was
confirmed working (arity, delivery values, capacity), but the fixture had no real category density
to press against, so it couldn't answer what cap actually costs placements.

## Fixture

7-day trip, 5 activities/day (35 total) — **3 "food" + 2 "sight" per day**, a food density (60%)
representative of a real day's shape (breakfast/coffee, lunch, dinner), denser than Prototype A's
own fixture on purpose, since that low density is exactly why M7's measurement went flat. One
shared depot per day (a lodging stand-in), flat 15-minute inter-stop travel, 60-minute service, an
8-hour day budget — travel/service/budget are not the variable under test, only `capacity` is.

## Result

| `capacity` | unassigned (of 35) |
| --- | --- |
| none (baseline) | 0 |
| `[1]` | 14 |
| `[2]` | 7 |
| `[3]` | 0 |
| `[4]` | 0 |

`[1]` and `[2]` cost exactly what the fixture predicts (2 and 1 dropped per day × 7 days) — the
mechanism presses on real density exactly as expected this time. `[3]` is the first value that
costs **zero** placements, matching the fixture's actual per-day food count precisely; `[4]` costs
nothing further, confirming `3` isn't a fixture artifact one unit away from binding.

## Decision

**`FOOD_CAPACITY_PER_DAY = 3`** (`src/lib/vroom/request.ts`) — the minimum cap that measures zero
placement cost on a realistic-density fixture, per ADR-0023 §4's "starting generous" rule. Not
widened further: `[4]` buys nothing this measurement can show, and a cap loose enough to never
matter isn't a constraint, just dead weight on every request.

This is deliberately **not** "at most one dinner" (ADR-0023 §4's own illustrative example) — this
vocabulary has no breakfast/lunch/dinner distinction yet (`activityCategory.ts`'s `food` bucket is
undifferentiated), and a meal-time-specific rule would need one, which is a real, separate follow-up
(`ActivityCategory` gains a time-of-day axis, or `dayWindowsFor` intersects category with hours —
ADR-0023 §4's twin "meal-time preferences" row) rather than this ticket's scope. What ships here is
the generic "not absurdly many food stops in one day" guard-rail the acceptance criteria asked for:
plumbing proven end-to-end (category → capacity/delivery → VROOM → diagnosis), calibrated against
real pressure rather than a guess, on the one axis actually wired.

## Re-running this measurement

The script isn't checked in — throwaway, per this repo's `prototype` convention. To reproduce:
build jobs/vehicles directly (bypass `buildVroomRequest`) with the fixture shape above and POST to
`localhost:8080`, varying `capacity`/`delivery`. Needs the `vroom` container running
(`docker compose up -d vroom` from the repo's compose file).
