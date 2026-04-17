import { NextRequest, NextResponse } from "next/server";
import { createTripWithLocations } from "@/lib/db";
import { extractMid, fetchKml, extractKmlDocumentName } from "@/lib/myMaps";
import { parseKml } from "@/lib/parsers/kml";
import { enqueueLocationEnrichment } from "@/lib/enrichmentQueue";

export async function POST(req: NextRequest) {
  let body: { url?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { url, name } = body;
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  const mid = extractMid(url);
  if (!mid) {
    return NextResponse.json(
      {
        error:
          "This doesn't look like a Google My Maps link. Open your map at mymaps.google.com, then copy the URL from the address bar.",
      },
      { status: 400 }
    );
  }

  let kmlText: string;
  try {
    kmlText = await fetchKml(mid);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 422 });
  }

  let places;
  try {
    places = parseKml(kmlText);
  } catch (err) {
    return NextResponse.json(
      { error: `Could not parse the map data: ${(err as Error).message}` },
      { status: 422 }
    );
  }

  if (places.length === 0) {
    return NextResponse.json(
      {
        error:
          "No locations found in this map. Make sure your map has at least one placemark and is set to public.",
      },
      { status: 422 }
    );
  }

  const tripName =
    name?.trim() ||
    extractKmlDocumentName(kmlText) ||
    `Trip – ${new Date().toLocaleDateString()}`;

  const trip = createTripWithLocations({
    name: tripName,
    sourceUrl: url,
    locations: places.map((p) => ({
      name: p.name,
      address: p.description ?? null,
      lat: p.lat,
      lng: p.lng,
      placeId: null,
    })),
  });

  // Enqueue all locations for background enrichment. The trip page loads
  // immediately; locations will update as enrichment completes.
  for (const loc of trip.locations) {
    enqueueLocationEnrichment(loc.id);
  }

  return NextResponse.json(trip, { status: 201 });
}
