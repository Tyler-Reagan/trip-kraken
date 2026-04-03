import { NextRequest, NextResponse } from "next/server";
import { createTripWithLocations } from "@/lib/db";
import { scrapeGoogleMapsList } from "@/lib/scraper";
import { geocodePlaces } from "@/lib/geocoding";

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

  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: "url is not valid" }, { status: 400 });
  }

  let scraped;
  try {
    scraped = await scrapeGoogleMapsList(url);
  } catch (err) {
    console.error("Scrape error:", err);
    return NextResponse.json(
      { error: "Failed to load the Google Maps list. Make sure the link is publicly shared." },
      { status: 422 }
    );
  }

  if (scraped.length === 0) {
    return NextResponse.json(
      { error: "No locations found in that list. Is the link publicly accessible?" },
      { status: 422 }
    );
  }

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

  const trip = createTripWithLocations({
    name: name?.trim() || deriveTripName(url),
    sourceUrl: url,
    locations: geocoded.map((p) => ({
      name: p.name,
      address: p.address ?? null,
      lat: p.lat,
      lng: p.lng,
      placeId: p.placeId ?? null,
    })),
  });

  return NextResponse.json(trip, { status: 201 });
}

function deriveTripName(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length > 0) return `Trip – ${parts[parts.length - 1]}`;
  } catch {}
  return `Trip ${new Date().toLocaleDateString()}`;
}
