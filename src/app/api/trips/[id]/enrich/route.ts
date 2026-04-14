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

  // Eligibility:
  //   - Standard locations: have coords but missing openTime or placeId
  //   - Tabelog-sourced locations: have tabelog: placeId (null lat/lng is OK — Text Search will resolve them)
  type LocRow = { id: string; name: string; lat: number | null; lng: number | null; placeId: string | null };
  const locations = getDb().prepare(`
    SELECT id, name, lat, lng, placeId
    FROM Location
    WHERE tripId = ?
      AND (
        (lat IS NOT NULL AND lng IS NOT NULL AND (openTime IS NULL OR placeId IS NULL))
        OR placeId LIKE 'tabelog:%'
      )
  `).all(tripId) as LocRow[];

  const total = locations.length;
  let enriched = 0;
  let errors = 0;

  // NOTE: CASE expression overwrites Tabelog placeIds with a real Google placeId.
  // COALESCE guards preserve user-set values for non-Tabelog rows.
  const updateStmt = getDb().prepare(`
    UPDATE Location SET
      placeId     = CASE WHEN placeId LIKE 'tabelog:%' THEN ? ELSE COALESCE(placeId, ?) END,
      lat         = COALESCE(lat, ?),
      lng         = COALESCE(lng, ?),
      rating      = ?,
      reviewCount = ?,
      categories  = ?,
      phone       = ?,
      openTime    = COALESCE(openTime, ?),
      closeTime   = COALESCE(closeTime, ?)
    WHERE id = ?
  `);

  for (const loc of locations) {
    try {
      const result = await enrichLocation(loc);

      if (Object.keys(result).length === 0) continue;

      updateStmt.run(
        ...[
          result.placeId ?? null,   // CASE: new Google placeId for Tabelog rows
          result.placeId ?? null,   // COALESCE: fill null placeId for standard rows
          result.lat ?? null,
          result.lng ?? null,
          result.rating ?? null,
          result.reviewCount ?? null,
          result.categories ? JSON.stringify(result.categories) : null,
          result.phone ?? null,
          result.openTime ?? null,
          result.closeTime ?? null,
          loc.id,
        ] as SQLInputValue[]
      );
      enriched++;
    } catch {
      errors++;
    }

    // Rate-limit: stay well under Google's 10 QPS default
    await new Promise((r) => setTimeout(r, 150));
  }

  return NextResponse.json({ enriched, total, errors });
}
