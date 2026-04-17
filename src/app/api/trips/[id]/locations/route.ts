import { NextRequest, NextResponse } from "next/server";
import { getDb, newId } from "@/lib/db";
import { findPlaceFromText, getPlaceDetails } from "@/lib/places";
import { enqueueLocationEnrichment } from "@/lib/enrichmentQueue";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;
  const body = await req.json();
  const { name, address, lat, lng, placeId, rating, reviewCount, categories, hintLat, hintLng } = body;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  if (placeId) {
    const existing = getDb()
      .prepare("SELECT id FROM Location WHERE tripId = ? AND placeId = ?")
      .get(tripId, placeId);
    if (existing) {
      return NextResponse.json({ error: "Already in trip" }, { status: 409 });
    }
  }

  let resolvedLat: number | null = lat ?? null;
  let resolvedLng: number | null = lng ?? null;
  let resolvedPlaceId: string | null = placeId ?? null;
  let enrichmentStatus: "done" | "pending" | "failed" = "done";

  // Inline enrichment data for Path B (resolved immediately)
  let inlinePhone: string | null = null;
  let inlineOpenTime: string | null = null;
  let inlineCloseTime: string | null = null;
  let inlineRating: number | null = rating ?? null;
  let inlineReviewCount: number | null = reviewCount ?? null;
  let inlineCategories: string[] | null = categories ?? null;

  if (typeof placeId === "string" && placeId.startsWith("tabelog:")) {
    // Path C: Tabelog — geocode to get real Google placeId + coordinates.
    // The original tabelog: prefix is replaced at write time so the subsequent
    // enrichment queue call only needs getPlaceDetails (no redundant Text Search).
    const hint =
      typeof hintLat === "number" && typeof hintLng === "number"
        ? { lat: hintLat as number, lng: hintLng as number }
        : null;
    // 5 km bias radius — anchor is a hotel, not the restaurant, so a tight
    // radius would miss most results in the same neighbourhood.
    const found = await findPlaceFromText(
      name,
      hint?.lat ?? null,
      hint?.lng ?? null,
      5000
    );
    if (found) {
      resolvedLat = found.lat;
      resolvedLng = found.lng;
      resolvedPlaceId = found.placeId; // replaces "tabelog:" prefix
    }
    // Always pending: getPlaceDetails (phone/hours) will be fetched by the queue.
    enrichmentStatus = "pending";
  } else if (typeof placeId === "string" && placeId.length > 0) {
    // Path B: Google nearby add — has a real placeId already.
    // Call getPlaceDetails inline (~300 ms) so the location is fully enriched
    // when the response arrives. Fall back to queued enrichment on failure.
    const details = await getPlaceDetails(placeId);
    if (details) {
      inlinePhone = details.phone;
      inlineOpenTime = details.openTime;
      inlineCloseTime = details.closeTime;
      // Prefer details values over the partial data from searchNearby
      if (details.rating !== null) inlineRating = details.rating;
      if (details.reviewCount !== null) inlineReviewCount = details.reviewCount;
      if (details.categories.length > 0) inlineCategories = details.categories;
      enrichmentStatus = "done";
    } else {
      // getPlaceDetails failed — store partial data, queue for retry
      enrichmentStatus = "pending";
    }
  } else if (resolvedLat !== null && resolvedLng !== null) {
    // No placeId but coordinates are known — queue for findPlaceFromText → getPlaceDetails
    enrichmentStatus = "pending";
  }
  // else: no placeId and no coordinates — nothing enrichable; leave as 'done'

  const id = newId();
  getDb()
    .prepare(
      `INSERT INTO Location
        (id, tripId, name, address, lat, lng, placeId, excluded, note,
         rating, reviewCount, categories, phone, openTime, closeTime, enrichmentStatus)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      tripId,
      name,
      address ?? null,
      resolvedLat,
      resolvedLng,
      resolvedPlaceId,
      inlineRating ?? null,
      inlineReviewCount ?? null,
      inlineCategories ? JSON.stringify(inlineCategories) : null,
      inlinePhone,
      inlineOpenTime,
      inlineCloseTime,
      enrichmentStatus,
    );

  if (enrichmentStatus === "pending") {
    enqueueLocationEnrichment(id);
  }

  const location = getDb().prepare("SELECT * FROM Location WHERE id = ?").get(id);
  return NextResponse.json(location, { status: 201 });
}
