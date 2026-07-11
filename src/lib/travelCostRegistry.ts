/**
 * Provider-selection registry (ADR-0019, issue #86) — the piece that actually turns on the
 * OSM-Japan provider (issue #85) for a real optimize run. An ordered list of
 * `TravelCostProvider`s, each carrying an `appliesTo(points, mode)` predicate; the first entry
 * whose predicate matches wins. Precedence: OSM-Japan (Japan + transit) → Google (global default,
 * when an API key is present) → haversine (the floor, always applies) — mirrors
 * `discovery.ts`'s existing provider-list + `appliesAt`/region-gating pattern.
 *
 * Selection is by applicability, not try-and-fallback (ADR-0018 §4): once a provider is selected,
 * its errors propagate — a missing `db/transit-japan.db` throws loudly (`transitGraphStore.ts`)
 * rather than silently falling through to Google/haversine. Region is checked against a single
 * representative point (`points[0]`), never an all-points scan — an itinerary is single-region by
 * domain invariant (a Trip spanning Japan and Paris is modeled as two Trips).
 *
 * Called once per optimize run, from the orchestrator (`optimize.ts`), and the result is passed
 * into `solve()`, which keeps its existing optional `provider` param and stays provider-agnostic —
 * `solve()` itself never imports this registry.
 */

import { haversineProvider, type Point, type TravelCostProvider, type TravelMode } from "@/lib/travelCost";
import { googleRoutesProvider } from "@/lib/googleRoutesProvider";
import { createOsmTransitProvider } from "@/lib/osmTransitProvider";
import { getTransitGraph } from "@/lib/transitGraphStore";
import { inJapan } from "@/lib/discovery";

interface RegistryEntry {
  id: string;
  provider: TravelCostProvider;
  /** `points` is the full point set for signature symmetry with `selectTravelCostProvider`, but
   * only `points[0]` (the representative point) is ever examined — see the module doc. */
  appliesTo(points: Point[], mode: TravelMode): boolean;
}

// Bound lazily to the real ingested graph singleton (`getTransitGraph()`) — resolved per call, not
// at module load or at `appliesTo` time, so a missing graph file's loud error surfaces only when
// this provider is actually queried, never merely by importing the registry.
const osmJapanProvider: TravelCostProvider = {
  async costMatrix(points, mode, opts) {
    const { graph, spatialIndex } = getTransitGraph();
    return createOsmTransitProvider(graph, spatialIndex).costMatrix(points, mode, opts);
  },
  async describeLeg(from, to, mode, opts) {
    const { graph, spatialIndex } = getTransitGraph();
    return createOsmTransitProvider(graph, spatialIndex).describeLeg(from, to, mode, opts);
  },
};

const REGISTRY: readonly RegistryEntry[] = [
  {
    id: "osm-japan",
    provider: osmJapanProvider,
    appliesTo: (points, mode) => mode === "transit" && points.length > 0 && inJapan(points[0].lat, points[0].lng),
  },
  {
    id: "google",
    provider: googleRoutesProvider,
    // Global default whenever the API key is configured (ADR-0019) — Google covers drive/walk/bike
    // routing everywhere, not just transit, so this doesn't gate on `mode`.
    appliesTo: () => !!process.env.GOOGLE_MAPS_API_KEY,
  },
  {
    id: "haversine",
    provider: haversineProvider,
    appliesTo: () => true,
  },
];

/** Looks up a registry entry's provider instance by id — lets tests assert *which* provider
 * `selectTravelCostProvider` returned (e.g. confirming OSM-Japan precedence over Google) without
 * the registry needing to expose its internal entries directly. */
export function getTravelCostProviderById(id: string): TravelCostProvider | undefined {
  return REGISTRY.find((e) => e.id === id)?.provider;
}

/** Picks the first applicable provider for this optimize run's representative point + resolved
 * mode. `REGISTRY`'s last entry (haversine) always applies, so this never falls through to the
 * `?? ` default in practice — it's there only to satisfy TypeScript's control-flow analysis over
 * `Array.prototype.find`, not a real runtime fallback path. */
export function selectTravelCostProvider(points: Point[], mode: TravelMode): TravelCostProvider {
  const entry = REGISTRY.find((e) => e.appliesTo(points, mode));
  return (entry ?? REGISTRY[REGISTRY.length - 1]).provider;
}

