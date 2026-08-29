/**
 * The self-hosted OSRM `PathProvider` (ADR-0024) — `costMatrix()` calls the `table` service,
 * `describeJourney()` calls `route` with `steps=true` for shift decomposition
 * (`osrm-viability-149.md` §"`route` → `PathProvider.describeJourney`"). Two profiles, two
 * containers (`OSRM_FOOT_URL`/`OSRM_CAR_URL`): a profile is compiled into the graph, not a query
 * parameter, so `foot`/`car` are genuinely different servers.
 *
 * **Coordinate order is `{lng},{lat}` throughout** — both in the URL and in every `Waypoint`
 * OSRM returns. `Point` in this codebase is `{lat,lng}`. A swap here is silent and produces
 * plausible-looking wrong distances (`osrm-viability-149.md` names this explicitly); tests assert
 * the emitted URL directly rather than trusting a round trip to catch it.
 *
 * **The decline mechanism is the snap distance, not `radiuses`.** OSRM does not error on a
 * coordinate outside the built Extract — it snaps to the nearest way in whatever graph is loaded
 * and answers confidently (verified live, 2026-08-11: a Hiroshima point against a Kanto-only graph
 * snapped 585 km away to a Nagano rail line and returned `code: "Ok"`). `radiuses` looked like the
 * fix but fails the *entire* request with `NoSegment` when any one point is out of range — a
 * single out-of-Extract Location would take down the whole matrix. Every `table`/`route` response
 * already carries each point's snap `distance` in its `Waypoint` (`sources[]`/`destinations[]` for
 * `table`, `waypoints[]` for `route`), at zero extra requests, and per-endpoint — so a distance
 * threshold declines exactly the cells that need it and nothing else. `ROAD_SNAP_MAX_METERS` is
 * sized from the same session's live check: legitimate in-Extract points snapped under ~35 m.
 *
 * **`fallback_speed` is deliberately not sent.** OSRM's `table` supports it — compute a
 * straight-line distance and a fixed speed for any cell it can't route, the same shape as
 * `haversineProvider`. Sending it would put two disagreeing straight-line speed models inside one
 * matrix (OSRM's `fallback_speed` vs. `haversineProvider`'s 20 km/h). Declining instead and
 * letting the registry's terminal `haversine` entry fill the cell keeps exactly one straight-line
 * model in play, and satisfies ADR-0024 §2's actual argument identically: one unroutable pair
 * degrades one cell rather than failing the whole request.
 */

import {
  makeTravelCost,
  type Path,
  type PathEndpoint,
  type PathGeometry,
  type PathKind,
} from "@/types/path";
import type { Point } from "@/lib/geo";
import type {
  MatrixCell,
  PathProvider,
  PathProviderOptions,
} from "@/lib/pathProvider";

/** Above this snap distance, a coordinate is not plausibly "at" the point that was requested —
 * the out-of-Extract signal (ADR-0024, amended 2026-08-10). Sized from a live check against the
 * running containers: legitimate in-Extract points (urban and semi-rural) snapped under ~35 m; an
 * out-of-Extract point snapped hundreds of kilometres. 1 km leaves comfortable margin on both
 * sides without being so loose it would admit a genuinely wrong snap. */
export const ROAD_SNAP_MAX_METERS = 1000;

export function isSnapAcceptable(meters: number): boolean {
  return meters <= ROAD_SNAP_MAX_METERS;
}

type Profile = "foot" | "car";

/** The profile-selection rule ADR-0024's 2026-08-09 amendment said the composition PR owed:
 * `walking` routes on the `foot` graph, `driving` on `car`. `kinds` arrives already intersected
 * against this provider's declared `kinds: ["walking", "driving"]` (ADR-0024 §4), so exactly one
 * of these is ever present in a real request; the loop exists only so an unexpected shape fails
 * with a clear message instead of silently picking nothing. */
const PROFILE_FOR_KIND: Partial<Record<PathKind, Profile>> = {
  walking: "foot",
  driving: "car",
};

function resolveProfile(kinds: PathKind[]): Profile {
  for (const kind of kinds) {
    const profile = PROFILE_FOR_KIND[kind];
    if (profile) return profile;
  }
  throw new Error(
    `osrmProvider: no walking/driving kind in ${JSON.stringify(kinds)}`,
  );
}

function baseUrlFor(profile: Profile): string {
  const url =
    profile === "foot" ? process.env.OSRM_FOOT_URL : process.env.OSRM_CAR_URL;
  if (!url)
    throw new Error(
      `osrmProvider: OSRM_${profile.toUpperCase()}_URL is not set`,
    );
  return url;
}

// OSRM's own coordinate order — see the module doc's warning.
function coordOf(p: Point): string {
  return `${p.lng},${p.lat}`;
}

interface OsrmWaypoint {
  location: [number, number];
  name?: string;
  distance: number;
  hint?: string;
}

interface OsrmTableResponse {
  code: string;
  message?: string;
  durations?: (number | null)[][];
  distances?: (number | null)[][];
  sources?: OsrmWaypoint[];
  destinations?: OsrmWaypoint[];
}

/** A stopped or wedged container must fail fast, not hang the caller (ADR-0029). At ADR-0026's one
 * lookup per request an unbounded wait was survivable; the map issues a pair per shift across the
 * whole Trip, so one hung socket would hold the batch open indefinitely. Local containers answer in
 * milliseconds — this bound is for the pathological case, not the slow one. */
const OSRM_TIMEOUT_MS = 5000;

async function fetchOsrmJson<T>(url: string, profile: Profile): Promise<T> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(OSRM_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`osrmProvider (${profile}): HTTP ${res.status} ${text}`);
  }
  const data = (await res.json()) as T & { code: string; message?: string };
  if (data.code !== "Ok") {
    throw new Error(
      `osrmProvider (${profile}): ${data.code}${data.message ? ` — ${data.message}` : ""}`,
    );
  }
  return data;
}

async function costMatrix(
  points: Point[],
  kinds: PathKind[],
): Promise<MatrixCell[][]> {
  const n = points.length;
  if (n === 0) return [];
  // The `table` service requires at least two coordinates. A composer subset can only shrink to
  // one point when nothing about it is still unfilled, so this should not be reachable in
  // practice — declining is the safe fallback if it ever is.
  if (n === 1) return [[null]];

  const profile = resolveProfile(kinds);
  const coords = points.map(coordOf).join(";");
  const url = `${baseUrlFor(profile)}/table/v1/${profile}/${coords}?annotations=duration,distance`;

  const data = await fetchOsrmJson<OsrmTableResponse>(url, profile);
  const durations = data.durations ?? [];
  const distances = data.distances ?? [];
  const sourceOk = (data.sources ?? []).map((w) =>
    isSnapAcceptable(w.distance),
  );
  const destOk = (data.destinations ?? []).map((w) =>
    isSnapAcceptable(w.distance),
  );

  const matrix: MatrixCell[][] = Array.from({ length: n }, () =>
    new Array(n).fill(null),
  );
  for (let i = 0; i < n; i++) {
    if (!sourceOk[i]) continue; // out-of-Extract source declines its whole row
    for (let j = 0; j < n; j++) {
      if (!destOk[j]) continue; // out-of-Extract destination declines its whole column
      const duration = durations[i]?.[j];
      const distance = distances[i]?.[j];
      if (duration == null || distance == null) continue; // OSRM's own "no route" decline
      matrix[i][j] = makeTravelCost(
        distance,
        duration,
        "routingService",
        "osrm",
      );
    }
  }
  return matrix;
}

interface OsrmStep {
  distance: number;
  duration: number;
  name?: string;
  mode: string;
  geometry?: PathGeometry;
}

interface OsrmLeg {
  steps: OsrmStep[];
}

interface OsrmRoute {
  distance: number;
  duration: number;
  legs: OsrmLeg[];
}

interface OsrmRouteResponse {
  code: string;
  message?: string;
  routes?: OsrmRoute[];
  waypoints?: OsrmWaypoint[];
}

/** OSRM's `RouteStep.mode` vocabulary, narrowed to the Path kinds it can honestly produce
 * (`osrm-viability-149.md` §2's mapping table). `pushing bike` collapses onto `walking` — the
 * traveler is on foot, and a bicycle journey honestly alternates `bicycle`/`walking` runs, not
 * `bicycle`/`pushing bike` ones. `train` bins to `other`, not `rail`, on the same doc's judgement
 * call: OSRM supplies no service identity for a `shuttle_train` (car-carrying motorail) edge, and
 * the basis is `routingService`, not `railNetwork` — `rail` is a claim only the graph-backed
 * provider can honestly make. Anything outside this vocabulary (the doc's "FIXME only for
 * testbot.lua" modes, not produced by stock profiles) also falls to `other` rather than throwing:
 * an unrecognized mode is still real travel that happened, just not one we can name precisely. */
type RunKind = "walking" | "driving" | "bicycle" | "other";
const RUN_KIND_FOR_OSRM_MODE: Record<string, RunKind> = {
  driving: "driving",
  cycling: "bicycle",
  walking: "walking",
  "pushing bike": "walking",
  ferry: "other",
  train: "other",
};

function runKindForMode(mode: string): RunKind {
  return RUN_KIND_FOR_OSRM_MODE[mode] ?? "other";
}

interface Run {
  kind: RunKind;
  distanceMeters: number;
  durationSeconds: number;
  geometries: PathGeometry[];
  /** First non-empty step name in the run — an OSM way name, used only for `OtherPath.lineName`
   * (e.g. a named ferry route). Frequently absent; `OtherPath.lineName` is optional for exactly
   * this reason (ADR-0022). */
  name?: string;
}

/** Groups consecutive steps sharing a mapped kind into one run each — "the implementation note
 * that matters" (`osrm-viability-149.md`): a Path ends at every shift, and a shift is a mode
 * change, not a maneuver. Grouping on the *mapped* kind rather than the raw OSRM `mode` string is
 * what collapses `walking` + `pushing bike` into a single run instead of splitting on every
 * dismount. */
function groupSteps(steps: OsrmStep[]): Run[] {
  const runs: Run[] = [];
  for (const step of steps) {
    const kind = runKindForMode(step.mode);
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) {
      last.distanceMeters += step.distance;
      last.durationSeconds += step.duration;
      if (step.geometry) last.geometries.push(step.geometry);
      if (!last.name && step.name) last.name = step.name;
    } else {
      runs.push({
        kind,
        distanceMeters: step.distance,
        durationSeconds: step.duration,
        geometries: step.geometry ? [step.geometry] : [],
        name: step.name || undefined,
      });
    }
  }
  return runs;
}

/** OSRM routes a run end to end, so its steps concatenate into one continuous line — one span,
 * not several (ADR-0030 §9). The list is the Path's shape, and a run always has exactly one real
 * span or none; the several-span case belongs to a provider whose coverage is partial. */
function mergeGeometry(geometries: PathGeometry[]): PathGeometry[] | undefined {
  if (geometries.length === 0) return undefined;
  return [
    {
      type: "LineString",
      coordinates: geometries.flatMap((g) => g.coordinates),
    },
  ];
}

/** The coordinate at a run boundary, derived from the routed geometry rather than the original
 * request — an interchange endpoint created by decomposing a Journey is ephemeral
 * (`PathEndpoint`'s doc in `types/path.ts`), not a real Location. Falls back to the adjacent run's
 * far endpoint if geometry is unexpectedly absent, so a boundary is never simply missing. */
function endpointAt(
  coord: GeoJSON.Position | undefined,
): PathEndpoint | undefined {
  return coord ? { lng: coord[0], lat: coord[1] } : undefined;
}

function pathForRun(run: Run, from: PathEndpoint, to: PathEndpoint): Path {
  const travelCost = makeTravelCost(
    run.distanceMeters,
    run.durationSeconds,
    "routingService",
    "osrm",
  );
  const geometry = mergeGeometry(run.geometries);
  switch (run.kind) {
    case "walking":
      return { kind: "walking", from, to, travelCost, geometry };
    case "driving":
      return { kind: "driving", from, to, travelCost, geometry };
    case "bicycle":
      return { kind: "bicycle", from, to, travelCost, geometry };
    case "other":
      return {
        kind: "other",
        from,
        to,
        travelCost,
        geometry,
        lineName: run.name,
      };
  }
}

async function describeJourney(
  from: PathEndpoint,
  to: PathEndpoint,
  kinds: PathKind[],
  _opts?: PathProviderOptions,
): Promise<Path[] | null> {
  const profile = resolveProfile(kinds);
  const coords = `${coordOf(from)};${coordOf(to)}`;
  const url = `${baseUrlFor(profile)}/route/v1/${profile}/${coords}?steps=true&overview=full&geometries=geojson`;

  const data = await fetchOsrmJson<OsrmRouteResponse>(url, profile);
  const waypoints = data.waypoints ?? [];
  if (
    waypoints.length < 2 ||
    !isSnapAcceptable(waypoints[0].distance) ||
    !isSnapAcceptable(waypoints[1].distance)
  ) {
    return null;
  }

  const route = data.routes?.[0];
  if (!route)
    throw new Error(`osrmProvider (${profile}): no route in response`);

  const steps = route.legs.flatMap((leg) => leg.steps);
  const runs = groupSteps(steps);
  if (runs.length === 0) return null;

  return runs.map((run, i) => {
    const runFrom =
      i === 0 ? from : (endpointAt(run.geometries[0]?.coordinates[0]) ?? from);
    const lastGeom = run.geometries[run.geometries.length - 1];
    const runTo =
      i === runs.length - 1
        ? to
        : (endpointAt(lastGeom?.coordinates[lastGeom.coordinates.length - 1]) ??
          to);
    return pathForRun(run, runFrom, runTo);
  });
}

export const osrmProvider: PathProvider = { costMatrix, describeJourney };
