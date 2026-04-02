import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { optimizeItinerary } from "@/lib/optimizer";

// POST — (re)generate an optimized itinerary for the trip
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;
  const body = await req.json();
  const { numDays, startDate } = body;

  if (!numDays || typeof numDays !== "number" || numDays < 1) {
    return NextResponse.json(
      { error: "numDays must be a positive integer" },
      { status: 400 }
    );
  }

  // Load the trip with all non-excluded locations
  const trip = await db.trip.findUnique({
    where: { id: tripId },
    include: { locations: { where: { excluded: false } } },
  });

  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  // Run the optimizer
  const locationInputs = trip.locations.map((l) => ({
    id: l.id,
    lat: l.lat ?? 0,
    lng: l.lng ?? 0,
  }));

  const dayPlans = optimizeItinerary(locationInputs, numDays);

  // Delete existing days and stops, then write the new plan in a transaction
  await db.$transaction(async (tx) => {
    await tx.itineraryDay.deleteMany({ where: { tripId } });

    await tx.trip.update({
      where: { id: tripId },
      data: {
        numDays,
        ...(startDate && { startDate: new Date(startDate) }),
      },
    });

    for (const plan of dayPlans) {
      const date =
        startDate && plan.dayNumber > 0
          ? new Date(
              new Date(startDate).getTime() +
                (plan.dayNumber - 1) * 24 * 60 * 60 * 1000
            )
          : null;

      await tx.itineraryDay.create({
        data: {
          tripId,
          dayNumber: plan.dayNumber,
          date,
          stops: {
            create: plan.locationIds.map((locationId, order) => ({
              locationId,
              order,
            })),
          },
        },
      });
    }
  });

  // Return the full updated trip
  const updated = await db.trip.findUnique({
    where: { id: tripId },
    include: {
      locations: { orderBy: { name: "asc" } },
      days: {
        orderBy: { dayNumber: "asc" },
        include: {
          stops: {
            orderBy: { order: "asc" },
            include: { location: true },
          },
        },
      },
    },
  });

  return NextResponse.json(updated);
}
