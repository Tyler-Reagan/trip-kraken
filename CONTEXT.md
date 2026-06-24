# Trip Kraken

Turns a flat set of candidate places into an efficient, feasible multi-day itinerary,
supporting an iterative discovery → refinement loop. This glossary is the project's
ubiquitous language — definitions only, no implementation detail.

## Language

**Trip**:
The whole plan: a set of candidate Locations and the itinerary built from them, over an
ordered run of Days.

**Location**:
A *candidate* place a traveler might visit (name, coordinates, enrichment, hours). Being
a Location means being in the candidate pool — not being scheduled.
_Avoid_: place, point, POI, spot

**Lodging**:
The *place* a traveler sleeps — a Location used as accommodation. A Lodging serves as the
Anchor for its Stay's Days; it is never a scheduled Stop and never a nearby-search candidate.
_Avoid_: base, hotel

**Stay**:
A Lodging occupied for one contiguous range of nights. A Trip has an ordered list of
Stays; revisiting the same hotel later is a second Stay sharing one Lodging.
_Avoid_: base, leg

**Day**:
One day of the itinerary. Belongs to one Stay and holds an ordered run of Stops.

**Anchor**:
The fixed point a Day's route starts and ends at. Usually the Lodging of the Day's Stay (a
normal day round-trips); a travel day runs from the previous Stay's Lodging to the current
one; arrival/departure days use an entry/exit point (airport, station). A Day has a start
Anchor and an end Anchor.
_Avoid_: terminus, endpoint, base

**Stop**:
A *scheduled instance* of a Location on a Day — the Location's committed appearance in the
plan, with an order and a locked flag. (Location = candidate; Stop = commitment.)
_Avoid_: visit, waypoint, item

**Locked (Stop)**:
A Stop the traveler has pinned to its Day and to its order relative to other locked Stops.
The optimizer arranges unlocked Stops around it and never moves it off its Day or past
another locked Stop; honored even when suboptimal.

**Excluded (Location)**:
A Location kept in the Trip but ignored by the optimizer — present but not a candidate for
scheduling.

**Unassigned (Stop)**:
A Stop that belongs to the Trip but is not placed on any Day — awaiting placement (e.g. an
orphaned locked Stop whose Day was removed). A Stop in this state has no day-pin; any lock
is inert until it is re-placed.
_Avoid_: unscheduled, floating

**Enrichment**:
Filling in a Location's real-world data (canonical identity, coordinates, address, rating,
categories, phone, opening hours) from the authoritative place source. A background step;
a Location's enrichment is done, pending, or failed.
_Avoid_: hydration, lookup

**Discovery**:
Finding new candidate Locations via discovery providers — either *anchored* (near an
existing Location, e.g. food nearby) or *unanchored* (a text/keyword Places search to seed
an empty trip). Distinct from Enrichment: Discovery surfaces *new* candidates; Enrichment
completes *existing* ones.
_Avoid_: nearby search, suggestions
