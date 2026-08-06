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

/** What a Path's travel was. `other` is travel that *was* routed but falls outside the kinds we
 * model (a ferry, a funicular) — distinct from the absence of `kind` on `UnknownPath`, which
 * means no route was computed at all. The same vocabulary a Trip's Allowed kinds are drawn from:
 * chosen per Trip, reported per Path. */
export type PathKind = "rail" | "bus" | "walking" | "driving" | "bicycle" | "other";

/** How a Path's cost was arrived at (CONTEXT.md). Carries no reason — only whether real topology
 * was used, not why it wasn't. */
export type BasisOfCost = "railNetwork" | "routingService" | "straightLine";

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
  /** Always `durationSeconds / 60` — assigned only through `makeTravelCost` below so it can never
   * diverge from the authoritative seconds figure. */
  costAsMinutes: number;
}

/** The single constructor for `TravelCost`, so `costAsMinutes` can never be set independently of
 * `durationSeconds`. */
export function makeTravelCost(distanceMeters: number, durationSeconds: number, basisOfCost: BasisOfCost): TravelCost {
  return { distanceMeters, durationSeconds, basisOfCost, costAsMinutes: durationSeconds / 60 };
}

export interface Point {
  lat: number;
  lng: number;
}

/** A Path's endpoint, as identity plus coordinates — deliberately not a full `Location`.
 * Embedding one would put every field of enrichment on each end of every Path, and would make a
 * Path hold a snapshot that silently diverges the moment the Location is edited. `locationId` is
 * optional: an interchange endpoint created by decomposing a Journey is ephemeral, derived from
 * the Path rather than a real, persisted Location. */
export interface PathEndpoint extends Point {
  locationId?: string;
}

/** GeoJSON LineString, or an encoded polyline (Google's format) — commits to the field, not to
 * one encoding. Which arm a given provider emits is that provider's decision (#142). */
export type PathGeometry = GeoJSON.LineString | string;

export interface PathBase {
  from: PathEndpoint;
  to: PathEndpoint;
  travelCost: TravelCost;
  geometry?: PathGeometry;
}

export type UnknownPath = PathBase & { kind?: undefined };
export type RailPath = PathBase & { kind: "rail"; lineName: string; operator?: Operator };
export type BusPath = PathBase & { kind: "bus"; lineName: string; operator?: Operator };
export type OtherPath = PathBase & { kind: "other"; lineName: string; operator?: Operator };
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
