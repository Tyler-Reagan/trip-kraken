import { NextRequest, NextResponse } from "next/server";
import { solve, type OptimizationProblem } from "@/lib/solver";

/**
 * ADR-0045: a trip-less sibling of `/api/trips/[id]/optimize`, for the same reason ADR-0043 added
 * one for path-geometry — the Swift client's trips live entirely in local SwiftData (ADR-0040)
 * and are never rows in this server's database. Unlike that sibling, this one is compute-only in
 * both directions: `solve()` (`src/lib/solver.ts`) was already a pure function with no Turso
 * involvement at all, so this route is a thin wrapper exposing exactly that. It never calls
 * `setPlacements` — there is nothing sensible to persist to for a trip that isn't a Turso row.
 * The caller (the Swift client, shaping its own `OptimizationProblem` from a local `TripWithDetails`,
 * mirroring `optimize.ts`'s `toInput`/stays/edges derivation) persists the returned `Itinerary`
 * into its own store itself.
 *
 * Validation here is lighter than `/api/path-geometry`'s: check the minimum `solve()` needs to
 * not fail confusingly (`locations` an array, `numDays` a positive number), and let anything
 * deeper surface as a caught 500 — matching `optimizeTrip`'s own established error-handling
 * philosophy ("a selected provider's error propagates by design") rather than path-geometry's
 * exhaustive per-field checks.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }
  const problem = body as Partial<OptimizationProblem>;
  if (!Array.isArray(problem.locations)) {
    return NextResponse.json(
      { error: "locations must be an array" },
      { status: 400 },
    );
  }
  if (typeof problem.numDays !== "number" || problem.numDays < 1) {
    return NextResponse.json(
      { error: "numDays must be a positive number" },
      { status: 400 },
    );
  }

  try {
    const itinerary = await solve(problem as OptimizationProblem);
    return NextResponse.json(itinerary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Optimization failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
