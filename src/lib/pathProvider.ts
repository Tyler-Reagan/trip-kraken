/**
 * The path provider (ADR-0004, renamed by ADR-0022): every "how far / how long between two
 * places" query the optimizer's sequencing phase makes routes through this interface, so a real
 * routing API can replace the default straight-line math later without touching any caller. Named
 * for what it produces — a Path — not for the cost field that used to be its whole shape.
 *
 * Async, deliberately: a real provider is inherently a network call. Building this synchronous now
 * would force a breaking rework of every caller exactly when it matters most — when a real provider
 * actually gets added (O1-O3 grill, docs/optimizer-rebuild.md, 2026-07-06).
 *
 * NOT used by the optimizer's clustering step (kMeans/seedCentroids in optimizer.ts) — a clustering
 * centroid is a synthetic averaged point, not a real place, so "how do I travel to this made-up
 * point" isn't a meaningful provider query. Clustering stays on its own local distance math.
 *
 * `kinds` (ADR-0022 P2, revised by ADR-0024 §3) is a **static declaration of competence**, not a
 * traveler's willingness set — that concept is deleted. `buildTravelMatrix`
 * (`travelCostRegistry.ts`) intersects a request's kinds against each registry entry's declared
 * `kinds` before calling it, so a provider only ever sees kinds it claimed it can answer for; a
 * provider never has to infer or collapse a set it didn't ask for.
 */

import { type Path, type PathEndpoint, type PathKind, type TravelCost, makeTravelCost } from "@/types/path";
import { haversineMeters, type Point } from "@/lib/geo";

export interface PathProviderOptions {
  /** Representative departure datetime (ADR-0018) — timetables are calendar-dependent, so a real
   * transit provider needs a date, not just a time-of-day. One matrix is fetched per optimize run
   * at one representative datetime; providers that don't model time-of-day (haversine) ignore it. */
  departureTime?: Date;
}

/** A provider's answer for one matrix cell, or `null` — an explicit decline (ADR-0024 §4). `null`
 * rather than `undefined`: `undefined` is what an unfilled array slot already is before anything
 * has run, so the composer needs a distinct value to say "this provider looked and declined." */
export type MatrixCell = TravelCost | null;

export interface PathProvider {
  /** Fetch every pairwise cost in one round trip (ADR-0004), for sequencing's inner loops. Any
   * cell may be `null` — the provider declining that specific pair, not an error. */
  costMatrix(points: Point[], kinds: PathKind[], opts?: PathProviderOptions): Promise<MatrixCell[][]>;
  /** One A-to-B journey as its constituent Paths (ADR-0021, ADR-0022) — for the final plan's
   * display only; called lazily at display time, never inside sequencing's construction/refinement
   * loops. `null` is a decline, the same as a `MatrixCell`. Every provider currently returns a
   * single-element array when it does answer (decomposition unimplemented, P1 of the ADR-0022
   * refactor). */
  describeJourney(from: PathEndpoint, to: PathEndpoint, kinds: PathKind[], opts?: PathProviderOptions): Promise<Path[] | null>;
}

// Average city travel speed for estimating durations (20 km/h) — unchanged from the pre-O2 constant.
const AVG_SPEED_M_PER_S = (20 * 1000) / 3600;

function haversineCost(from: Point, to: Point): TravelCost {
  const distanceMeters = haversineMeters(from, to);
  return makeTravelCost(distanceMeters, distanceMeters / AVG_SPEED_M_PER_S, "straightLine", "haversine");
}

/**
 * Default provider (ADR-0004): straight-line distance + one fixed speed — the same numbers the
 * pre-O2 optimizer produced. `mode` is accepted (interface contract) but ignored here; giving each
 * mode its own speed is a real quality change (category A, docs/optimizer-rebuild.md), deliberately
 * not bundled into this slice. `describeJourney` always returns a single `UnknownPath`: no route
 * was computed, so there is no honest kind to report (ADR-0022). This is the registry's terminal
 * entry (ADR-0024 §4) — it never declines, which is what the composer relies on to guarantee
 * completion.
 */
export const haversineProvider: PathProvider = {
  async costMatrix(points) {
    return points.map((p) => points.map((q) => haversineCost(p, q)));
  },
  async describeJourney(from, to) {
    return [{ from, to, travelCost: haversineCost(from, to) }];
  },
};
