import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseKml, parseKmz } from "@/lib/parsers/kml";

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
    return NextResponse.json({ error: "A KML or KMZ file is required." }, { status: 400 });
  }

  const isKmz = file.name.endsWith(".kmz");
  const isKml = file.name.endsWith(".kml");

  if (!isKml && !isKmz) {
    return NextResponse.json(
      { error: "File must be a .kml or .kmz export from Google My Maps." },
      { status: 400 }
    );
  }

  let places;
  try {
    if (isKmz) {
      const buffer = Buffer.from(await file.arrayBuffer());
      places = parseKmz(buffer);
    } else {
      const text = await file.text();
      places = parseKml(text);
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 422 });
  }

  if (places.length === 0) {
    return NextResponse.json(
      { error: "No point locations found in the file. Make sure your My Maps layer has place pins (not just lines or polygons)." },
      { status: 422 }
    );
  }

  // KML already has coordinates — no geocoding needed
  const tripName = name || `KML import — ${new Date().toLocaleDateString()}`;

  const trip = await db.trip.create({
    data: {
      name: tripName,
      sourceUrl: `kml:${file.name}`,
      locations: {
        create: places.map((place) => ({
          name: place.name,
          address: place.description ?? null,
          lat: place.lat,
          lng: place.lng,
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
