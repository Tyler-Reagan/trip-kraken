# ADR-0019: Japan transit provider — OSM topology graph, no timetables (Phase 1)

- **Status:** Accepted
- **Date:** 2026-07-11
- **Supersedes:** —
- **Superseded by:** —
- **Amends:** ADR-0018 (its §5 "regional providers are contingent enhancements" clause
  fires here; its provider-selection precedent generalizes into a registry)
- **Constrained by:** ADR-0016 (feasibility is a hard gate — this ADR's estimated
  timing feeds it), ADR-0017 (surface degradation, don't hide it), ADR-0009 (Location
  as the one place primitive; this ADR builds its own station data, sharing nothing
  with `stations.ts`)
- **Note:** Resolves the research and grill recorded in
  `docs/japantravel-agent-transcript.md` and the 2026-07-09/2026-07-11 grilling
  session. Live testing (PR #80) proved Google Routes/Directions has no Japan transit
  data (`ROUTE_NOT_FOUND` for Tokyo Sta→Shinjuku, no Shinkansen routing) — the gap
  assessment ADR-0018 conditioned a regional provider on has fired.

## Context

ADR-0018 built the transit cost architecture (representative-time matrix, lazy
`describeLeg`, fail-loudly) against a single provider, Google Routes, with regional
providers explicitly deferred behind a gap assessment. That assessment has now fired:
Google has no Japan transit data at all, so a Japan Trip either falls back to
haversine (which ranks stations three transfers apart as "closer" than a one-ride hop,
producing geographically incoherent Days) or fails outright — in the single region the
app is most being built for.

Every licensed alternative evaluated is dead on primary-source evidence (see
`docs/japantravel-agent-transcript.md` and issue #81 for the full trail): NAVITIME's
RapidAPI ToS bans all caching of returned data (第5条-5), which alone rules it out as
a `costMatrix` source (N² pairs/run, no caching, ~500 req/month quota); self-hosted
OTP/Motis on ODPT open GTFS covers only Tokyo-centric feeds (no JR Central, no
Shinkansen); global aggregators license Japan rail timetables from the same
publishers and have zero Japan coverage of their own.

OpenStreetMap's Japan rail mapping is unusually thorough: `route=train`/`route=subway`
relations carry ordered stop sequences and real segment geometry per line. OSM is
ODbL — explicit permission to store, cache, and precompute, with attribution. This
removes every caching/quota/ToS constraint that killed the licensed options, and
because the topology is real (not a distance estimate), it can report genuine line
names and transfer counts — something a speed-banded heuristic structurally cannot,
since it carries no graph.

## Decision

### Data source and scope

A pinned, dated **Geofabrik Japan `.osm.pbf` extract**, filtered to rail only by
`osmium` (a dev-time ingestion tool, never shipped, never run at request time).
Coverage is **all-Japan passenger rail** — heavy/commuter rail, subway, light rail,
monorail — buses excluded. No metro-area scoping: nationwide coverage removes
curation logic and is what makes the Shinkansen trunk between cities routable at all.

### Two-tier station model

- **Stop nodes**: one per line passing through a station, so a busy interchange is
  several stop nodes, not one.
- **Station clusters**: groupings of stop nodes that represent one physical
  interchange, sourced from OSM's own interchange groupings
  (`public_transport=stop_area` for one operator's platforms,
  `stop_area_group` across operators). Where those relations are missing or
  incomplete, a **fallback** clusters stop nodes that are within a small distance of
  each other *and* share a normalized name.

Two edge kinds, both graph-internal — never domain vocabulary (see CONTEXT.md
addition below): **ride edges** connect consecutive stop nodes on one line, carrying
real inter-station distance; **transfer edges** connect stop nodes within one cluster,
carrying a flat transfer cost. A shortest-path (Dijkstra-style) search with a
per-transfer cost prefers fewer transfers; a route's transfer count is the number of
transfer edges actually traversed — real, not estimated. `describeLeg` reads the
traversed ride edges back out for the ordered list of line names.

### Duration model — coarse by design

Riding time is real distance ÷ an **effective speed chosen per line type** (subway /
commuter / limited-express / Shinkansen), a single number per type absorbing
acceleration, braking, and dwell — per-stop dwell is not modeled separately, to avoid
double-counting. Transfer time is **one flat per-transfer minutes constant** covering
both the platform walk and the wait; in Phase 1 the wait is unknowable and swamps the
walk, so splitting them would be false precision. All constants live in one small
tunable table, treated as placeholders pending calibration against a manual eval, not
as a design commitment.

**Altitude rationale:** these numbers feed clustering (which Day?), sequencing (what
order?), and feasibility (does the Day roughly fit?) — all coarse questions. The graph
is tuned for **ordinal correctness, honest transfer topology, and hour-granularity
feasibility**, deliberately coarse on absolute minutes. Transfer count earns its keep
as the thing that makes the coarse ranking come out in the right order, not as minutes
on a clock.

### Station-snapping and the walking fallback

Each routable Location snaps to nearby stations within a small walking radius,
connected into the graph by a walk cost (distance ÷ walk speed). When no station is
within that radius, the Location's Legs fall back to haversine-as-walking, and the
result is **visibly an estimate** — it never masquerades as a routed transit Leg. This
mirrors ADR-0017: degrade visibly, don't hide it.

### Persistence

The graph lives in a **separate, read-only local SQLite file** (`db/transit-japan.db`)
outside the app's Drizzle schema and migrations — regenerable reference data with a
lifecycle independent of user data, opened with raw read-only `better-sqlite3`, not
through the Drizzle surface. Pathfinding forces the whole graph into memory once (a
module/global singleton plus a spatial index for snapping, mirroring the existing
DB-client global); SQLite is the serialization and inspection format, not a query
engine on the hot path. A missing graph file is a **loud error**, never a silent
fallthrough to Google or haversine.

### Provider selection registry and mode

A small **ordered registry** of `TravelCostProvider`s, each carrying an
`appliesTo(points, mode)` predicate, checked against a **single representative
point** — an itinerary is single-region by domain invariant (a Trip spanning Japan
and Paris is modeled as two Trips), so no all-points scan is needed. Precedence:
OSM-Japan (Japan + transit) → Google (global default, when an API key is present) →
haversine (the floor, always applies). Selection happens **once per optimize run**, in
the optimize orchestrator, and the chosen provider is passed into `solve()`, which
keeps its existing optional `provider` parameter and stays provider-agnostic.

Selection is **by applicability, not try-and-fallback**: a selected provider's errors
propagate (ADR-0018 §4, unchanged). Haversine is only chosen when it is the
highest-precedence *applicable* provider at selection time — never a runtime catch.

A Trip gains a **set of allowed travel modes**, resolved to a **single primary mode**
the optimizer runs on (transit if selected, else driving, else walking, else
bicycle) — transit already blends walking internally (ADR-0018 §3), so most
combinations collapse to one mode. The default set includes transit, so the default
primary mode is transit. This replaces the hardcoded `DEFAULT_MODE` constant at the
optimize call site.

### Accepted v1 limitation

Topology is real; timing is estimated. Feasibility (ADR-0016) is therefore judged
against the estimate, not a real timetable: a Day with generous timing is unaffected,
but a Day resting on a tight last-train connection could be told feasible when the
real schedule disagrees. This is accepted, not hidden — a user-facing caveat near the
itinerary states that transit timing is estimated and does not yet account for exact
schedules or last trains. Real timetables are **Phase 2**, deliberately not designed
here: it layers additively onto the same graph (the same seam ADR-0018 already
flagged for an exact schedule-aware re-simulation in `solve()`'s violation pass), not
a redesign.

## Alternatives considered

- **NAVITIME as the `costMatrix`/`describeLeg` source.** Rejected: RapidAPI ToS
  prohibits caching any returned data outright, which alone kills bulk `costMatrix`
  use (N² pairs/run against a ~500 req/month quota with no caching allowed). Reduced
  to, at most, an optional manual cross-check tool (J5), never load-bearing code.
- **Self-hosted OTP/Motis on ODPT open GTFS.** Rejected on coverage: Tokyo-centric
  feeds only, missing JR Central/West, no Shinkansen — cannot route the trips this
  provider exists to serve.
- **Global transit aggregators.** Rejected: Japan rail timetables are licensed from
  publishers these aggregators don't hold rights to; zero Japan coverage.
- **Per-stop dwell time modeled separately from ride time.** Rejected: double-counts
  against the effective-speed-per-line-type number, adding apparent precision the
  data doesn't support.
- **Modeling platform-walk and wait as separate transfer sub-costs.** Rejected: the
  wait is unknowable without timetables and dominates the walk; splitting them is
  false precision. One flat transfer constant is the honest granularity for Phase 1.
- **Metro-area-scoped coverage (mirroring `stations.ts`'s six areas).** Rejected:
  nationwide rail is a small graph regardless, and metro scoping would make the
  Shinkansen trunk between cities unroutable — the exact failure mode this ADR exists
  to fix.
- **Transfer count as an objective term.** Rejected, reaffirming ADR-0018 §2: it
  re-litigates ADR-0016 by smuggling an unverifiable preference into the objective.
  Transfer count stays display-only, surfaced via `describeLeg`.
- **Try-and-fallback provider selection (attempt Google, catch, fall back to
  haversine).** Rejected: reintroduces the silent-degradation failure mode ADR-0017
  and ADR-0018 §4 both rule out. Selection is applicability-based and upfront;
  failures of a selected provider propagate.
- **DuckDB/Parquet for the graph store.** Rejected: wrong tool for small-graph
  pointer-chasing traversal; filed as a low-priority follow-up candidate for the
  ingest pipeline's geospatial filtering step instead.

## Consequences

- `TravelCostProvider` gains a concrete OSM-Japan implementation alongside Google
  Routes and haversine, implementing `costMatrix` and `describeLeg` against the graph
  with no runtime network call.
- A new offline, re-runnable **ingestion pipeline** (Geofabrik extract → `osmium`
  filter → Node transform) produces `db/transit-japan.db`; regenerating it is a
  routine operation independent of the app's user database and migrations.
- **Provider selection centralizes** into one ordered registry in the optimize
  orchestrator; adding a future regional provider is a registry entry, not scattered
  conditionals.
- The hardcoded `DEFAULT_MODE` constant is replaced by a Trip-level allowed-mode set
  resolved to a single primary mode.
- A **user-facing caveat** near the itinerary is now required wherever transit timing
  is estimated (OSM-Japan-sourced Legs), stating the schedule-exactness limitation.
- **Bills that come due later:** Phase 2 (real timetables, last-train awareness,
  headway-aware waits) layers onto the same graph as a future ADR; the manual
  eval spot-checking OSM-graph output against consumer routing (J5) informs constant
  calibration but is not itself automated; NAVITIME's status stays fully optional,
  gated by the same ToS facts recorded here if it is ever invoked at all.
- New graph-internal vocabulary (stop node, station cluster, ride edge, transfer
  edge) is added to `CONTEXT.md`, kept explicitly distinct from the domain terms
  **Leg** and **Placement** it must not be confused with.

## Manual eval (J5, issue #88)

A real graph was ingested (2026-07-11 Geofabrik `japan-260101.osm.pbf` snapshot, filtered to
rail-only): 21,690 stop nodes, 5,931 station clusters, 20,281 ride edges, 69,428 transfer edges.
Twelve real Legs were spot-checked via `describeLeg` against known real-world routing: seven
ordinary Tokyo-area JR/subway hops, and five that exposed a real miscalibration (two intra-city
hops that resolved to an infrequent limited-express service instead of the obvious local line, plus
three inter-city Shinkansen trunk journeys):

| Leg | Estimate | Real-world sanity |
| --- | --- | --- |
| Tokyo → Shinjuku | 13 min, JR中央線快速, 0 transfers | Matches (~14 min direct) |
| Tokyo → Ueno | 7 min, 上野東京ライン, 0 transfers | Matches (~5–8 min direct) |
| Shinjuku → Shibuya | 6 min, JR山手線, 0 transfers | Matches (~7 min direct) |
| Shibuya → Ebisu | 2 min, JR山手線, 0 transfers | Matches (~2–3 min) |
| Akihabara → Ochanomizu | 1 min, 中央・総武緩行線, 0 transfers | Matches (one stop) |
| Shinagawa → Tokyo | 9 min, JR東海道本線, 0 transfers | Matches (~8–10 min) |
| Tokyo → Ikebukuro | 17 min, JR山手線, 0 transfers | A bit fast vs. real ~24–27 min, same order |

Ordinary same-line/short commuter hops are directionally honest: line names are real, transfer
counts are real, durations land in the right ballpark. The graph/pathfinding/line-name machinery
itself works as designed.

**Miscalibration found — line-type classification never fires for limited-express/Shinkansen.**
Five Legs exposed it, two of them intra-city (a surprising line choice, not just a slow number) and
three inter-city (a duration badly off):

| Leg | Estimate | Real-world | 
| --- | --- | --- |
| Tokyo → Shibuya | 17 min, JR成田エクスプレス (Narita Express), 0 transfers | Real commuters ride the Yamanote Line (~25 min); Narita Express is an infrequent, reserved-seat airport train no one takes for this hop |
| Tokyo → Yokohama | 37 min, 踊り子 (Odoriko), 0 transfers | Real commuters ride the Tokaido/Keihin-Tōhoku Line (~25–28 min); Odoriko is an infrequent resort limited express |
| Tokyo → Shin-Osaka | 545 min (9h), のぞみ, 1 transfer | ~150 min (Nozomi Shinkansen) |
| Tokyo → Kyoto | 503 min, 常磐快速線 → JR東海道本線 | ~140 min (Shinkansen) — didn't even route via Shinkansen |
| Nagoya → Tokyo | 359 min, のぞみ | ~100 min (Nozomi Shinkansen) |

The two intra-city Legs show the same root cause from a different angle: because Narita
Express/Odoriko carry no real frequency or fare-surcharge penalty in this model, and their route
relations connect the two stations with fewer, more direct real-distance hops than the Yamanote
loop, the search picks them purely for being marginally shorter in km — a plausible duration, but a
misleading recommended line name a real rider would never take for that hop.

Root cause, confirmed directly against the ingested data and the real OSM source: `lineTypeOf()`
(`transitGraphIngest.ts`) classifies a `route=train` relation as `"shinkansen"` only when
`service=high_speed`, and `"limitedExpress"` only when `service=long_distance` — but real OSM
route relations for Japanese Shinkansen/limited-express services (checked directly:
`openstreetmap.org/relation/9807033`/`9807034`, the real Nozomi Tokyo↔Hakata relations) carry no
`service` tag at all. Querying the ingested graph confirms this is total, not a fluke: **zero**
of 1,419 distinct lines nationwide were classified `shinkansen` or `limitedExpress` — every
non-subway/light-rail/monorail line (1,278 of them, including every Shinkansen and limited-express
service) silently fell through to the `"commuter"` (45 km/h) default. A same-effective-speed graph
then has no reason to prefer the real Shinkansen trunk over a longer sequence of conventional
lines, and duration for a trunk journey comes out 3–4× too slow.

This is exactly the kind of finding this eval exists to catch, and per this ADR's own scoping it's
**captured as follow-up, not fixed in this ticket** (#88 is the caveat + eval; retuning the
classifier is ingestion work, #87's domain). Concrete leads for that follow-up:
- `service=high_speed`/`long_distance` should stay as a check (some OSM contributors do tag it),
  but needs a fallback: e.g. a known-network/line-name allowlist (のぞみ/ひかり/こだま/はやぶさ/
  こまち/つばさ/かがやき/はくたか/つるぎ/みずほ/さくら and other named Shinkansen/limited-express
  services), or — more robust and self-calibrating — the real Nozomi/Hikari/Kodama relations
  observed during this eval carry a `duration` tag (e.g. `04:57` for Tokyo↔Hakata); computing a
  relation's implied average speed from `duration` ÷ its real distance and thresholding on that
  (e.g. >150 km/h → shinkansen, >80 km/h → limitedExpress) would classify correctly without
  depending on inconsistently-applied tags.
- Ordinary commuter/subway classification (route-tag-based, no `service` dependency) is unaffected
  and already correct — this bug is scoped entirely to the two high-speed-adjacent line types.
