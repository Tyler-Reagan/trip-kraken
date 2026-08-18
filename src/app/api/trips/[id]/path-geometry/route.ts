import { NextRequest, NextResponse } from "next/server";
import { getTripWithDetails } from "@/lib/db";
import { describeJourney } from "@/lib/travelCostRegistry";
import type { Path, PathEndpoint } from "@/types/path";

/**
 * Real Path geometry for the map canvas (ADR-0029, #182). Takes the pairs the client does not
 * already hold and answers each one with the Paths it resolves to — one lookup per pair, nothing
 * cached here and nothing written to the database (§6).
 *
 * **The `kinds` argument is `[trip.roadProfile]` alone, and that is load-bearing (§2).** Narration
 * dispatch (ADR-0024 §6) gives the whole Journey to the first registry entry whose declared kinds
 * intersect the request, and `osm-japan` is row 1 with `kinds: ["rail"]` behind a gate that is true
 * for any Trip in Japan. Passing `selfHeal`'s `healKinds` here — the obvious reading of ADR-0026's
 * precedent — would hand every pair to `osm-japan`, which returns Paths carrying no geometry until
 * #142 lands, and would also match `google` on `bus`, billing per call on every map load. Narrowing
 * to the Road profile drops both entries out on the kind intersection: `osrm` answers or declines by
 * snap distance, and terminal `haversine` fills the rest with `basisOfCost: straightLine`, which is
 * exactly the solid-vs-dashed distinction the map draws.
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
      return await describeJourney(pair.from, pair.to, [trip.roadProfile]);
    } catch {
      return null;
    }
  });

  return NextResponse.json({ results });
}
