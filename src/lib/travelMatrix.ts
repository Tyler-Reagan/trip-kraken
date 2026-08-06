/**
 * `DistanceLookup` (ADR-0004/O2) — the optimizer's actual currency. Sequencing never touches a
 * Path or a Journey; it reads `km(aId, bId)`/`mins(aId, bId)`, keyed by Location id, over a matrix
 * fetched once per optimize run. Split out of the dissolved `travelCost.ts` because this is
 * `Point` + `TravelCost` currency, distinct from the shape module (`types/path.ts`) and the
 * provider module (`pathProvider.ts`) it sits between.
 */

import type { Point, TravelCost } from "@/types/path";
import type { PathProvider, PathProviderOptions, TravelMode } from "@/lib/pathProvider";

export interface DistanceLookup {
  km(aId: string, bId: string): number;
  mins(aId: string, bId: string): number;
}

/**
 * Fetches one full pairwise matrix upfront and returns synchronous by-id lookups over it — the
 * batching ADR-0004 calls for. Sequencing (optimizer.ts) calls this once per optimize run, then
 * every distance/duration query inside its construction loops is a plain array read, not a
 * provider round trip.
 */
export async function buildDistanceLookup(
  provider: PathProvider,
  points: (Point & { id: string })[],
  mode: TravelMode,
  opts?: PathProviderOptions
): Promise<DistanceLookup> {
  const index = new Map(points.map((p, i) => [p.id, i]));
  const matrix = await provider.costMatrix(points, mode, opts);

  const cellOf = (aId: string, bId: string): TravelCost => {
    const i = index.get(aId);
    const j = index.get(bId);
    if (i === undefined) throw new Error(`buildDistanceLookup: unknown id ${aId}`);
    if (j === undefined) throw new Error(`buildDistanceLookup: unknown id ${bId}`);
    return matrix[i][j];
  };

  return {
    km: (aId, bId) => cellOf(aId, bId).distanceMeters / 1000,
    mins: (aId, bId) => cellOf(aId, bId).durationSeconds / 60,
  };
}
