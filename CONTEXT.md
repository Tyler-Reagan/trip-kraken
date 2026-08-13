# Trip Kraken

Turns a flat set of candidate places into an efficient, feasible multi-day itinerary,
supporting an iterative discovery → refinement loop. This glossary is the project's
ubiquitous language — definitions only, no implementation detail.

## Language

**Trip**:
The whole plan: a set of Locations over a **required date range**, and the Plan built from
them. Day-numbers are a derived label over the dates.

**Location**:
The one place primitive (name, coordinates, enrichment, hours), typed by `kind`. A Location
carries the constraint-fields its kind warrants; being a Location is not being scheduled.
_Avoid_: place, point, POI, spot

**kind**:
The place taxonomy — `activity` · `transit` · `lodging` — with leaf types (Restaurant,
Airport, Hotel, …) added only when they carry their own fields. One primitive, narrowed by
kind; never separate objects or tables.

**Activity (kind)**:
A Location you visit; carries a `visitDuration`. The schedulable pool — the only kind the
optimizer *places*.

**Lodging (kind)**:
A Location you sleep at; carries `checkIn` / `checkOut` **dates** (one continuous stay).
Multiple lodgings in a Trip are simply multiple lodging Locations.
_Avoid_: base, hotel, Stay

**Transit (kind)**:
A Location you pass through — airport, station; carries `arriveAt` / `departAt`, whose presence is
what makes the kind, the way a Lodging's dates make its own (ADR-0028). A Trip has at most one
Location carrying each, guaranteed when written — so the arrival simply *is* the Location carrying
`arriveAt`, with no earliest/latest rule to apply and no tie-break to get wrong. One Location may
carry both: a round trip through one airport. Either value may be a date alone (designated, time not
yet known) or a date and a time (designated, and constrains that Day's window).
_Avoid_: terminus, endpoint, base

**Authored / surfaced (Transit)**:
Two provenances for one kind (ADR-0028), on opposite sides of the solve. **Authored** Transit is
written by a traveller and is an optimizer *input*: the Trip's two edges, and nothing else.
**Surfaced** Transit is a station a Journey's rail Path passes through — derived from the Plan,
projected every read, never stored, and therefore an optimizer *output*. Storing a surfaced station
would write the optimizer's output back into its own input, so a re-solve would stop being a
function of what the traveller provided. Surfaced Transit is not built yet.

**Constraint**:
An intrinsic temporal fact stored as a **field on a Location** (lodging dates, transit
times) — true regardless of planning, and an optimizer *input*.

**Plan**:
The optimizer's *output*: the Locations contextualized onto the timeline as Placements,
clustered by Day across the Trip's dates.

**Solver wire vocabulary** (ADR-0023):
The optimizer is VROOM, a fleet-routing service — it speaks vehicles, jobs, and skills, not Trips
and Days. That vocabulary is real (it's the wire format) but foreign, and it is quarantined to
`src/lib/vroom/wire.ts`: no `Vroom*` type and no wire key (`vehicle`, `job`, `skills`, `max_tasks`,
…) appears anywhere else in the codebase. A Day becomes a vehicle, a candidate Activity a job, an
Anchor a vehicle's `start_index`/`end_index` — but only inside that one file, whose docblock is the
authoritative translation table. Everywhere else, including this glossary, keep using our own
terms; if you find yourself reaching for "vehicle" or "job" outside `src/lib/vroom/`, that's the
smear this boundary exists to prevent.

**Placement**:
A *scheduled activity* on a Day — `{ date, locationId, order }` — the activity's committed
appearance in the Plan. (Location = candidate; Placement = commitment.)
_Avoid_: stop, visit, waypoint, item

**Day**:
A date in the Trip; clusters the Placements that fall on it and may carry a label. Derived
from the Trip's date range, not an entity in its own right.

**Path**:
The one travel primitive (ADR-0021), on the edge axis the way Location is the one place
primitive on the node axis: one unbroken stretch of travel — the unit travel cost, transit
detail, and directions operate on. Derived from the Plan, never stored. A Path ends at every
**shift** — a change of kind, Operator, or service, meaning something the traveler *does*: get
off, walk, board a different vehicle. A contiguous ride through stations is one Path; a seated
through-run that crosses Operators is also one Path (ADR-0022, revised). Every Path is
therefore of exactly one kind.
_Avoid_: leg, hop, segment, edge

**Journey**:
The whole of getting from one Placement to the next (or between a Day's Anchor and its first or
last Placement) — a chain of one or more Paths, access walks included. What a routing provider
answers with. Not stored and not scored: the optimizer works from scalar Location-to-Location
costs and never sees a Journey or a Path.
_Avoid_: route, trip, leg

**kind (Path)**:
What a Path's travel was — `rail` · `bus` · `walking` · `driving` · `bicycle` · `other`.
`other` is travel that *was* routed but falls outside the kinds we model (a ferry, a funicular):
we bin rather than mirror a provider's granularity, and specialize a kind out of `other` only
when something needs it. Optional, and separately: a Path whose Basis of cost is `straightLine`
had no route computed, so it has no honest kind to report at all — distinct from `other`, which
knows what it was.
`kind` states facts, never preferences. It says what a Path **reports**, and — outside the
domain, in the routing layer — what a provider is **able to answer for**. A Trip once carried an
*allowed kinds* set expressing what a traveler was willing to use; nothing ever wrote it, and it
is deleted (ADR-0024). The term returns only if a traveler-facing selector does — see
**Road profile**, the selector that returned it.
_Avoid_: travel mode, mode, transit, allowed kinds

**Road profile**:
Which OSRM profile — `walking` or `driving` — answers a Trip's road cells (ADR-0024, amended
2026-08-11). A field on Trip, decided prior to optimization and changeable after. Deliberately
narrower than the deleted *allowed kinds*: it never gates `osm-japan` or `google`, and it is not
a willingness set — it selects a single profile for one registry entry, nothing else. The
traveler-facing selector `kind (Path)` names as the only condition under which that concept
returns.
_Avoid_: allowed kinds, travel mode, willingness

**Operator**:
The entity operating a Path — whoever provides the travel *to* you rather than you providing
it yourself. Always applies to rail and bus; conditionally to driving and bicycle (a taxi or
bike-share has one, your own car does not); never to walking. A through-service can change
Operator mid-ride without the rider ever getting off — that stays one Path and reports the
**boarding** Operator (ADR-0022, revised).
_Avoid_: network, company, agency

**Basis of cost**:
How a Path's cost was arrived at — `railNetwork` (traversal of the rail graph) ·
`routingService` (a routing provider's own answer) · `straightLine` (no route computed).
Carries no reason: the fact that matters is whether real topology was used, not why it
wasn't. A taxonomy, so it earns a term; the cost figures it accompanies are plain fields
and do not (ADR-0022).
_Avoid_: basis, fallback, degraded

**Answered by**:
Which registry entry produced a travel cost — `osm-japan` · `osrm` · `google` · `haversine`
(ADR-0024 §4/§5). Orthogonal to Basis of cost: `osrm` and `google` both produce
`routingService`, so Basis of cost alone cannot say which one answered a given cell.
Load-bearing beyond diagnostics — a cost Answered by `google` must never be persisted
(Google ToS §3.2.3(a), issue #158); that rule is checkable because the field is already
there, not something a future cache has to remember on its own.
_Avoid_: source, origin, provenance

**Anchor (derived)**:
A Location that bookends a Day, *projected* from a constraint-field — the lodging you sleep
at, the transit you arrive or depart by. Computed every read, never stored. An Anchor is never a
Placement: like a Lodging, an edge Transit Location shapes the Day rather than sitting on it, and
both are held out of the candidate pool for that reason (ADR-0028).
_Avoid_: terminus, base

**Role (derived)**:
An adjective for how a Location is used — `lodging` · `arrival` · `departure` · `candidate`.
Reflected from a Location's `kind` and constraint-fields; **never stored**. A place is never
*a lodging*; it is a Location of `kind: lodging`. ADR-0028 keeps this rule rather than bending it:
the Trip's edges are made unique when written, not recorded as a role flag or a pointer on Trip —
a shape ADR-0015 removed and this glossary should not let back in.

**Excluded (Location)**:
A Location kept in the Trip but ignored by the optimizer — present, but not placed.

**Unplaced**:
An Activity the optimizer *tried* to place and could not, carrying a reason — either decided
before the solve (no coordinates yet, no lodging covers its area, closed on every Trip date) or
returned by the solver itself with no reason given. Distinct from **Excluded**, which the user
chose; an Unplaced Activity wanted a Placement and didn't get one. A narrower case of
**Unassigned**, which doesn't care why.
_Avoid_: excluded, dropped, filtered

**Unassigned (candidate)**:
An activity Location with no Placement yet — in the cast, awaiting the Plan.
_Avoid_: unscheduled, floating

**Enrichment**:
Filling in a Location's real-world data (canonical identity, coordinates, address, rating,
categories, phone, opening hours) from the authoritative place source. A background step;
a Location's enrichment is done, pending, or failed.
_Avoid_: hydration, lookup

**Discovery**:
Finding new candidate Locations via discovery providers. One free-text search whose
*scope* varies: *anchored* (near an existing Location, e.g. food nearby), *unanchored*
(no anchor — seeds an empty trip), or *along-route* (a corridor between two stops).
Providers return candidates; ranking is the caller's concern, not the provider's.
Distinct from Enrichment: Discovery surfaces *new* candidates; Enrichment completes
*existing* ones.
_Avoid_: nearby search, suggestions

**Rail graph**:
The offline-ingested structure a regional transit provider (e.g. Japan) routes over —
stations and the named services running between them, from OpenStreetMap, with real
inter-station distances, no timetables, and no stored geometry (ADR-0019 §"Duration model";
geometry capture is a separate, open question). An implementation detail of one
`PathProvider`, not domain vocabulary; a Trip never references it directly.
_Not_ the only graph — see Road graph. Never say "the graph" unqualified.

**Stop node** (rail graph):
One named service's presence at one station — a busy interchange is several stop nodes.
Distinct from Placement; not a scheduled thing.

**Station cluster** (rail graph):
What a person means by "a station": a grouping of stop nodes that represent one physical
interchange, used to find transfers between services and Operators.

**Ride edge / transfer edge** (rail graph):
Graph-internal connections the rail graph's shortest-path search traverses — a ride edge
between consecutive stops on one service, a transfer edge between stop nodes in one station
cluster. Implementation concepts of the rail graph only; never used for a Path, which stays
the domain's travel primitive.

**Road graph**:
The offline-built structure a road routing provider traverses — one per travel profile
(walking, driving), so "the road graph" is always two artifacts, not one. Like
the Rail graph, an implementation detail of one `PathProvider` that a Trip never references.
A journey whose endpoints fall outside the road graph's Extract is not an error: the
provider declines those cells and they are answered `straightLine` instead.
_Avoid_: the graph, the map, the routing data

**OSM snapshot**:
The dated OpenStreetMap publication (e.g. `260101`) that every graph is ultimately built
from. It is the invariant Rail graph and Road graph must share — they are cut from
*different Extracts of the same snapshot*, and a shared URL cannot express that because the
two pipelines download different files. What must never drift is the date.
_Avoid_: the OSM data, the download, the dump

**Extract**:
The regional slice of an OSM snapshot actually downloaded — the whole of Japan for rail,
one sub-region or several merged together for road. Which regions and which snapshot are
independent choices, and conflating them is what "the pinned URL" used to do. The regions a
road Extract covers are the boundary of where road costs can be routed at all: outside it
the provider declines and the cost is `straightLine`, so widening coverage means widening
the Extract, never adding a weaker provider beneath the one that declined (ADR-0024). Rail
and road coverage are independent — a Location outside the road Extract but near a station
still routes by rail, so a Trip may be rail-covered and road-uncovered at once; only a
Location neither provider can answer for is a coverage gap worth surfacing.
_Avoid_: region file, the pbf
