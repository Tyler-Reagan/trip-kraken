import { NextRequest, NextResponse } from "next/server";
import { getTripWithDetails } from "@/lib/db";
import { describeJourney } from "@/lib/travelCostRegistry";
import type { Path, PathEndpoint } from "@/types/path";

/**
 * Real Path geometry for the map canvas (ADR-0029, #182; kinds widened by ADR-0030 §10). Takes the
 * pairs the client does not already hold and answers each one with the Paths it resolves to — one
 * lookup per pair, nothing cached here and nothing written to the database (ADR-0029 §6).
 *
 * **The `kinds` argument is `["rail", trip.roadProfile]`.** ADR-0029 §2 narrowed this to the Road
 * profile alone and named the narrowing as a bill that would come due; ADR-0030 §10 is that
 * revisit, and the condition it waited on — rail Paths having real geometry — is what ADR-0030
 * delivers. The narrowing was right when `osm-japan` had no shapes to return. It is not right now:
 * it made the map contradict the Plan on most urban Japanese pairs, drawing a solid OSRM walking
 * line across a journey the optimizer had costed as a train ride.
 *
 * What each registry entry does with this request (ADR-0024 §4/§6 — narration dispatch hands the
 * Journey to the first available entry whose declared kinds intersect):
 *
 *  - `osm-japan` (`kinds: ["rail"]`) answers where it has stations in snap range, and declines
 *    otherwise. Its Paths now carry the spans they really have.
 *  - `google` (`kinds: ["bus"]`) fails the intersection and drops out, so no Google call is made on
 *    a map load and ADR-0018's persistence rule is untouched. **Do not widen this to the
 *    optimizer's full `["rail", "bus", roadProfile]`** — that reintroduces exactly the per-call
 *    billing ADR-0029 §2 raised, for data ADR-0018 forbids persisting.
 *  - `osrm` answers or declines on snap distance; terminal `haversine` fills the rest with
 *    `basisOfCost: straightLine`.
 *
 * **The residual is recorded, not hidden.** A pair the optimizer costed via Google as a bus ride is
 * drawn by whatever `osrm` or `haversine` answers, so the map still disagrees with the Plan there.
 * That is a smaller and better-understood disagreement than the one this change removes, and bus
 * geometry is its own ticket under #181.
 *
 * The client's cache key (`pairKey`) still keys on the Road profile alone, which stays correct:
 * `"rail"` is constant in every request and so discriminates nothing, while the profile genuinely
 * changes the answer for a pair `osm-japan` declines.
 *
 * POST rather than GET because the pair list does not fit comfortably in a URL; it reads state and
 * changes none.
 */

/** Generous enough for a month-long Trip with a full Day of stops, low enough that a malformed
 * client cannot ask for unbounded work. */
const MAX_PAIRS = 600;

/** The containers are local (ADR-0025) and answer in milliseconds, so this exists to keep a burst
 * from queueing inside OSRM rather than to protect a rate limit. */
const CONCURRENCY = 8;

interface PairRequest {
  from: PathEndpoint;
  to: PathEndpoint;
}

function parseEndpoint(value: unknown): PathEndpoint | null {
  if (!value || typeof value !== "object") return null;
  const { lat, lng } = value as { lat?: unknown; lng?: unknown };
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function parsePairs(value: unknown): PairRequest[] | null {
  if (!Array.isArray(value)) return null;
  const pairs: PairRequest[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null;
    const from = parseEndpoint((entry as { from?: unknown }).from);
    const to = parseEndpoint((entry as { to?: unknown }).to);
    if (!from || !to) return null;
    pairs.push({ from, to });
  }
  return pairs;
}

/** A fixed pool over a shared cursor — results stay index-aligned with `items` regardless of the
 * order the workers finish in, which is what lets the response be a parallel array. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    for (let i = cursor++; i < items.length; i = cursor++) {
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tripId } = await params;

  const trip = getTripWithDetails(tripId);
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const pairs = parsePairs((body as { pairs?: unknown })?.pairs);
  if (!pairs) return NextResponse.json({ error: "pairs must be an array of {from,to} coordinates" }, { status: 400 });
  if (pairs.length > MAX_PAIRS) {
    return NextResponse.json({ error: `pairs exceeds the ${MAX_PAIRS} maximum` }, { status: 400 });
  }

  const results = await mapWithConcurrency(pairs, CONCURRENCY, async (pair): Promise<Path[] | null> => {
    // A *declined* pair already resolves to a terminal `haversine` answer, so nothing here needs a
    // catch for that. This catch is for a pair OSRM refuses outright — it throws rather than
    // declines on a non-`Ok` response code, `NoRoute` among them (two points with no road path
    // between them at all). One such pair must not fail the batch: `null` means "no geometry", the
    // map draws that pair straight and dashed, and the honest reading is unchanged.
    try {
      return await describeJourney(pair.from, pair.to, ["rail", trip.roadProfile]);
    } catch {
      return null;
    }
  });

  return NextResponse.json({ results });
}
