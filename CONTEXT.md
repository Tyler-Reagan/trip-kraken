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

**Leg**:
The travel segment between consecutive Placements (or between a Day's Anchor and its first
or last Placement) within a Day — the unit travel cost, transit detail, and directions
operate on. Derived from the Plan, never stored.
_Avoid_: hop, segment, edge

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
stations and lines from OpenStreetMap, real distances, no timetables. An implementation
detail of one `TravelCostProvider`, not domain vocabulary; a Trip never references it
directly.

**Stop node** (rail graph):
One line's presence at one station — a busy interchange is several stop nodes. Distinct
from Placement; not a scheduled thing.

**Station cluster** (rail graph):
A grouping of stop nodes that represent one physical interchange, used to find transfers
between lines and operators.

**Ride edge / transfer edge** (rail graph):
Graph-internal connections the rail graph's shortest-path search traverses — a ride edge
between consecutive stops on one line, a transfer edge between stop nodes in one station
cluster. Implementation concepts of the rail graph only; never used for a Leg, which stays
the domain unit of travel between Placements.

**Travel mode**:
How a Trip gets around — one of a Trip-level allowed set (transit, driving, walking,
bicycle), resolved to a single primary mode the optimizer runs on.
