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
A Location you pass through — airport, station; carries scheduled times. The Trip's
arrival/departure are *derived* from the earliest/latest transit.
_Avoid_: terminus, endpoint, base

**Constraint**:
An intrinsic temporal fact stored as a **field on a Location** (lodging dates, transit
times) — true regardless of planning, and an optimizer *input*.

**Plan**:
The optimizer's *output*: the Locations contextualized onto the timeline as Placements,
clustered by Day across the Trip's dates.

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
is deleted (ADR-0024). The term returns only if a traveler-facing selector does.
_Avoid_: travel mode, mode, transit, allowed kinds

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

**Anchor (derived)**:
A Location that bookends a Day, *projected* from a constraint-field — the lodging you sleep
at, the transit you enter or exit by. Computed every read, never stored.
_Avoid_: terminus, base

**Role (derived)**:
An adjective for how a Location is used — `lodging` · `arrival` · `departure` · `candidate`.
Reflected from a Location's `kind` and constraint-fields; **never stored**. A place is never
*a lodging*; it is a Location of `kind: lodging`.

**Excluded (Location)**:
A Location kept in the Trip but ignored by the optimizer — present, but not placed.

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
