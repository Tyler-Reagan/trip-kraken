import { NextRequest, NextResponse } from "next/server";
import { tripExists, getEnrichableLocations, applyEnrichment, markEnrichmentFailed } from "@/lib/db";
import { enrichLocation } from "@/lib/places";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;

  if (!tripExists(tripId)) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  // Eligibility: locations flagged as needing enrichment (pending at creation, failed on
  // a prior attempt). This endpoint is the retry/recovery path — the happy path runs
  // automatically via the enrichment queue on location creation.
  const locations = getEnrichableLocations(tripId);

  const total = locations.length;
  let enriched = 0;
  let errors = 0;

  for (const loc of locations) {
    try {
      const result = await enrichLocation(loc);
      if (applyEnrichment(loc.id, result)) enriched++;
      else errors++;
    } catch {
      markEnrichmentFailed(loc.id);
      errors++;
    }

    // Rate-limit: stay well under Google's 10 QPS default
    await new Promise((r) => setTimeout(r, 150));
  }

  return NextResponse.json({ enriched, total, errors });
}
