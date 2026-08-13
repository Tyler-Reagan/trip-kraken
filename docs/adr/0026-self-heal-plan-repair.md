# ADR-0026: A single bad Placement self-heals in place; the escape hatch to re-optimize stays, but is never forced

- **Status:** Accepted
- **Date:** 2026-08-12
- **Supersedes:** —
- **Superseded by:** —
- **Constrained by:** ADR-0021 (Path is derived from the Plan, never stored), ADR-0022 (a Journey is
  "not stored and not scored," computed from Placements at read time), ADR-0018's 2026-08-08
  amendment (a `TravelCost` answered by `google` must never be persisted — issue
  [#158](https://github.com/Tyler-Reagan/trip-kraken/issues/158)), ADR-0018's 2026-08-12 amendment
  (a provider declines a cell it cannot answer rather than throwing)
- **Note:** Decided while grilling a live optimize failure (`ROUTE_NOT_FOUND` on a Location whose
  coordinates had been mis-resolved to another continent by an unrelated enrichment defect). The
  user's framing: today, the only recourse for a bad Placement is removing its Location and
  re-running the whole optimize — a cost that should be optional, not forced, when the fix is local.

## Context

A Plan can end up with one Placement a user doesn't want — an irrational or malformed Journey next to
it, or (as in the diagnosed case) a Location whose data was simply wrong. Today the only recourse is
`DELETE /api/trips/[id]/placements/[placementId]` followed by a full re-optimize: correct, but it
discards and re-derives every other Placement in the Trip to fix one.

That cost is not required by anything in the domain model. `CONTEXT.md` already says a Path is
"derived from the Plan, never stored," and a Journey is "not stored and not scored" — computed fresh
at read time. The machinery to answer "what does this pair of Placements cost to travel between,
right now" already exists per-pair; nothing about removing one Placement requires touching any other.

Re-running the whole optimize remains the better tool when the user wants overall route quality
re-considered — VROOM re-sequencing a Day can produce a genuinely better arrangement than the one
being edited around. That option must stay available. What must stop is *forcing* it: a user pruning
one bad Location should not have to pay for a global re-solve to get a locally coherent Plan back.

This ADR names that local repair **self-heal** — chosen over "repair," which reads as something a
user initiates and waits on. Self-heal is not domain vocabulary in the `CONTEXT.md` sense: it names a
UI/API behavior (what happens automatically when a Placement is removed), not a new primitive on the
Trip/Location/Plan/Path axis, so it is deliberately not added to `CONTEXT.md`'s glossary.

## Decision

**Removing an activity Placement self-heals its Day: the gap closes, no other Placement moves, and
the new adjacent pair's travel cost is fetched by one on-demand lookup — never a re-sequence, and
never a retained matrix.** Re-running optimize remains available and unchanged, as the tool for when
the user wants the whole Plan reconsidered rather than one Placement removed.

### 1. Closing the gap does not re-sequence the Day

Removing a Placement makes its neighbors adjacent. Nothing about the *order* of the remaining
Placements changes — self-heal is the removal's direct consequence, not a fresh sequencing pass.
Re-sequencing the Day (even just around the gap) is a small optimization in its own right: it would
change a Plan the user did not ask to change, in exchange for route quality they did not ask to
reconsider. A user who wants that already has the button for it.

`removePlacement` (`src/lib/db/index.ts`) already does the storage half of this correctly — it
deletes the one row and does not touch any other Placement's `order`. Self-heal's remaining
responsibility is entirely on the read/display side: computing the cost of the one new pair the
removal created.

### 2. The new pair's cost is one on-demand lookup, not a retained matrix

The optimize-time matrix is not kept after the run — nothing persists it today, and ADR-0018's
2026-08-08 amendment forbids persisting any cell `answeredBy: "google"` regardless (#158). Self-heal
does not change that: it calls a single Journey lookup (`PathProvider.describeJourney`, or the
registry's per-pair dispatch) for the one newly-adjacent pair, at display time, exactly as `CONTEXT.md`
already describes a Journey being computed — "not stored and not scored."

This sidesteps the persistence question entirely rather than answering it: there is no cache to key on
`answeredBy` versus `basisOfCost` (the distinction ADR-0018's amendment already had to spell out for
any future matrix cache), because self-heal never retains a matrix in the first place. One pair, one
call, discarded after.

### 3. `google` must decline for this lookup, not throw

Self-heal runs immediately after a user's corrective action — they just removed the Location they
identified as the problem. A throw here would be worse than a throw during optimize: the user did
exactly the right thing and the app still failed on them. ADR-0018's 2026-08-12 amendment already
establishes that a provider declines a cell it cannot answer rather than throwing; self-heal is the
second, and more time-sensitive, consumer of that guarantee. A declined cell falls through to
`haversine`, visibly stamped `basisOfCost: straightLine` — an honest "no real route" rather than a
failed repair.

### 4. Self-heal applies to activity Placements only; removing lodging asks for a re-run

A lodging Location is a constraint, not a candidate: `CONTEXT.md` defines a Day's Anchor as *derived*
from lodging's `checkIn`/`checkOut` dates. Removing a lodging Placement (via `clearLodging`, which
relegates the Location back to `kind: activity`) can remove the Anchor one or more Days were built
around. There is no local repair for that — the Days in question need their Anchor re-established and
very possibly re-optimized, because the Plan for them rested on a constraint that no longer holds.

Self-heal is therefore scoped to `Placement` removal for a Location of `kind: activity`. Removing a
lodging surfaces which Days lost their Anchor and tells the user those Days need a re-run — the honest
"why," not a silent repair that papers over a broken Plan.

## Alternatives considered

- **Re-sequence the affected Day on every removal.** Rejected (see §1): produces route-quality
  improvements the user didn't ask for and didn't approve, changing Placements they have no reason to
  expect moved.
- **Retain the optimize-time matrix and serve the new pair's cost from it.** Rejected (see §2): reopens
  the #158 persistence question for no benefit — a repair touches one pair, so a matrix-wide cache
  buys nothing a single lookup doesn't already provide, at the cost of new machinery to keep in sync
  with #158's `answeredBy` rule.
- **Show no cost until the next full optimize.** Rejected: cheapest to build, but leaves the Plan
  visibly incomplete (a Journey with no duration) for what is otherwise a fully healed Day — worse
  user experience than one extra lookup for no real savings.
- **Extend self-heal to lodging removal, re-deriving affected Days' Anchors automatically.** Rejected
  for this ADR (see §4): a lost Anchor is a constraint-level change, not a local edit, and silently
  re-optimizing around it risks producing a Plan the user doesn't recognize as a response to what they
  did. Revisit only if lodging removal turns out to be common enough that a one-line "these Days need
  a re-run" prompt proves insufficient in practice.

## Consequences

- The activity Placement's `DELETE` route gains a read-side responsibility: computing and returning
  the newly-adjacent pair's Journey (or a `basisOfCost: straightLine` decline) alongside the removal,
  rather than leaving the client to infer it.
- No schema change and no new persistence: self-heal is a request-time computation, not a stored
  concept.
- Depends on ADR-0018's 2026-08-12 amendment being implemented first (`google` declining rather than
  throwing) — without it, self-heal's one on-demand lookup can still throw on exactly the case it
  exists to smooth over.
- Bill that comes due later: if a genuine case for ADR-0023's deferred fourth pre-flight-exclusion
  reason ever appears (a Location inside a covered metro that no non-terminal provider can route to,
  per that ADR's 2026-08-12 amendment), self-heal's on-demand lookup is the other place, besides the
  optimize-time matrix, that would surface it — worth checking both when that reason is eventually
  built.
- Implementation (the `DELETE` route's read-side change, and its UI consumer) is tracked as a separate
  issue, not built by this ADR.
