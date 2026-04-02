import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseTakeoutCsv } from "@/lib/parsers/takeout-csv";
import { geocodePlaces } from "@/lib/geocoding";
import type { ScrapedPlace } from "@/lib/scraper";

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const file = formData.get("file");
  const name = (formData.get("name") as string | null)?.trim() || null;

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "A CSV file is required." }, { status: 400 });
  }

  if (!file.name.endsWith(".csv")) {
    return NextResponse.json(
      { error: "File must be a .csv export from Google Takeout." },
      { status: 400 }
    );
  }

  const text = await file.text();

  let parsed;
  try {
    parsed = parseTakeoutCsv(text);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 422 }
    );
  }

  if (parsed.length === 0) {
    return NextResponse.json(
      { error: "No places found in the CSV. Make sure this is a Google Takeout Saved Places export." },
      { status: 422 }
    );
  }

  // Convert to ScrapedPlace shape so the shared geocoding layer can handle it
  const scraped: ScrapedPlace[] = parsed.map((p) => ({
    name: p.name,
    lat: p.lat,
    lng: p.lng,
  }));

  let geocoded;
  try {
    geocoded = await geocodePlaces(scraped);
  } catch (err) {
    console.error("Geocoding error:", err);
    return NextResponse.json(
      { error: "Geocoding failed. Check that GOOGLE_MAPS_API_KEY is set correctly." },
      { status: 500 }
    );
  }

  const tripName = name || `Takeout import — ${new Date().toLocaleDateString()}`;

  const trip = await db.trip.create({
    data: {
      name: tripName,
      sourceUrl: `takeout-csv:${file.name}`,
      locations: {
        create: geocoded.map((place) => ({
          name: place.name,
          address: place.address ?? null,
          lat: place.lat,
          lng: place.lng,
          placeId: place.placeId ?? null,
        })),
      },
    },
    include: {
      locations: true,
      days: { include: { stops: { include: { location: true } } } },
    },
  });

  return NextResponse.json(trip, { status: 201 });
}
