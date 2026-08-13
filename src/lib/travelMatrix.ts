/**
 * `composeTravelMatrix` (below) is the pure composition core ADR-0024 §4 introduces: given a
 * preference-ordered list of registry entries, it walks them per cell, so `buildTravelMatrix`
 * (`travelCostRegistry.ts`) can bind the real four-row registry while this module stays
 * importable without pulling in anything registry-specific (`better-sqlite3`, env reads). The
 * VROOM request builder (`src/lib/vroom/request.ts`, ADR-0023) calls `buildTravelMatrix` directly
 * and reads cells positionally, so there is no id-keyed lookup layer above this any more —
 * `DistanceLookup`/`buildDistanceLookup` (the pre-VROOM optimizer's currency) were deleted with it.
 */

import type { Point } from "@/lib/geo";
import type { PathKind, ProviderId, TravelCost } from "@/types/path";
import type { MatrixCell, PathProvider } from "@/lib/pathProvider";

/** One request to compose a matrix for — the kinds this run wants sourced (ADR-0024 §3, a static
 * declaration of what's being asked, not a traveler's willingness set) and ADR-0018's single
 * representative departure datetime. */
export interface TravelMatrixRequest {
  kinds: PathKind[];
  departureTime?: Date;
}

/** One registry row, reduced to what the pure composer needs — `travelCostRegistry.ts` supplies
 * the real four rows and their availability gates; this module never imports env or a graph
 * store, so it stays testable with fakes and importable without `better-sqlite3`. */
export interface MatrixEntry {
  id: ProviderId;
  /** Static competence (ADR-0024 §3) — a selection predicate, not a promise about the answer's
   * shape. The terminal entry (`haversine`) declares every `PathKind`, which is what makes it
   * reachable regardless of what a request asks for. */
  kinds: readonly PathKind[];
  terminal?: true;
  provider: Pick<PathProvider, "costMatrix">;
}

/**
 * Composes a full matrix by walking `entries` in order and asking each only about the cells still
 * unfilled (ADR-0024 §4's "first capable provider wins each cell"). Two properties beyond that:
 *
 * - An entry whose `kinds` don't intersect the request is never called at all — not called with
 *   an empty kind list, simply skipped.
 * - Each subsequent entry is asked about the *point subset* still participating in an unfilled
 *   cell, not the full N². Without this, twelve unfilled cells of a 60×60 matrix would hand a
 *   metered provider all 3,600 elements to answer twelve of; this is what makes ADR-0024 §7's
 *   "its exposure is bounded by composition" true rather than aspirational.
 *
 * Throws if any cell remains unfilled once every entry has run — the terminal guarantee is stated
 * in a type (`MatrixEntry.terminal`) that cannot enforce it by itself, so this asserts it instead
 * of silently returning a hole.
 */
export async function composeTravelMatrix(
  entries: readonly MatrixEntry[],
  points: Point[],
  request: TravelMatrixRequest
): Promise<TravelCost[][]> {
  const n = points.length;
  const matrix: MatrixCell[][] = Array.from({ length: n }, () => new Array(n).fill(null));

  const isComplete = () => matrix.every((row) => row.every((cell) => cell !== null));

  for (const entry of entries) {
    if (isComplete()) break;

    const kinds = entry.kinds.filter((k) => request.kinds.includes(k));
    if (kinds.length === 0) continue;

    const activeIndices: number[] = [];
    for (let i = 0; i < n; i++) {
      const rowHasGap = matrix[i].some((c) => c === null);
      const colHasGap = matrix.some((row) => row[i] === null);
      if (rowHasGap || colHasGap) activeIndices.push(i);
    }
    if (activeIndices.length === 0) continue;

    const activePoints = activeIndices.map((i) => points[i]);
    const subMatrix = await entry.provider.costMatrix(activePoints, kinds, { departureTime: request.departureTime });

    for (let li = 0; li < activeIndices.length; li++) {
      const origI = activeIndices[li];
      for (let lj = 0; lj < activeIndices.length; lj++) {
        const origJ = activeIndices[lj];
        if (matrix[origI][origJ] !== null) continue; // already answered by an earlier entry
        const cell = subMatrix[li]?.[lj] ?? null;
        if (cell !== null) matrix[origI][origJ] = cell;
      }
    }
  }

  return matrix.map((row, i) =>
    row.map((cell, j) => {
      if (cell === null) {
        throw new Error(`composeTravelMatrix: no terminal provider filled cell (${i},${j})`);
      }
      return cell;
    })
  );
}
