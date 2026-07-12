import { NextRequest, NextResponse } from "next/server";
import { locationExistsByPlaceId, createLocation } from "@/lib/db";
import { getPlaceDetails } from "@/lib/places";
import { enqueueLocationEnrichment } from "@/lib/enrichmentQueue";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;
  const body = await req.json();
  const { name, address, lat, lng, placeId, rating, reviewCount, categories } = body;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  if (placeId && locationExistsByPlaceId(tripId, placeId)) {
    return NextResponse.json({ error: "Already in trip" }, { status: 409 });
  }

  let resolvedLat: number | null = lat ?? null;
  let resolvedLng: number | null = lng ?? null;
  let resolvedPlaceId: string | null = placeId ?? null;
  let enrichmentStatus: "done" | "pending" | "failed" = "done";

  // Inline enrichment data for Path B (resolved immediately)
  let inlineAddress: string | null = address ?? null;
  let inlinePhone: string | null = null;
  let inlineOpenTime: string | null = null;
  let inlineCloseTime: string | null = null;
  let inlineHoursJson: Record<string, { open: string; close: string | null }> | null = null;
  let inlineRating: number | null = rating ?? null;
  let inlineReviewCount: number | null = reviewCount ?? null;
  let inlineCategories: string[] | null = categories ?? null;

  if (typeof placeId === "string" && placeId.length > 0) {
    // Path B: Google nearby add — has a real placeId already.
    // Call getPlaceDetails inline (~300 ms) so the location is fully enriched
    // when the response arrives. Fall back to queued enrichment on failure.
    const details = await getPlaceDetails(placeId);
    if (details) {
      if (details.address) inlineAddress = details.address;
      inlinePhone = details.phone;
      inlineOpenTime = details.openTime;
      inlineCloseTime = details.closeTime;
      inlineHoursJson = details.hoursJson;
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

  const location = createLocation(tripId, {
    name,
    address: inlineAddress,
    lat: resolvedLat,
    lng: resolvedLng,
    placeId: resolvedPlaceId,
    rating: inlineRating ?? null,
    reviewCount: inlineReviewCount ?? null,
    categories: inlineCategories,
    phone: inlinePhone,
    openTime: inlineOpenTime,
    closeTime: inlineCloseTime,
    hoursJson: inlineHoursJson,
    enrichmentStatus,
  });

  if (enrichmentStatus === "pending") {
    enqueueLocationEnrichment(location.id);
  }

  return NextResponse.json(location, { status: 201 });
}
