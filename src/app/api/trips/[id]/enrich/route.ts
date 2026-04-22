import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { enrichLocation } from "@/lib/places";
import { SQLInputValue } from "node:sqlite";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;

  const tripExists = getDb().prepare("SELECT id FROM Trip WHERE id = ?").get(tripId);
  if (!tripExists) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  // Eligibility: locations that have been flagged as needing enrichment.
  // enrichmentStatus is set to 'pending' at creation time (import, nearby add)
  // and to 'failed' when a previous enrichment attempt did not succeed.
  // This endpoint is the retry/recovery path — the happy path is handled
  // automatically by the enrichment queue on location creation.
  type LocRow = { id: string; name: string; lat: number | null; lng: number | null; placeId: string | null };
  const locations = getDb().prepare(`
    SELECT id, name, lat, lng, placeId
    FROM Location
    WHERE tripId = ?
      AND enrichmentStatus IN ('pending', 'failed')
  `).all(tripId) as LocRow[];

  const total = locations.length;
  let enriched = 0;
  let errors = 0;

  const updateStmt = getDb().prepare(`
    UPDATE Location SET
      placeId          = COALESCE(?, placeId),
      lat              = COALESCE(?, lat),
      lng              = COALESCE(?, lng),
      rating           = COALESCE(?, rating),
      reviewCount      = COALESCE(?, reviewCount),
      categories       = COALESCE(?, categories),
      phone            = COALESCE(?, phone),
      openTime         = COALESCE(?, openTime),
      closeTime        = COALESCE(?, closeTime),
      hoursJson        = COALESCE(?, hoursJson),
      enrichmentStatus = 'done'
    WHERE id = ?
  `);

  for (const loc of locations) {
    try {
      const result = await enrichLocation(loc);

      if (Object.keys(result).length === 0) {
        getDb()
          .prepare("UPDATE Location SET enrichmentStatus = 'failed' WHERE id = ?")
          .run(loc.id);
        errors++;
        continue;
      }

      updateStmt.run(
        ...[
          result.placeId ?? null,
          result.lat ?? null,
          result.lng ?? null,
          result.rating ?? null,
          result.reviewCount ?? null,
          result.categories ? JSON.stringify(result.categories) : null,
          result.phone ?? null,
          result.openTime ?? null,
          result.closeTime ?? null,
          result.hoursJson ? JSON.stringify(result.hoursJson) : null,
          loc.id,
        ] as SQLInputValue[]
      );
      enriched++;
    } catch {
      getDb()
        .prepare("UPDATE Location SET enrichmentStatus = 'failed' WHERE id = ?")
        .run(loc.id);
      errors++;
    }

    // Rate-limit: stay well under Google's 10 QPS default
    await new Promise((r) => setTimeout(r, 150));
  }

  return NextResponse.json({ enriched, total, errors });
}
