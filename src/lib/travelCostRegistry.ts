/**
 * The provider registry (ADR-0024) — capability-dispatched, not selected. Each entry declares a
 * static `kinds` array (its competence, ADR-0024 §3) and an `isAvailable(points)` gate (region and
 * configuration only, never `kinds` — that distinction is the point of the ADR). `buildTravelMatrix`
 * composes a full matrix cell-by-cell in this preference order via `composeTravelMatrix`
 * (`travelMatrix.ts`) and is called directly by the VROOM request builder
 * (`src/lib/vroom/request.ts`, ADR-0023) — the old `composedPathProvider` adapter, which wrapped
 * this as a `PathProvider` for the pre-VROOM optimizer's `buildDistanceLookup` seam, is gone.
 *
 * Four rows, in this order (ADR-0024 §4, amended 2026-08-10 — hosted OpenRouteService was
 * designed in as a fifth row, between `osrm` and `haversine`, and dropped; there is nothing
 * between them now, and road coverage grows by widening the Extract, not by adding a weaker
 * provider underneath):
 *
 * | # | id         | kinds             | gate                                               |
 * |---|------------|-------------------|-----------------------------------------------------|
 * | 1 | osm-japan  | rail              | in Japan; graph file present                       |
 * | 2 | osrm       | walking, driving  | OSRM URLs configured (per-cell decline is internal) |
 * | 3 | google     | bus               | API key configured                                 |
 * | 4 | haversine  | all, terminal     | always                                             |
 *
 * **Deliberate posture flip from ADR-0018 §4.** Previously a missing `db/transit-japan.db` threw
 * loudly the moment OSM-Japan was selected — "selection is by applicability, not
 * try-and-fallback." Under this table, graph-file presence is one clause of an *entry gate*:
 * missing it now means `osm-japan` silently declines to participate, the same as any other
 * unavailable entry, and the cell falls to `osrm`/`haversine`. This is intentional, not a
 * regression — `travelCostRegistry.test.ts` asserts the new behaviour explicitly, with a comment
 * naming it as a reversal, so a future reader doesn't "fix" it back.
 *
 * `isAvailable` examines only `points[0]`, never an all-points scan — an itinerary is
 * single-region by domain invariant (a Trip spanning Japan and Paris is modeled as two Trips).
 */

import fs from "node:fs";
import { haversineProvider, type PathProvider } from "@/lib/pathProvider";
import type { Point } from "@/lib/geo";
import { ALL_PATH_KINDS, type ProviderId, type TravelCost } from "@/types/path";
import { googleRoutesProvider } from "@/lib/googleRoutesProvider";
import { createOsmTransitProvider } from "@/lib/osmTransitProvider";
import { getTransitGraph, DEFAULT_GRAPH_PATH } from "@/lib/transitGraphStore";
import { inJapan } from "@/lib/discovery";
import { osrmProvider } from "@/lib/osrmProvider";
import { composeTravelMatrix, type MatrixEntry, type TravelMatrixRequest } from "@/lib/travelMatrix";

interface RegistryEntry extends Omit<MatrixEntry, "provider"> {
  /** The full `PathProvider`, not `MatrixEntry`'s `Pick<PathProvider, "costMatrix">` — narration
   * dispatch (`describeJourney` below) needs `describeJourney` too. */
  provider: PathProvider;
  /** Region + configuration only — everything that is *not* a kind (ADR-0024 §3). */
  isAvailable(points: Point[]): boolean;
}

// Bound lazily to the real ingested graph singleton — resolved per call, not at module load or at
// `isAvailable` time, so this provider's own errors (a present-but-corrupt graph file, say) still
// surface only when it is actually queried, never merely by importing the registry.
const osmJapanProvider: PathProvider = {
  async costMatrix(points, kinds, opts) {
    const { graph, spatialIndex } = getTransitGraph();
    return createOsmTransitProvider(graph, spatialIndex).costMatrix(points, kinds, opts);
  },
  async describeJourney(from, to, kinds, opts) {
    const { graph, spatialIndex } = getTransitGraph();
    return createOsmTransitProvider(graph, spatialIndex).describeJourney(from, to, kinds, opts);
  },
};

/** Exported for `travelCostRegistry.test.ts` to assert order, `kinds`, and gate behaviour
 * directly against a literal — so the table in this module's doc comment and the table in the
 * ADR can't silently drift from what the code actually does. Not meant as a general-purpose
 * export: production code goes through `buildTravelMatrix`/`describeJourney` below. */
export const REGISTRY: readonly RegistryEntry[] = [
  {
    id: "osm-japan",
    provider: osmJapanProvider,
    kinds: ["rail"],
    isAvailable: (points) =>
      points.length > 0 && inJapan(points[0].lat, points[0].lng) && fs.existsSync(DEFAULT_GRAPH_PATH),
  },
  {
    id: "osrm",
    provider: osrmProvider,
    kinds: ["walking", "driving"],
    // Region availability (inside the built Extract or not) is a per-cell concern handled inside
    // osrmProvider via snap-distance decline, not an isAvailable gate — the same reason osm-japan
    // above only gates on graph presence, not on whether any particular point is near a station.
    isAvailable: () => !!process.env.OSRM_FOOT_URL && !!process.env.OSRM_CAR_URL,
  },
  {
    id: "google",
    provider: googleRoutesProvider,
    kinds: ["bus"],
    isAvailable: () => !!process.env.GOOGLE_MAPS_API_KEY,
  },
  {
    id: "haversine",
    provider: haversineProvider,
    kinds: ALL_PATH_KINDS,
    terminal: true,
    isAvailable: () => true,
  },
];

/** The registry, filtered to entries available for this request's representative point, in
 * preference order — the set both `buildTravelMatrix` and narration dispatch actually walk. */
function availableEntries(points: Point[]): RegistryEntry[] {
  return REGISTRY.filter((e) => e.isAvailable(points));
}

/** Composes a full travel-cost matrix over the real four-row registry (ADR-0024 §4). Thin over
 * `composeTravelMatrix` — this function's only job is binding the registry's entries and
 * availability gates to that pure composer. */
export async function buildTravelMatrix(points: Point[], request: TravelMatrixRequest): Promise<TravelCost[][]> {
  return composeTravelMatrix(availableEntries(points), points, request);
}

/**
 * Narration dispatch (ADR-0024 §6): the first available entry whose declared kinds intersect the
 * request answers the *whole* journey — used for the final plan's display (a Journey's constituent
 * Paths), never inside matrix construction. Per-Path multi-provider chaining within one journey
 * (walk to a station via OSRM, ride via OSM-Japan, walk again) is deferred — it needs
 * `osmTransitProvider` to expose its snapped station endpoints, which it does not yet.
 */
export async function describeJourney(
  from: Parameters<PathProvider["describeJourney"]>[0],
  to: Parameters<PathProvider["describeJourney"]>[1],
  kinds: Parameters<PathProvider["describeJourney"]>[2],
  opts?: Parameters<PathProvider["describeJourney"]>[3]
): ReturnType<PathProvider["describeJourney"]> {
  for (const entry of availableEntries([from])) {
    const kindsForEntry = entry.kinds.filter((k) => kinds.includes(k));
    if (kindsForEntry.length === 0) continue;
    const result = await entry.provider.describeJourney(from, to, kindsForEntry, opts);
    if (result) return result;
  }
  // Unreachable in practice: haversine is terminal, always available, and never declines.
  throw new Error("describeJourney: no provider answered this journey");
}
