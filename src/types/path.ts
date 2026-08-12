/**
 * Path (ADR-0021, ADR-0022) — the one travel primitive on the edge axis, mirroring Location
 * (ADR-0009/0015) on the node axis: a discriminated union over `kind`, travel cost composed
 * rather than inherited.
 *
 * A Path is one *shift* (ADR-0022, revised 2026-08-06): it ends at every discernible change of
 * kind, Operator, or service — something the traveler does, not a provider-internal boundary. A
 * contiguous ride through stations is one Path; a seated through-run that crosses Operators is
 * still one Path, taking the boarding Operator. Every Path is therefore of exactly one kind by
 * construction — `kind` is optional only for `UnknownPath`, whose Basis of cost is
 * `straightLine` and so has no honest kind to report at all.
 *
 * Getting from one Placement to the next is a **Journey** — a chain of one or more Paths,
 * assembled by a `PathProvider` (`pathProvider.ts`) and never itself stored or scored. Nothing
 * here decomposes a real multi-service journey yet (P1 of the ADR-0022 refactor): every provider
 * currently returns a single-element `Path[]`, honest about the one kind it can claim, with
 * fidelity improving once decomposition itself is implemented.
 */

// `Point` lives in `geo.ts`, which owns coordinates (ADR-0022's module table) — coordinates outlive
// any one Path, and this module was declaring a second, identical copy of it.
import type { Point } from "@/lib/geo";

/** What a Path's travel was. `other` is travel that *was* routed but falls outside the kinds we
 * model (a ferry, a funicular) — distinct from the absence of `kind` on `UnknownPath`, which
 * means no route was computed at all. The same vocabulary a Trip's Allowed kinds are drawn from:
 * chosen per Trip, reported per Path. */
export type PathKind = "rail" | "bus" | "walking" | "driving" | "bicycle" | "other";

/** Every `PathKind`, in one place — the terminal registry entry (ADR-0024 §4) declares this as
 * its competence, since a straight line can stand in for any kind's cost. Not an ordering or
 * precedence; keep in sync with the `PathKind` union above by construction, not by convention. */
export const ALL_PATH_KINDS: readonly PathKind[] = ["rail", "bus", "walking", "driving", "bicycle", "other"];

/** How a Path's cost was arrived at (CONTEXT.md). Carries no reason — only whether real topology
 * was used, not why it wasn't. */
export type BasisOfCost = "railNetwork" | "routingService" | "straightLine";

/** Which registry entry answered a cell (ADR-0024 §4/§5, CONTEXT.md's "Answered by"). Orthogonal
 * to `BasisOfCost`: `osrm` and `google` both produce `routingService`, and `osrm` alone can also
 * produce `straightLine` for a cell it declined. Load-bearing beyond diagnostics — see
 * `PersistableTravelCost` below, the type this exists to make checkable. */
export type ProviderId = "osm-japan" | "osrm" | "google" | "haversine";

/** The entity operating a Path — whoever provides the travel *to* you rather than you providing
 * it yourself. An object rather than a bare string so an OSM id or a canonical ref can attach
 * later without widening the field's shape again. Declared, and shipped unpopulated: nothing
 * ingests `operator=*` yet (waits on #142's graph-schema change, per ADR-0022). */
export interface Operator {
  name: string;
}

export interface TravelCost {
  distanceMeters: number;
  durationSeconds: number;
  basisOfCost: BasisOfCost;
  /** Which registry entry produced this cost (ADR-0024 §4). Required, not inferred from
   * `basisOfCost` — two providers can share a basis. */
  answeredBy: ProviderId;
  /** Always `durationSeconds / 60` — assigned only through `makeTravelCost` below so it can never
   * diverge from the authoritative seconds figure. */
  costAsMinutes: number;
}

/** The single constructor for `TravelCost`, so `costAsMinutes` can never be set independently of
 * `durationSeconds`. `answeredBy` is a required positional parameter, not optional-with-default:
 * six call sites at the time this was added, and a default would silently mislabel every future
 * provider that forgot to pass it. */
export function makeTravelCost(
  distanceMeters: number,
  durationSeconds: number,
  basisOfCost: BasisOfCost,
  answeredBy: ProviderId
): TravelCost {
  return { distanceMeters, durationSeconds, basisOfCost, answeredBy, costAsMinutes: durationSeconds / 60 };
}

/**
 * #158 / Google Maps Platform Terms of Service §3.2.3(a): "Customer will not pre-fetch, index,
 * store, or cache any Content" — and distance-matrix results are named explicitly. The Routes API
 * caching exception (Maps Service Specific Terms §19.3) covers latitude/longitude only; durations
 * and distances derived from Google are not covered. Any function that writes a `TravelCost` to
 * SQLite must require this type, not the bare `TravelCost` — the compiler then enforces the
 * exclusion instead of a comment having to be remembered at every future call site.
 *
 * Holding a Google-derived cost in memory for the span of one optimize run remains permitted
 * (ADR-0018 §1) — this type governs *persistence*, not use. Do not widen it to allow caching
 * later: a matrix cache is legal only for the cells this type already excludes Google from.
 */
export type PersistableTravelCost = TravelCost & { answeredBy: Exclude<ProviderId, "google"> };

export function isPersistable(cost: TravelCost): cost is PersistableTravelCost {
  return cost.answeredBy !== "google";
}

/** A Path's endpoint, as identity plus coordinates — deliberately not a full `Location`.
 * Embedding one would put every field of enrichment on each end of every Path, and would make a
 * Path hold a snapshot that silently diverges the moment the Location is edited. `locationId` is
 * optional: an interchange endpoint created by decomposing a Journey is ephemeral, derived from
 * the Path rather than a real, persisted Location.
 *
 * `lat`/`lng` are the *requested* coordinates — the Location's own, not wherever a router snapped
 * them to. A routed Path's snapped ends are already the first and last vertices of its `geometry`,
 * so nothing needs a second field to carry them (#149 grill, 2026-08-05). */
export interface PathEndpoint extends Point {
  locationId?: string;
}

/** GeoJSON LineString — the one geometry encoding a Path speaks. Originally a union with an
 * encoded-polyline `string`, narrowed per #149: OSRM emits GeoJSON natively, so no provider is
 * forced into an encoded form, and a bare `string` cannot distinguish OSRM's `polyline`
 * (precision 5) from its `polyline6` — indistinguishable, and silently wrong by a factor of ten if
 * confused. Providers that speak polyline decode at their own boundary; `computeRoutePolyline`
 * (`googleRoutesProvider.ts`) keeps its own `string` return for the discovery corridor, which is
 * not a Path geometry. */
export type PathGeometry = GeoJSON.LineString;

export interface PathBase {
  from: PathEndpoint;
  to: PathEndpoint;
  travelCost: TravelCost;
  geometry?: PathGeometry;
}

export type UnknownPath = PathBase & { kind?: undefined };
export type RailPath = PathBase & { kind: "rail"; lineName: string; operator?: Operator };
export type BusPath = PathBase & { kind: "bus"; lineName: string; operator?: Operator };
/** `lineName` is optional here alone: `other` is travel we deliberately don't model, and a ferry
 * or funicular way in OSM routinely carries no name at all. The concept applies but the datum is
 * often unknown — the same distinction that keeps `operator` optional on `rail`/`bus`. On those
 * kinds a missing name is a data defect worth failing on; here it is normal (#149 grill). */
export type OtherPath = PathBase & { kind: "other"; lineName?: string; operator?: Operator };
export type WalkingPath = PathBase & { kind: "walking" };
export type DrivingPath = PathBase & { kind: "driving"; operator?: Operator };
export type BicyclePath = PathBase & { kind: "bicycle"; operator?: Operator };

export type Path = UnknownPath | RailPath | BusPath | OtherPath | WalkingPath | DrivingPath | BicyclePath;

export function kindOf(path: Path): PathKind | undefined {
  return path.kind;
}

export const isRailPath = (p: Path): p is RailPath => p.kind === "rail";
export const isBusPath = (p: Path): p is BusPath => p.kind === "bus";
export const isOtherPath = (p: Path): p is OtherPath => p.kind === "other";
export const isWalkingPath = (p: Path): p is WalkingPath => p.kind === "walking";
export const isDrivingPath = (p: Path): p is DrivingPath => p.kind === "driving";
export const isBicyclePath = (p: Path): p is BicyclePath => p.kind === "bicycle";
export const isUnknownPath = (p: Path): p is UnknownPath => p.kind === undefined;
