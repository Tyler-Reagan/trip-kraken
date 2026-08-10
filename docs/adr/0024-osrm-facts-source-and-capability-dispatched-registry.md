# ADR-0024: OSRM is the primary road Facts source; the registry dispatches on provider capability, and the Facts layer always materializes the matrix

- **Status:** Accepted
- **Date:** 2026-08-07
- **Supersedes:** —
- **Superseded by:** —
- **Amends:** ADR-0004 (the provider registry gains capability declaration; a provider may **decline**
  a cell; the matrix is *composed* from several providers rather than answered by one), ADR-0018 (its
  representative-time matrix policy survives intact; its provider-selection precedent is generalized
  from "which provider wins the trip" to "which provider answers this cell"), ADR-0019 (the OSM-Japan
  provider becomes one capable provider among several rather than the whole-trip winner for any
  Japanese trip)
- **Constrained by:** ADR-0022 (the Path taxonomy and `describeJourney`'s signature — this ADR adds
  no shape to it), ADR-0016 / ADR-0017 (surface degradation, do not hide it), ADR-0009 (Location as
  the one place primitive)
- **Feeds:** ADR-0023 (the Decision layer consumes the matrix this ADR produces)
- **Note:** Decided in the 2026-08-07 design session. The road-data half is backed by
  `docs/research/osrm-viability-149.md`; the registry half came out of grilling the v2 plan's own
  three-row registry and finding it had cut one concept while meaning to cut another.

## Context

Two decisions meet here, and separating them would leave neither legible.

**The road-data half.** Google Routes has been the global default provider whenever an API key is
configured (ADR-0019). It is metered, which puts a per-request cost on the bulk N² path the solver
depends on most, and it is the only source we have for walking, driving and cycling. OSRM is
BSD-licensed, self-hosted, and returns a full N² table in one request; `docs/research/osrm-viability-149.md`
establishes it as viable, with a named residual risk about regional OSM road quality that prototype B
exists to close.

**The registry half.** The v2 plan proposed a three-entry registry — `osm-japan` when in Japan,
`osrm` when configured, `haversine` always — first match wins, one provider serving the whole trip at
both altitudes. Grilling it exposed that this neuters the provider library: on any Japanese trip the
rail-graph provider would win outright and walking legs would be routed through a rail graph, while
bus and ferry would have no source anywhere because the plan also cut Google from routing entirely.

The cause was a conflation the plan inherited rather than chose. The existing
`appliesTo(points, kinds)` predicate did two unrelated jobs at once:

- **Willingness** — which kinds the *traveler* permits. A Trip-level column (`allowedPathKinds`) with
  no production writer, always NULL, threaded unresolved through six call sites where each provider
  had to invent its own precedence to collapse it. This is what generated complication at every turn.
- **Capability** — which kinds a *provider* can answer for. A static constant, known when the code is
  written, never user input, never threaded.

The plan's instruction to delete "every kinds-based registry predicate" cut both. Only the first
deserved it. The evidence that the cut overshot is in the code: ADR-0022 as amended specifies
`describeJourney(from, to, kinds, opts)`, and the merged P2 shipped exactly that signature — the plan
was deleting an argument the surviving ADR requires.

## Decision

### 1. OSRM, self-hosted, is the primary road Facts source

Three `osrm-routed` instances — `foot`, `car`, `bike` — from a pinned Geofabrik extract, alongside
VROOM in one compose file. Two flags are not optional: `--algorithm mld` must be explicit (the binary
defaults to CH, contradicting OSRM's own README recommendation), and `--max-table-size 1000` raises a
default of 100 *locations* that would otherwise force a tiling loop at our scale.

The Geofabrik URL is **hoisted into a shared, sourced file** used by both this ingest script and the
existing rail-graph ingest. Road topology and rail topology must never disagree about which day's OSM
they came from.

`bicycle.lua` is **vendored with `use_public_transport = false`**. Stock is `true`, which makes
railways traversable at a flat 10 km/h tagged `mode.train` — a Japan bicycle route would return
fabricated train segments with no line, operator or timetable, and there is no honest bin for them
under ADR-0022. Ferry stays enabled on all profiles: a ferry is a constant-speed graph edge, and it
bins to `OtherPath`, the first real exercise of that union member.

This carries an **ODbL §4.3 attribution obligation** we already owed for the rail graph.

### 2. The Facts layer always materializes the matrix; VROOM never queries OSRM

VROOM can talk to OSRM directly, and `docs/research/vroom-v2-alignment.md` recommends letting it.
**We override that recommendation.** Three reasons, in order:

1. It is what the layering says — the Facts layer owns all I/O, and a Decision layer that fetches its
   own inputs is not behind a seam.
2. VROOM never sends OSRM's `fallback_speed`, and treats an unroutable pair as **fatal to the entire
   run**. Fetching ourselves yields `fallback_speed_cells` — a per-cell list of exactly which cells to
   stamp `basisOfCost: "straightLine"`, so one unroutable pair degrades one cell instead of failing
   the trip.
3. A request builder that takes an already-materialized matrix is testable with no server at all.

This is also what makes §3 possible: a matrix we assemble is a matrix several providers can
contribute to.

### 3. The registry dispatches on capability, and willingness is gone

Each registry entry declares the **kinds it can answer for** as a static array, alongside its
region/config gate. This is a statement of competence, not of preference — nothing about it is user
input, and no provider ever reinterprets it.

`allowedPathKinds` — the Trip column, `resolvePrimaryPathKind`, `DEFAULT_ALLOWED_PATH_KINDS`, and the
`Allowed kinds (Trip)` glossary entry — is **deleted**. `PathKind` survives in both of the roles that
remain: what a Path *reports*, and what a provider *can answer for*. A willing-kinds selector returns
later as an input to route-cost optimization, on a foundation that no longer threads an unresolved set
through six call sites.

**`kinds` is a selection predicate, not a bound on the return type.** Declaring `kinds: [bus]` says
"route bus queries here"; it does not promise every Path returned is a `BusPath`. The two are
different claims, and tests must say which one they assert.

### 4. A provider may decline a cell; the matrix is composed in preference order

`costMatrix` may return no answer for an individual cell. The matrix builder walks capable providers
in preference order, each filling what the previous left empty, with **`haversine` terminal** — it
never declines, which is what guarantees the matrix completes.

This is not new behaviour so much as relocated behaviour. `osmTransitProvider.costMatrix` already
falls back to haversine-walking per cell when no station is within snapping range — hardcoded inside
one provider and reachable by nothing else. Lifting it into the matrix builder deletes the hardcoded
version and makes the list pluggable.

The composition policy is **first capable provider wins each cell**. It is deliberately *not*
cheapest-across-modes: choosing the best of several modes per pair is multimodal cost composition,
which ADR-0022 explicitly deferred and which remains deferred here.

| # | id | kinds | gate |
| --- | --- | --- | --- |
| 1 | `osm-japan` | `rail` | in Japan; graph file present. Declines when no station is in range. |
| 2 | `osrm` | `walking`, `driving`, `bicycle` | OSRM URLs configured |
| 3 | `google` | `bus` | API key configured |
| 4 | `haversine` | terminal | always |

### 5. `basisOfCost` becomes honest per cell

Because each cell is filled by whichever provider answered it, each cell is stamped by that provider:
`railNetwork`, `routingService`, or `straightLine`. ADR-0022 deferred exactly this question — whether
`basisOfCost` is honest per matrix cell rather than per matrix — and noted it could not be settled
while the OSM-Japan provider mixed routed and straight-line cells inside one wholesale answer. Under
composition it is settled: a Kyoto trip can truthfully report rail here, walking there, and a straight
line for the pairs nothing could route.

The narration side already has the matching shape: a haversine journey returns exactly one
`UnknownPath` — no `kind` at all, because nothing was routed and no kind is claimable (ADR-0022).

### 6. Narration dispatches per Path, so one journey may draw on several providers

`describeJourney` returns the assembled chain of Paths for one A→B journey (ADR-0022). Under
capability dispatch, **different Paths in one journey may come from different providers**: walk to the
station via OSRM, ride via OSM-Japan, the city bus via Google, the final walk via OSRM again.

This is what ADR-0022's shift decomposition was built for — "a Path ends at every discernible shift" —
and a single-winner registry forbids it outright. It is the strongest single argument for this ADR.

`osrmProvider.describeJourney` uses `/route?steps=true&geometries=geojson`, grouping consecutive steps
by mode: `walking` plus `pushing bike` collapse to one `WalkingPath`, `ferry` becomes an `OtherPath`.

### 7. Google stays, scoped to `bus`, and bins its response honestly

Google is **not** cut from routing. It serves both `costMatrix` and `describeJourney`, config-gated,
scoped to `bus` — the one kind nothing else can answer, and therefore a genuine gap rather than a
duplicated capability. Its exposure is bounded by composition: it is only ever asked for cells no
higher-preference provider could fill.

Google has a **request axis and a response axis at different granularities**. You request one travel
mode — drive, bicycle, walk, transit — which is what the consumer product's tabs show; there is no
ferry mode to ask for. What returns on a transit route carries a *vehicle type*, and that enum is far
wider. ADR-0022 already enumerates all seventeen and bins them to `rail`, `bus` and `other`.

So the provider **must request `transitLine.vehicle.type`** and bin by ADR-0022's table, even though
its declared capability is `bus` alone. This matters *more* under a narrow scope, not less:
`BusPath` requires `lineName`, so an incidental ferry leg would otherwise be stamped with a fabricated
bus line and rendered as one. Deferring *ferry as a feature* and deferring *honest binning* are
separable concerns, and only the first is worth deferring.

`computeRoutePolyline` survives untouched. Finding places along a route is not routing, and the
discovery corridor is unrelated to this ADR.

> ### Amended 2026-08-07 — PR 2's design session corrects §1's shared pin and the CI claim
>
> Standing up the infrastructure exposed two places where this ADR wrote down a *mechanism* and
> meant an *invariant*, plus one claim that is now false.
>
> **§1's "the Geofabrik URL is hoisted into a shared, sourced file" is replaced by a shared OSM
> snapshot.** The rail pipeline needs all of Japan (it filters down to a 9 MB graph regardless);
> the road pipeline needs a sub-region, because `osrm-extract` on the full 2,370 MB Japan extract
> exceeds the memory available to it. There is therefore no single URL to share. What must never
> drift is the **date**: Geofabrik publishes the same dated snapshot across regions
> (`japan-260101.osm.pbf` and `japan/kanto-260101.osm.pbf` both resolve), so a shared
> `OSM_SNAPSHOT` composes into both paths and preserves the actual invariant this section was
> reaching for — that road topology and rail topology came from the same day's OSM. Region and
> snapshot are independent choices; the URL conflated them. `CONTEXT.md` gains **OSM snapshot**
> and **Extract** as distinct terms, and **Road graph** alongside Rail graph.
>
> **Region-scoping is safe because of §4, not despite it.** A trip outside the road graph's
> extract does not fail: OSRM returns no answer, `osrmProvider` declines those cells, and
> `haversine` — terminal — fills them as `straightLine`. The degradation is per cell and honest.
> The residual risk is diagnostic, not correctness: a trip wholly outside the extract silently
> routes entirely by haversine while OSRM appears healthy, which is indistinguishable *from the
> matrix's point of view* from OSRM being down. That is an argument for surfacing which provider
> filled each cell, and it lands on the pipeline built in PR 3.
>
> **The Consequences' "plus CI" is withdrawn.** It was written on the assumption that
> infrastructure implies a deployment to gate. Nothing is deployed, and where the routing services
> will eventually run is deliberately undecided (ADR-0025), so CI here would build a from-source
> solver on every push to verify containers that only ever run on one machine. A workflow that runs
> `npm test` is worth having on its own merits and is unrelated to this ADR.
>
> **§1 is confirmed, but its reasoning is replaced.** This ADR rejected metered providers on Google
> Routes' pricing, which sat badly with the project's preference for wrapping economical third-party
> providers. `docs/research/hosted-routing-alternatives.md` tested that against every viable hosted
> matrix API and reached the same conclusion on a stronger axis: **licence, not price.** Held to
> ADR-0019's NAVITIME test, Mapbox ("shall not export, download, cache or store results from any
> request to a Navigation API"), Stadia ("server-side caching is prohibited") and Google (§3.2.3(a)
> names "distance matrix results" under No Scraping; the Routes exception covers lat/lng only) each
> forbid precisely what §2 requires — a full N² matrix materialized server-side before the solver
> knows which pairs it needs. GraphHopper is disqualified on a narrow reading of its silence, which
> the research flags as its one judgement call. OpenRouteService alone passes, and its plan page has
> no purchasable tier above the free one. Self-hosting is not the expensive option here; it is the
> only one whose terms permit the architecture.
>
> **This is a live constraint on our own Google usage, not only on the alternatives.** §7 keeps
> Google for `bus` at both altitudes, and ADR-0018's representative-time matrix is a pre-fetch by
> construction. Nothing is persisted today, so this is a rule to respect going forward: a
> `TravelCost` or `PathGeometry` derived from Google must not reach SQLite.
>
> **§4's table gains a fifth row: hosted OpenRouteService, between `osrm` and `haversine`.**
>
> | # | id | kinds | gate |
> | --- | --- | --- | --- |
> | 1 | `osm-japan` | `rail` | in Japan; graph file present |
> | 2 | `osrm` | `walking`, `driving`, `bicycle` | OSRM URLs configured |
> | 3 | `google` | `bus` | API key configured |
> | 4 | **`ors`** | `walking`, `driving`, `bicycle` | **ORS API key configured** |
> | 5 | `haversine` | terminal | always |
>
> It earns the slot on four independent grounds. It is the only hosted candidate whose terms permit
> §2. It is free. It is **global**, which closes the diagnostic gap this amendment opened above — a
> trip wholly outside the region-scoped extract now falls to a real router before it falls to
> straight lines, so "outside the graph" stops being indistinguishable from "the graph is down." And
> its `foot-walking` / `foot-hiking` split offers a second opinion on OSRM's flat pedestrian speed,
> which is Prototype B's question. It costs the design nothing, because §4 already built the
> machinery: a provider that may decline a cell, walked in preference order, with `haversine`
> terminal.
>
> It sits **below** `osrm` deliberately. A free service run by a research institute can withdraw
> access, and the self-hosted graph is what guarantees we still answer. Two obligations ride along:
> results are **CC-BY-SA 4.0** — a stronger claim than the ODbL position `osrm-viability-149.md` §6
> established for our own graph, since share-alike asserted over query results has no Produced Work
> carve-out, inert while undeployed but not if itineraries are ever published — and the attribution
> string `© openrouteservice by HeiGIT`, which folds into
> [#150](https://github.com/Tyler-Reagan/trip-kraken/issues/150) rather than adding a new obligation.
> Its 3,500-element cap means two requests for a 60-point matrix. Building it is **PR 3's** work, not
> PR 2's; no container is involved.
>
> **§2's "the door stays open at no cost" is corrected — the door opens onto self-hosted routers
> only.** VROOM's `Server` struct carries host, port and path with no credential field, and
> `ors_wrapper.cpp` emits no `Authorization` header; vroom-express only ever passes `-a host` and
> `-p port`. Verified live: a hosted ORS endpoint returns `{"error": "Authorization field missing"}`.
> Keeping the compose ports aligned with the stock `routingServers` map is still free and still
> worth doing, but what it preserves is the option of pointing VROOM at *our own* OSRM, not at a
> hosted provider.
>
> **Two facts about the VROOM container that §2's "at no cost" clause depends on.** No VROOM image
> is published past `v1.14.0-rc.2`, so building `vroom-docker` from source pinned to `v1.15.0` is
> forced rather than chosen. And keeping the compose ports aligned with `vroom-express`'s stock
> `routingServers` map means the OSRM containers must *listen* on its numbering — car `5000`,
> bike `5001`, foot `5002` — not merely be published there, since that map names host and port
> together. Alignment done that way genuinely is free; a bind-mounted `config.yml` to achieve it
> would not be, because the stock config is the thing that already permits plan mode.

> ### Amended 2026-08-09 — the `bicycle` profile is dropped; `osrm` answers `walking` and `driving`
>
> §1 specifies three `osrm-routed` instances. **It ships two: `foot` and `car`.** §4's table changes
> accordingly — the `osrm` row declares `walking`, `driving`.
>
> The reason is that bicycle is the only one of the three whose cost is a *different kind* of cost.
> `foot.lua` and `car.lua` are used exactly as they ship inside the image: one container and one
> graph build each, and nothing to maintain afterwards. Bicycle cannot be used as it ships, for the
> reason §1 itself gives — stock `use_public_transport = true` makes any `railway` way traversable
> as `mode.train` at a flat 10 km/h, so on a Japanese extract a cycling route returns fabricated
> train segments with no line, operator or timetable, and ADR-0022 has no honest bin for them.
>
> §1's remedy was to vendor the profile with that flag flipped. Vendoring is what makes it
> expensive: OSRM's profiles are Lua scripts compiled into the graph at `osrm-extract` time and
> shipped *inside* the image, so a vendored copy is pinned to one image tag, must be re-taken and
> re-patched whenever that tag moves, and fails in a way nothing tests for. That is real, recurring
> maintenance in exchange for a capability **no caller in v2 requests**. Dropping the profile
> removes the vendoring problem rather than reducing it.
>
> **The finding is kept on the record deliberately.** Re-adding bicycle is a small change and the
> trap is invisible until someone reads a route response closely; anyone proposing it should have to
> meet this paragraph first.
>
> **Hosted ORS keeps `bicycle` in its declaration, and that is not an inconsistency.** §3 defines
> `kinds` as a statement of *competence*, and the two providers' competence is bounded by different
> things: ORS's by what the service can answer, `osrm`'s by **which graphs we choose to build**. A
> self-hosted provider's capability is a fact about our infrastructure, not about the software — a
> distinction worth naming, because it is the reason this amendment touches one row and not both.
>
> **Not decided here, and now visible:** nothing in this ADR says *which* profile answers a given
> matrix cell. §3 removed willingness, §4 fixes provider order, and neither states whether an
> ordinary city-trip cell is a walking cell or a driving cell. Walking is the obvious default for the
> trips being modelled, and `car` is built so the declaration is honest — but the selection rule
> itself is owed by the PR that builds the composition pipeline.

## Alternatives considered

- **Let VROOM query OSRM directly**, as `vroom-express`'s stock configuration expects and as the VROOM
  research itself recommends. Rejected for the three reasons in §2 — the decisive one being that VROOM
  treats an unroutable pair as fatal to the whole run while we can degrade a single cell. The compose
  ports are nonetheless kept aligned with `vroom-express`'s stock `routingServers` map, so the door
  stays open at no cost.
- **A three-row, first-match-wins registry** (the v2 plan as drafted). Rejected: one winner per trip
  has to be good at everything. It would route Tokyo walking legs through a rail graph, and leave bus
  and ferry with no source at all.
- **Cut Google from routing entirely**, on the reasoning that with no willingness set there is nothing
  to select it. Rejected once capability declaration replaced willingness — under §3 there *is*
  something to select it, and it is the only provider that can answer scheduled bus.
- **Keep `allowedPathKinds` and gate the registry on it.** Rejected: it has no production writer, is
  always NULL, and its indeterminacy — an unresolved set arriving at a provider that must invent a
  precedence to collapse it — is the specific thing that generated complication. Capability
  declaration recovers the useful half without any of that.
- **Give Google `other` as well, for ferries and funiculars.** Rejected as premature. Such crossings
  are rare enough to be obvious when they matter, and the honest-binning rule in §7 means an
  incidental one is still reported correctly rather than mislabelled. Adding the kind is a one-line
  change when a real trip needs it.
- **Compose the matrix by taking the cheapest available mode per cell.** Rejected as smuggling in
  multimodal routing. It is the genuinely interesting version of composition and it is #140's deferred
  question; ADR-0022 already ruled that making Paths the optimizer's currency turns each edge from a
  number into a set of alternative chains.
- **Keep the per-cell haversine fallback inside `osmTransitProvider`.** Rejected: it is the same
  mechanism §4 needs, trapped where nothing else can use it, and it is the reason `basisOfCost` could
  not be honest per cell.

## Consequences

- **Infrastructure exists for the first time.** No Docker, compose, or CI is in the repo today; this
  ADR requires all of it, plus a graph-build script, `db/osrm/` in `.gitignore` (the existing `*.db`
  rule does not cover `.osrm.*`), and README environment documentation.
- **Attribution is now owed and must ship**: `© OpenStreetMap contributors · Routing by OSRM ·
  Optimization by VROOM` in the app footer, discharging the ODbL §4.3 obligation in
  [#150](https://github.com/Tyler-Reagan/trip-kraken/issues/150).
- **The registry is no longer a lookup — it is a composition pipeline.** This is the one place in v2
  that adds machinery rather than moving it, and it is accepted because it relocates an existing
  hardcoded fallback and because the cross-provider integration surface is precisely what we should
  own rather than outsource.
- **A trip needs one provider *preference order*, and something must decide it.** Today that decision
  hides inside "which single provider won." Made explicit, it needs an owner — trip-level
  configuration, a region default, or a constant. Not decided here; it is the first thing to settle
  when the pipeline is built.
- **Google's matrix answers remain schedule-approximate.** ADR-0018's representative-datetime policy
  is unchanged: one matrix per optimize run at one departure time. That approximation is now confined
  to whichever cells Google actually fills.
- **Prototype B gates §1's road quality**, not its architecture. If OSM walking data proves
  systematically biased in hilly terrain, the response is an entry-ordering change — a metered provider
  ahead of OSRM for `walking` in that region — not a redesign.
- **`pathKind.ts` is deleted**; `PathKind` the type stays in `types/path.ts`. A migration drops the
  `allowedPathKinds` column.
- **`googleRoutesProvider` keeps both routing methods**, narrowed in scope rather than removed — a
  direct reversal of the v2 plan's file-by-file table, recorded here so the diff is legible later.
