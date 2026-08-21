# ADR-0033: Boarding a premium service costs flat minutes, charged once per boarding

- **Status:** Accepted
- **Date:** 2026-08-21
- **Supersedes:** —
- **Superseded by:** —
- **Constrained by:** ADR-0019 (the coarse duration model: one effective speed per line type, a flat
  `TRANSFER_MINUTES` for platform walk and wait, no timetables in Phase 1 — so no headway data
  exists to model frequency properly), ADR-0022 (a Path is one shift; travel cost is composed),
  ADR-0024 (§3's blended matrix — `costMatrix` and `describeJourney` share one search, so this
  reaches the optimizer and the map alike), ADR-0032 (§5's sum invariant: the decomposed chain must
  sum to the search's own total, which decides where this charge is carried)
- **Note:** Decided while scoping
  [#193](https://github.com/Tyler-Reagan/trip-kraken/issues/193), under map
  [#181](https://github.com/Tyler-Reagan/trip-kraken/issues/181). Every figure below is measured on
  the pinned `260101` national graph, re-ingested with #192's classifier fix, against the twelve-Leg
  eval ADR-0019 §J5 recorded together with its real-world reference times.

## Context

[#192](https://github.com/Tyler-Reagan/trip-kraken/issues/192) fixed a classifier that had never
once fired: zero of 1,419 lines were typed `shinkansen` or `limitedExpress`, so every Shinkansen ran
at the 45 km/h `commuter` speed. Re-running ADR-0019's own J5 eval on a graph rebuilt with that fix
shows what it bought, and what it cost:

| | before #192 | after #192 |
| --- | --- | --- |
| Urban (9 Legs) | 0.988× | 0.781× |
| Trunk (3 Legs) | 3.613× | 0.760× |

Trunk journeys are transformed — Tokyo→Shin-Osaka went from 547 minutes to 115 against a real ~150.
But **urban journeys regressed from near-perfect to 22% fast, because the search began routing
ordinary city travel onto the Shinkansen**:

```
東京 → 品川    4 min via のぞみ         (real 8–10)
東京 → 上野    4 min via こまち列車      (real 5–8)
渋谷 → 上野   22 min via 成田エクスプレス → のぞみ → こまち列車
```

Sampled over 91 real Tokyo-area station pairs, holding the premium line-name set fixed so the two
runs are comparable: **0% before #192, 16% after.**

This is not a new class of defect. ADR-0019's J5 eval named it in 2026-07, when Tokyo→Shibuya
resolved to 成田エクスプレス — "an infrequent, reserved-seat airport train no one takes for this
hop" — and Tokyo→Yokohama to 踊り子. #192 did not create the defect; it made those lines genuinely
fast, and so made the defect bite.

**The root cause is that the cost model has exactly one dimension.** A Path's cost is time. Fare,
seat reservation, and frequency are not represented anywhere, so "fastest" is unconditionally
"best," and a 220 km/h service wins a two-station hop it would be absurd to buy a ticket for.

## Decision

**Boarding a premium service costs a flat number of minutes, charged once per boarding.**

```ts
export const PREMIUM_BOARDING_MINUTES: Record<LineType, number> = {
  subway: 0, commuter: 0, limitedExpress: 15, shinkansen: 30,
};
```

### 1. A time proxy, because time is the only currency this model has

The charge stands for the fare, the reserved seat, the separate gate, and the wait. None of those
are time. Adding a real money or frequency dimension would change what a `TravelCost` *is* and reach
into ADR-0023's objective and ADR-0024's blended matrix; a proxy inside the existing currency is the
smaller true thing. ADR-0019 already does exactly this with `TRANSFER_MINUTES`, which stands for
"platform walk + wait, deliberately not split."

It is also not purely a proxy. A traveler really does spend that time — reaching the Shinkansen
gates, collecting a ticket, waiting for a booked departure — which is why charging it makes trunk
journeys *more* accurate rather than merely less attractive (§4).

### 2. Charged per boarding, never per hop

Per-hop would scale the fare with the number of stations, which is not how fares work, and would
distort long journeys in proportion to how many times they stop.

Per-boarding is what makes the charge discriminate correctly: a 150-minute trunk journey absorbs 30
minutes, while a four-minute Shinagawa hop becomes 34 and loses to the nine-minute local. Measured:
each of the three trunk Legs boards exactly once, so each pays the charge exactly once.

### 3. It attaches to the transfer edge and the seed, which needs no new search state

Stop node ids are scoped per OSM route relation (`relationId:osmNodeId`), so a ride edge never
leaves its own line and **changing lines always crosses a transfer edge**. A transfer edge is
therefore exactly the moment of boarding, and the only other one is the seed — starting the Journey
already on that line.

So the charge lands in two places, keyed off the *destination* stop node's line type, and Dijkstra
needs no extra state to know whether a boarding is happening. This falls out of the graph's own
shape rather than being arranged for.

### 4. 30 minutes for Shinkansen, 15 for limited express, bracketed by measurement

Two independent constraints bound the value, and they leave a window:

- **Lower** — for a short urban hop the charge must exceed the gap between the premium route and the
  local one, or the search keeps choosing the Shinkansen. Measured by deleting every premium line
  from the graph and re-routing: the binding case is Tokyo→Yokohama at **15.5 minutes**.
- **Upper** — the trunk estimates *undershoot* reality by **24–35 minutes** (mean 31), so a charge
  in that range corrects rather than overshoots.

A sweep across the window confirms it:

| shinkansen / ltd exp | urban | trunk | all | urban pairs routed premium |
| --- | --- | --- | --- | --- |
| 0 / 0 | 0.781× | 0.760× | 0.776× | 15/91 (16%) |
| 10 / 5 | 0.972× | 0.839× | 0.937× | 0/91 |
| 15 / 8 | 0.988× | 0.879× | 0.959× | 0/91 |
| 20 / 10 | 0.988× | 0.919× | 0.970× | 0/91 |
| 25 / 13 | 0.988× | 0.958× | 0.980× | 0/91 |
| **30 / 15** | **0.988×** | **0.997×** | **0.990×** | **0/91** |
| 40 / 20 | 0.988× | 1.076× | 1.009× | 0/91 |

30 sits inside the independently-derived 24–35 minute shortfall, and comfortably above the 15.5
minute floor — the two bounds were measured separately and agree.

**Urban saturates at 0.988× from 15 minutes upward — bit-identical to the pre-#192 value.** That
saturation is the strongest evidence the charge does the intended job and nothing more: once premium
lines stop being selected for city hops, urban routing is exactly what it was before the classifier
fix. The charge is not tuning urban journeys; it is removing an option that should never have been
on the table.

**The limited-express figure is weakly grounded and is recorded as such.** Nothing in the urban
sample was contaminated by a limited express — 成田エクスプレス, the line J5 originally complained
about, is not even classified premium, since it carries no `duration` tag for #192's classifier to
read. 15 is half the Shinkansen figure, chosen because a limited express carries a smaller surcharge
and less ceremony. It is a placeholder with a rationale, not a measurement.

**A first sweep was run against a defective implementation and its numbers are not the ones above.**
`snapWithWalkCost` serves both ends of a Journey, so charging boarding there also charged it on
*arrival* at a premium station — a phantom fee for alighting. It flattered trunk journeys and made 25
minutes look optimal. The provider's own sum-invariant test (ADR-0032 §5) caught it, which is the
second time that invariant has paid for itself; the charge now lands at the seed instead (§3).

### 5. The charge is carried by the rail Path, not the walk in front of it

ADR-0032 §5 requires the decomposed chain to sum to the search's total, so the charge has to be
carried by some Path. The traveler physically spends the time *before* boarding, which argues for the
preceding access-walk or transfer Path — and that is the reading this ADR rejects.

**[#140](https://github.com/Tyler-Reagan/trip-kraken/issues/140) is about to replace every walk
Path's cost with a real routed one.** A walking Path carrying a Shinkansen surcharge would either be
silently overwritten by that work or have to be unpicked first. A walk stays a walk, and the charge
rides with the service that levied it.

The cost is a rail Path reporting a duration longer than its ride: a four-minute hop reads as 29
minutes. That is the honest total for "ready to travel until arrived," and it is the number the
Journey needs; the alternative reads as a 571-metre walk taking half an hour, which is worse.

### 6. This reaches the optimizer, deliberately

`costMatrix` and `describeJourney` share one search (ADR-0024 §3), so the charge changes planning as
well as display. That is correct: a Plan should not be built around Shinkansen hops the traveler
would never buy. It does mean re-optimizing an existing Plan may reshuffle it — expected, and
ADR-0026's self-heal already handles a changed cost locally.

## Alternatives considered

- **Lower `LINE_TYPE_SPEEDS_KMH[shinkansen]` instead.** Rejected: it re-breaks what #192 fixed. The
  Shinkansen genuinely is fast, and slowing it enough to lose a two-station hop would make
  Tokyo→Osaka wrong again. The problem is not the speed; it is that the ride is otherwise free.
- **Model fare or frequency properly, as their own dimension.** Rejected for now (see §1): it
  changes what a `TravelCost` is, and ADR-0019 Phase 1 has no timetable data to derive a headway
  from. Revisit if a money dimension is ever wanted for its own sake.
- **Charge per hop rather than per boarding.** Rejected (see §2): scales a fare by station count.
- **A traveler-facing toggle instead** ("no Shinkansen"). Rejected as a *substitute*, kept as a
  complement — see Consequences. A traveler who allows Shinkansen, which most will, still should not
  be routed onto one for a single stop; that is a modelling question, not a preference.
- **Carrying the charge on the preceding walk or transfer Path.** Rejected (see §5): #140 is about to
  rewrite those costs.
- **Excluding premium lines below a distance threshold.** Rejected: a cliff, and it answers a
  smooth question ("is this worth the fare?") with a hard edge that would misfire either side of it.

## Consequences

- `PREMIUM_BOARDING_MINUTES` joins `LINE_TYPE_SPEEDS_KMH` and `TRANSFER_MINUTES` as a tuned constant
  in `osmTransitProvider.ts`, tuned the same way — against the J5 eval, not in the abstract.
- **The whole J5 eval now sits at 0.990×**, from 0.776×. Both halves are healthy for the first time:
  urban 0.988×, trunk 0.997×.
- **Three Legs remain wrong, and none of them for a reason this ADR addresses** — recorded so they
  are not mistaken for residual mis-tuning of this charge:
  - *Tokyo→Ikebukuro, 16 min against a real 24–27 (0.64×).* The original 2026-07 J5 finding,
    untouched by everything since. A speed problem: 45 km/h is too fast for a dense loop averaging
    ~37, and the Yamanote's own traced-to-straight ratio (1.0569) means a distance recompute moves it
    only to 16.9.
  - *Tokyo→Shibuya via 成田エクスプレス (0.68×) and Tokyo→Yokohama via 踊り子 (1.40×).* Both are the
    exact lines J5 complained about in 2026-07, and **neither is classified premium**, because
    neither carries the `duration` tag #192's classifier reads. The charge cannot penalise a line the
    classifier cannot see. Widening classification to reach them is the natural follow-on, and it
    would want ADR-0019's rejected line-name allowlist rather than another tag.

  All three are variance *between* line types rather than a uniform bias, which is why a finer
  taxonomy (local vs rapid vs loop) is the shape of the next improvement, not another scalar.
- **This answers [#193](https://github.com/Tyler-Reagan/trip-kraken/issues/193) in the negative.**
  That ticket asked whether to recompute `RideEdge.distanceMeters` from traced track length and
  retune the speed table, and required "whether it is worth doing at all" be answered first. With
  this charge in place the model is already at 0.989×, so a +8.1% distance recompute would push it to
  ~1.07× — worse — unless speeds rose ~8% to compensate, which is a wash. It does not fix the one
  remaining bad Leg either: Tokyo→Ikebukuro at 0.64× is a *speed* problem (45 km/h is too fast for a
  dense loop averaging ~37), and the Yamanote's own traced-to-straight ratio is 1.0569, which moves
  16 minutes to 16.9 against a real 24–27. The remaining error is variance *between* line types, which
  wants a finer taxonomy (local vs rapid vs loop), not a uniform distance or speed change.
- **A traveler-facing rail toggle is complementary and deferred.** CONTEXT.md already reserves the
  place for it: *allowed kinds* "returns only if a traveler-facing selector does." Line-type filtering
  is fully supported by today's data (every stop node carries `lineType`: 945 commuter, 107 subway, 18
  limitedExpress, 5 shinkansen) and would need no ingest change. Operator filtering — "only JR
  lines" — is **not** safely buildable and is deferred on measured grounds:
  - `operator=*` covers 80.6% of rail relations nationally, vindicating ADR-0022's "commonly carry"
    — but it needs a curated alias table, since JR East alone appears under six spellings
    (`東日本旅客鉄道`, `JR東日本`, `東日本旅客鉄道株式会社`, `東日本旅客鉄道 (JR East)`, `JR East`, and
    `JR東北線`, which is a line name mis-tagged as an operator).
  - `network` is not a cleaner grouping key: 168 values mixing companies, service areas, and line
    groups.
  - **Coverage collapses to 54% on exactly the premium lines that matter** — 16 of 35 have no
    operator at all, including はやぶさ, こまち, はやて, やまびこ, なすの, かがやき and はくたか. A
    "JR only" toggle built on this tag would silently exclude most JR Shinkansen, inverting what the
    traveler asked for.
  - Separately: **"JR Pass" is not "JR operator."** のぞみ and みずほ are JR services the Pass does
    not cover, so a Pass-shaped toggle is a different predicate from an operator-shaped one.
- **ADR-0022's operator bill is overdue and should be paid with the next schema change.** That ADR
  deferred capturing `operator=*` to "#142's graph-schema change rather than paying for a re-ingest
  twice"; #142 shipped as ADR-0030, changed the schema, and did not capture it. Capturing it later
  now costs a third ingest run.
