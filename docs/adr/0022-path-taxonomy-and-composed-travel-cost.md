# ADR-0022: Path as a kind-narrowed union, with travel cost composed rather than inherited

- **Status:** Accepted
- **Date:** 2026-08-05
- **Supersedes:** —
- **Superseded by:** —
- **Amends:** ADR-0004 (defines `TravelCost`/`TravelCostProvider`), ADR-0018 (introduces the
  display-detail shape this ADR dissolves; the 2026-08-06 revision below additionally **reverses
  ADR-0018 §3 at the Path level** — see that block), ADR-0021 (named Path's `kind` and Basis as
  glossary terms; this ADR gives both a code shape, and corrects ADR-0021's scope on **Rail line**)
- **Constrained by:** ADR-0009 / ADR-0015 (Location as one primitive narrowed by `kind` — the
  precedent this ADR mirrors onto the edge axis)
- **Note:** Decided in the 2026-08-05 session that began as a grilling for
  [Ingest real rail-segment geometry for map rendering (#142)](https://github.com/Tyler-Reagan/trip-kraken/issues/142)
  and pivoted once it became clear #142 had no defined Path interface to extend.

## Context

ADR-0021 renamed Leg to Path and declared it "one travel primitive, narrowed by a `kind`,
carrying kind-specific fields" — mirroring Location. But that was vocabulary only. In code
there was no `kind` field, no union, and no kind-specific anything. What existed was
`PathDetail`: a flat interface extending `TravelCost` with two optional fields
(`transferCount`, `lineNames`) that only transit providers ever populated.

Designing #142's rail geometry exposed the gap. There was nowhere to put a rail-specific
field, because no rail type existed. Every new capability would have arrived the way
`transferCount` and `lineNames` did — as another optional field on a flat interface, typed
against no kind, populated by some providers and not others, with no compiler check
distinguishing "this provider doesn't report it" from "this journey doesn't have one."

A second problem surfaced alongside it. `PathDetail extends TravelCost` made travel cost a
*supertype* of a Path, so a Path **was** a cost with extra fields bolted on. That inheritance
is what forced `PathDetail` to exist at all: `costMatrix` needed bare `TravelCost`,
`describePath` needed cost plus detail, and extension was the only way to relate them.

## Decision

> ### Revised 2026-08-06 — a Path is one *shift*, not the composite journey
>
> Grilling this ADR's own Consequences before implementing it overturned its atomicity rule.
> The decision below is otherwise intact; this block states what changed and why, rather than
> editing the prose to read as though it was always this way.
>
> **What changed.** A Path was defined here (following ADR-0018 §3) as the atomic, composite
> door-to-door journey — walk to the station, ride, walk from — deliberately *not* decomposed.
> It is now the opposite: **a Path ends at every discernible shift**, where a shift is a change
> of kind, operator, or service — something the *traveler does*: get off, walk, board a different
> vehicle. A contiguous ride through stations is one Path. An A→B journey is N Paths, access
> walks included. Every Path is therefore single-kind by construction, which is the invariant the
> union was built to guarantee and could not while a "rail" Path secretly contained walking.
>
> A seated **through-run that crosses operators is still one Path**, taking the *boarding*
> operator: rider-continuity is the test, and splitting it would invent an interchange the
> traveler never experiences. This retires this ADR's justification for putting Operator on the
> Path rather than the line, and corrects CONTEXT.md accordingly. Fares across a through-run are
> a known gap, deferred with the cost work — nothing computes fares today.
>
> **Field consequences.**
> - `transferCount` is **deleted**. Within one shift it is always 0; transfers have migrated to
>   the *gaps between* Paths, where transfer cost can eventually be modeled properly instead of
>   as the flat `TRANSFER_MINUTES` constant buried in a graph edge weight.
> - `lineNames: string[]` becomes `lineName: string`, required on the transit kinds — one Path,
>   one service, one name.
> - `dedupeConsecutive` is **deleted**, not rehomed to `pathProvider.ts` as the table below says.
>   Its only purpose was collapsing repeated names across a multi-service journey.
> - `operator` stays singular and optional, as originally decided — rescued by the decomposition
>   rather than by the field.
> - A third transit member, **`other`**, joins the union (below). No intermediate `TransitPath`:
>   with `transferCount` gone the transit kinds share exactly two fields, so this ADR's original
>   rejection of that layer holds more strongly, not less.
> - `PathEndpoint.locationId` becomes **optional**. Interchange endpoints created by decomposition
>   are ephemeral — derived from the Path, never persisted as Location rows. Persisting them would
>   invert the rule that Paths are derived and never stored, and would make a routing artifact
>   eligible to become the Trip's derived arrival/departure.
> - `describePath` becomes **`describeJourney(from, to, kinds, opts): Promise<Path[]>`**. Only the
>   provider knows where the shifts fell, so it returns the assembled chain; a caller stitching
>   segments would be reconstructing information the provider had and discarded — this ADR's
>   founding complaint. "Journey" is the A→B whole, "Path" the atom; the two now need different
>   words.
>
> ```ts
> type PathKind = "rail" | "bus" | "walking" | "driving" | "bicycle" | "other";
>
> type UnknownPath = PathBase & { kind?: undefined };
> type RailPath    = PathBase & { kind: "rail";    lineName: string; operator?: Operator };
> type BusPath     = PathBase & { kind: "bus";     lineName: string; operator?: Operator };
> type OtherPath   = PathBase & { kind: "other";   lineName: string; operator?: Operator };
> type WalkingPath = PathBase & { kind: "walking" };
> type DrivingPath = PathBase & { kind: "driving"; operator?: Operator };
> type BicyclePath = PathBase & { kind: "bicycle"; operator?: Operator };
> ```
>
> **`other` is routed-but-unbinned, and is not `UnknownPath`.** They answer different questions:
> `other` means the kind is known and outside our bins (a ferry); `UnknownPath` means no route was
> computed and no kind is claimable. Collapsing them would make `kind` and `basisOfCost` redundant
> and would leave a real ferry indistinguishable from a straight-line guess. This resolves the
> fallback this ADR's Consequences required but never documented: Google's 17 vehicle types bin to
> **rail** (COMMUTER_TRAIN, HEAVY_RAIL, HIGH_SPEED_TRAIN, METRO_RAIL, MONORAIL, RAIL, SUBWAY,
> TRAM), **bus** (BUS, INTERCITY_BUS, TROLLEYBUS), and **other** (CABLE_CAR, FERRY, FUNICULAR,
> GONDOLA_LIFT, SHARE_TAXI, OTHER). We bin rather than mirror Google's granularity, and specialize
> a kind out of `other` only when something needs it.
>
> **ADR-0018 §3 survives for the matrix and dies for the Path.** Decomposition is a display-layer
> concern. `costMatrix` remains N² scalar costs keyed by Location id, one `travelMode` per request,
> and the optimizer never sees a Path. Making Paths the optimizer's currency would turn each edge
> from a number into a set of alternative chains — that is #140's deferred multimodal routing plus
> a category-B solver (`docs/agents/optimizer-rebuild.md`), explicitly not smuggled in here.
>
> **`allowedPathKinds` is a willingness set, not a constraint.** It states which kinds a traveler
> is prepared to use; it does not filter results. Since Google's matrix takes exactly one
> `travelMode`, the many-kinds→one-request collapse lives **inside each provider**, not in the
> domain: `appliesTo(points, kinds)` tests set intersection for selection, and each provider spends
> its one request as it sees fit. `travelMode.ts`/`resolvePrimaryMode` dissolve; `MODE_PRECEDENCE`
> survives as a Google-provider implementation detail. `transit` disappearing as a user-facing
> choice costs nothing today — no selector exists (#89 abandoned, PR #96 closed) — and willing-kind
> selection returns as an input to route-cost optimization, not as a standalone checkbox.
>
> **Deferred, deliberately.** Whether `basisOfCost` is honest per matrix cell (the OSM-Japan
> provider already mixes routed and straight-line cells within one matrix), what kind the
> no-station-in-range fallback should claim (`UnknownPath` for now), where transfer time lives once
> it is a gap, and how a day's travel total is summed — all belong to the reopened cost work and
> its own ADR. Operator capture from OSM's `operator=*` tag waits for #142's graph-schema change
> rather than paying for a re-ingest twice; `operator` ships declared and unpopulated.

**Travel cost is composed into a Path, not inherited by it.** `PathBase` carries a
`travelCost` field. `TravelCost` becomes a self-contained value object — the single shape the
travel-cost library's interfaces collapse into — used verbatim as `TravelCost[][]` by
`costMatrix` and nested inside a Path by `describePath`. Neither is a subtype of the other.

**`TravelCostProvider` is renamed `PathProvider`.** The interface was named for what has been
demoted to a single field on the thing it actually produces. It still serves both altitudes —
`costMatrix` genuinely returns `TravelCost[][]` — but its defining output is a Path, and leaving
the name is the same glossary-to-code drift ADR-0021 corrected for Leg and this ADR corrects
again for `PathDetail`. `selectTravelCostProvider` becomes `selectPathProvider`;
`TravelCostOptions` becomes `PathProviderOptions`.

**`src/lib/travelCost.ts` is dissolved, not shrunk.** The module exists as it does because
`TravelCost` was the organizing primitive: types, geometry math, the default provider, and the
optimizer's lookup helper all accreted around it in one file. With Path as the foundation that
premise is gone, so the module is replaced rather than edited down. Nothing is preserved merely
because it currently compiles.

Contents redistribute by **phase**, not by topic — because the two phases have genuinely
different currencies, and conflating them is what produced the original file:

| Module | Owns | Currency |
| --- | --- | --- |
| `src/lib/geo.ts` | `Point`, `haversineMeters`, `haversineKm`, `hasValidCoords` | coordinates |
| `src/types/path.ts` | `PathKind`, `PathEndpoint`, `Operator`, `TravelCost`, `PathGeometry`, `PathBase`, the union, `kindOf` + guards | shape |
| `src/lib/pathProvider.ts` | `PathProvider`, `PathProviderOptions`, `haversineProvider`, `dedupeConsecutive` | both |
| `src/lib/travelMatrix.ts` | `DistanceLookup`, `buildDistanceLookup` | `Point` + `TravelCost` |

`Point` lands in `geo.ts` rather than on a Path: it is the primitive haversine operates on, and
it is already the type of a clustering centroid (`metroCluster.ts`) and a discovery corridor
endpoint — coordinates far outlive any one Path.

The last row is the load-bearing distinction. **The optimizer never touches a Path.** Its inner
loops read `DistanceLookup.km(aId, bId)` — keyed by *Location id*, returning numbers, over a
matrix fetched once. Paths are built lazily at display time, one per final-plan edge. So bulk
cost lookup is not a method on a Path and not a function over an array of Paths; at that point
in a run, no Path exists. Operations over a *collection* of Paths are deliberately not
introduced here: per ADR-0021, "the Day's Paths" stays a phrase until something genuinely
operates on it as a unit, and nothing does yet.

**`PathDetail` dissolves.** Its two fields move onto the transit kinds that actually own them
(below), and the type name disappears entirely — the domain term is "Path", and the code type
is now `Path`, closing the same glossary-to-code naming gap ADR-0021 closed for Leg.

`PathBase` is what is true of *every* Path, whatever its kind:

```ts
interface PathEndpoint extends Point {
  locationId: string;
}

interface PathBase {
  from: PathEndpoint;
  to: PathEndpoint;
  travelCost: TravelCost;
  geometry?: PathGeometry;
}
```

**A Path carries its own endpoints, as identity plus coordinates.** CONTEXT.md defines a Path as
the segment *between* two Placements, but until now the type could not say which two —
`describePath(from, to)` took them as arguments and returned detail that had forgotten them,
leaving the caller to remember what it had asked. A Path that cannot identify its own ends is
not self-describing, and every consumer (a map overlay, an itinerary row) needs them.

`PathEndpoint` is deliberately not a full `Location`. Embedding one would put 17 fields of
enrichment, hours, and ratings on each end of every Path, and — worse — would make a Path hold a
*snapshot* that silently diverges the moment the Location is edited. Identity plus coordinates
is the sufficient minimum: consumers that need more resolve it by id, which they already do
(`deriveDays` builds exactly this map). The shape is not new either — `buildDistanceLookup`
already threads `Point & { id: string }` through the optimizer; this only gives that pairing a
name.

**`TravelCost` absorbs `basisOfCost` and `costAsMinutes`.** Both are facts about the cost, not
about the journey, so they belong in the cost object rather than beside it. `basisOfCost`
replaces the term "Basis" (rejected as too terse to be self-describing at a call site).
`costAsMinutes` is always `durationSeconds / 60`, assigned only through one shared constructor
so it can never diverge from the authoritative seconds figure. Field names are deliberately
self-contained and descriptive; single-word field names are not a goal.

**Path is a discriminated union over `kind`**, mirroring `Location = Activity | Transit |
Lodging`, with one structural difference: Location's `kind` is mandatory, Path's is not — a
Path whose `basisOfCost` is `straightLine` had no route computed and has no honest kind to
claim (ADR-0021). So the union carries an explicit no-kind member rather than a mandatory tag.

```ts
type UnknownPath = PathBase & { kind?: undefined };
type RailPath    = PathBase & { kind: "rail";    operator?: Operator; transferCount: number; lineNames: string[] };
type BusPath     = PathBase & { kind: "bus";     operator?: Operator; transferCount: number; lineNames: string[] };
type WalkingPath = PathBase & { kind: "walking" };
type DrivingPath = PathBase & { kind: "driving"; operator?: Operator };
type BicyclePath = PathBase & { kind: "bicycle"; operator?: Operator };

type Path = UnknownPath | RailPath | BusPath | WalkingPath | DrivingPath | BicyclePath;
```

**`Operator` is a field on every kind that has an operating body** — travel *provided to* you
rather than *by* you. Always conceptually present for `rail` and `bus`; conditionally present
for `driving` and `bicycle`, which may be a taxi, rideshare, or bike-share (operated) or your
own car or bicycle (not); never present for `walking`; and unknowable for `UnknownPath`, whose
kind is itself undetermined. This per-kind variation is precisely what the union exists to
express, and it is the first field to actually exercise it.

It is typed optional even on `rail`/`bus`, where the concept always applies, because *concept
present* and *datum known* are different things: nothing populates Operator today, and making it
required would make a `RailPath` unconstructible — blocking the very rail work this taxonomy is
meant to unblock. The path to populating it is concrete rather than speculative: OSM route
relations commonly carry an `operator=*` tag, which `transitGraphIngest.ts` currently reads past
(it takes only `route`, `service`, `name`, `ref`). Tighten `rail`/`bus` to required once
ingestion captures it and the data proves consistently present.

**`transferCount`/`lineNames` belong to `RailPath` and `BusPath`, not to the base.** Transit
detail is exactly what the transit kinds *are*; as optional base fields it would be vestigial
on four of six members, reproducing in the new shape the same "optional field typed against no
kind" problem this ADR exists to end. A field that only two kinds can ever populate is a
kind-specific field, and kind-specific fields live on their kind.

The cost of this is real and is accepted deliberately: `googleRoutesProvider` requests
`transitLine.name`/`nameShort` but not `transitLine.vehicle.type`, so a Google-sourced transit
journey today has genuine transfer counts and line names with no derivable kind — and under
this shape there is no member for it to be. The taxonomy is not contorted to accommodate a
provider limitation with a known fix; the provider is fixed instead (see Consequences).

**`TravelMode` is dissolved; `PathKind` is the one travel vocabulary.** Travel mode and Path
kind described the same axis at two altitudes — mode chosen per Trip (`walking` · `driving` ·
`transit` · `bicycle`), kind reported per Path (`rail` · `bus` · `walking` · `driving` ·
`bicycle`) — differing only in that `transit` was an unsplit stand-in for `rail`/`bus`. Two
enums for one axis meant a permanent translation layer and a coarseness mismatch at every
provider boundary. `PathKind` replaces both: the same values express what a Trip *permits* and
what a Path *reports*, in the manner of HTTP's `Accept` and `Content-Type` sharing one MIME
vocabulary. Direction of travel through the system does not require separate vocabularies.

Trip's persisted `allowedModes` column becomes `allowedPathKinds`, holding concrete kinds only
— the no-kind case is a routing *outcome*, never something a user can permit. The registry's
`appliesTo(points, mode)` gains precision rather than losing it: the OSM-Japan provider gated on
`mode === "transit"` while its graph excludes buses entirely (ADR-0019), so `rail` is the
condition it always meant.

**`kind` is a plain field, read through functions — never a method.** A discriminated union
narrows on a literal property; TypeScript cannot narrow on a method's return value, so a
`getKind()` method would leave every consumer casting, which is the failure this ADR exists to
end. Methods would also make a Path non-plain-data and so non-serializable across the
server/client boundary it must cross to reach the UI. Ergonomics come from standalone
`kindOf(path)` and `isRailPath`-style guards, matching how Location — the primitive this
mirrors — already works: `rolesOf`, `isActivity`, and `lodgingCoversNight` are all functions
over plain data, and Location carries no methods at all.

**`geometry` is Path-level, not rail-exclusive.** Any Path drawn on a map needs geometry
regardless of who produced it, and a second producer already exists in the codebase —
`computeRoutePolyline` (`googleRoutesProvider.ts`) returns an encoded polyline for any Google
mode. Its type stays deliberately lenient:

```ts
type PathGeometry = GeoJSON.LineString | string;  // string = encoded polyline
```

This commits to the field, not to an encoding. Which arm the OSM provider emits, and how it is
stored, is #142's decision.

**Kind-specific fields do not get CONTEXT.md entries**, exactly as Location's `visitDuration`
and `checkInDate`/`checkOutDate` do not. The glossary names primitives and taxonomies; it does
not enumerate fields.

**Correction to ADR-0021's scope: "Rail line" is removed from CONTEXT.md entirely.** ADR-0021
pulled Operator off the rail line and onto the Path, which stripped the line of half its
content, but never re-examined whether the remainder still warranted a glossary entry. It does
not. What remained was a *name* — a string a Path reports, which is a plain field — plus a
speed class that is a provider constant (`LINE_TYPE_SPEEDS_KMH`), not domain language. The
graph-internal terms (Stop node, Station cluster, Ride edge, Transfer edge) stay, because they
never surface on a Path at all; they are structure the search walks. That is the dividing line:
appears on the Path interface → field, no entry; exists only inside the graph → rail-graph
entry.

## Consequences

- **`googleRoutesProvider` must request `transitLine.vehicle.type`.** Putting transit detail on
  the transit kinds means a provider that reports transit detail must also report which kind —
  the two are no longer separable. This is a field-mask addition plus a mapping from Google's
  vehicle types onto `rail`/`bus`, and it is now required rather than deferred: without it, a
  Google transit journey either lies about its kind or silently drops detail it actually has.
  Google's vehicle taxonomy is wider than two values (tram, ferry, cable car), so the mapping
  needs a documented fallback for what is neither rail nor bus.
- `costMatrix` returns `TravelCost[][]`, which now carries `basisOfCost` on every cell. This is
  an enum tag, so the cost is negligible, but the bulk N² path does change shape.
- Reading a cost off a Path becomes `path.travelCost.distanceMeters` rather than
  `path.distanceMeters`. More verbose at call sites, in exchange for the two concepts being
  independently referenceable.
- Dissolving `src/lib/travelCost.ts` touches every module importing from it — the three
  `PathDetail` call sites plus the optimizer, solver, and registry that import `Point`,
  `TravelMode`, `haversineKm`, or `buildDistanceLookup`. Mechanical, but not small.
- **`transit` disappears as a user-facing choice**, replaced by `rail` and `bus` independently.
  This is a real UX change, not just a rename: a user who meant "trains or buses, either" must
  now be offered both. Whatever surfaces mode selection (issue #89's mode selector) inherits
  this, and a default that selects both preserves today's meaning.
- **A Trip schema change.** `allowedModes` → `allowedPathKinds`, with `transit` expanding to
  `["rail", "bus"]`. Cheap now — the app is pre-launch with no deployed data — and deliberately
  taken now rather than after there is data to migrate.
- `PathKind` cannot express "routed, but the kind is unknown" — that is `UnknownPath`, an
  absence of `kind`, and it is a routing outcome only. It is never a permittable value, so
  `allowedPathKinds` is over concrete kinds alone.
- `describePath` must now receive endpoint identity, not bare coordinates, so it can populate
  `from`/`to`. The provider copies an id it never routes on — a trivial cost, taken so that a
  Path is complete when it is returned rather than assembled in two steps by its caller.
- The `Rail graph` glossary entry's "no route geometry" claim stays true: this ADR adds the
  `geometry` field to Path, but the graph still stores none. #142 changes that.

## Alternatives considered

- **Keep `PathDetail extends TravelCost`, add optional fields as needed.** Rejected: this is
  the status quo that produced the problem. Every capability lands as another
  optional-and-untyped field, and the compiler can never distinguish an absent field from an
  inapplicable one.
- **`transferCount`/`lineNames` as optional fields on `PathBase`, narrowed to required by the
  transit kinds.** This was the shape first drafted, chosen to give Google's kind-ambiguous
  transit result somewhere to sit. Rejected: it buys that one accommodation by making two
  fields vestigial on four of six union members, which is the precise pattern this ADR was
  written to eliminate — and it lets a provider keep reporting transit detail while declining
  to say what kind of transit it was. Fixing the provider is the smaller and more honest cost.
- **A shared `TransitPath` union member owning the transit fields, extended by rail and bus.**
  Rejected as a layer that earns nothing: with only two transit kinds, the intermediate type
  adds indirection without removing duplication that a shared field declaration on each kind
  does not already handle. Revisit if a third transit kind arrives.
- **`geometry` on `RailPath` only.** Rejected once `computeRoutePolyline` was found — a second
  producer for non-rail modes already exists, so rail-exclusivity would have been wrong on the
  day it was written, not merely speculative.
- **Keep `TravelMode` and `PathKind` as separate enums.** Rejected: they are opposite-facing
  (mode is a stored input selecting a provider; kind is a reported output) and that is a real
  distinction — but direction of travel through a system does not require separate
  vocabularies, and maintaining two meant a translation layer plus a permanent coarseness
  mismatch wherever `transit` met `rail`/`bus`.
- **`getKind()` as a method on `PathBase`.** Rejected on mechanics, not style: TypeScript
  narrows a discriminated union on a literal property and cannot narrow on a method return, so
  this would reinstate casting everywhere — the precise defect the union removes. It would also
  make a Path carry functions, and so fail to serialize across the server/client boundary.
- **`geometry: unknown`.** Rejected as leniency overshooting into opacity: two concrete shapes
  are already in play in this codebase (`geojson`'s `LineString` in `MapView.tsx`, Google's
  encoded polyline `string`), and a two-member union keeps narrowing available without picking
  a winner.
