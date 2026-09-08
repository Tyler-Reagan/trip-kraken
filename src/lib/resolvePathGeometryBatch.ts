import { describeJourney } from "@/lib/travelCostRegistry";
import { journeyRoadKindFor, withJourneyRoadKind } from "@/lib/pathPairs";
import { OsrmUnavailableError } from "@/lib/osrmProvider";
import type { PairRequest } from "@/lib/pathGeometryRequest";
import type { Path, RoadProfile } from "@/types/path";
import type { JourneyRoadKind } from "@/types";

/** A fixed pool over a shared cursor — results stay index-aligned with `items` regardless of the
 * order the workers finish in, which is what lets the response be a parallel array. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    for (let i = cursor++; i < items.length; i = cursor++) {
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

/** The containers are local (ADR-0025) and answer in milliseconds, so this exists to keep a burst
 * from queueing inside OSRM rather than to protect a rate limit. */
const CONCURRENCY = 8;

/**
 * The shared core of every path-geometry route (ADR-0029, #182; kinds widened by ADR-0030 §10;
 * trip-less addressing added by ADR-0043). Takes the pairs the client does not already hold and
 * answers each one with the Paths it resolves to — one lookup per pair, nothing cached here and
 * nothing written to the database (ADR-0029 §6). See the trip-scoped route
 * (`app/api/trips/[id]/path-geometry/route.ts`) for the full registry-dispatch narrative this
 * implements; both routes call this function identically, differing only in where `roadProfile`
 * and `journeyRoadKinds` come from.
 */
export async function resolvePathGeometryBatch(
  pairs: PairRequest[],
  roadProfile: RoadProfile,
  journeyRoadKinds: JourneyRoadKind[],
): Promise<{ results: (Path[] | null)[]; retry: number[] }> {
  // Indices whose pair could not be answered because a provider was unreachable (Fly's scale-to-zero
  // cold start, ADR-0037, is the expected source of this in production) rather than because it
  // genuinely answered "no route." The client must not cache `results[i]` at these indices as a
  // real "no geometry" answer — the honest state is "not yet answered," and it should ask again once
  // the provider has had a chance to warm up.
  const retry: number[] = [];

  const results = await mapWithConcurrency(
    pairs,
    CONCURRENCY,
    async (pair, i): Promise<Path[] | null> => {
      // A *declined* pair already resolves to a terminal `haversine` answer, so nothing here needs a
      // catch for that. This catch is for a pair a provider refuses outright — it throws rather than
      // declines on a non-`Ok` response code, `NoRoute` among them (two points with no road path
      // between them at all). One such pair must not fail the batch: `null` means "no geometry", the
      // map draws that pair straight and dashed, and the honest reading is unchanged.
      try {
        // #223: a Journey with a chosen kind gets that kind instead of the Trip's `roadProfile` —
        // the same substitution the optimizer and self-heal apply, kept to the base list this route
        // already uses (no "bus", per the cost-avoidance reasoning in the trip-scoped route). Without
        // this, a chosen Journey's displayed geometry (and duration — the same Path objects feed
        // both) silently disagreed with what was actually chosen.
        const chosen =
          pair.from.locationId && pair.to.locationId
            ? journeyRoadKindFor(
                journeyRoadKinds,
                pair.from.locationId,
                pair.to.locationId,
              )
            : undefined;
        const kinds = withJourneyRoadKind(["rail", roadProfile], chosen);
        return await describeJourney(pair.from, pair.to, kinds);
      } catch (err) {
        if (err instanceof OsrmUnavailableError) retry.push(i);
        return null;
      }
    },
  );

  return { results, retry };
}
