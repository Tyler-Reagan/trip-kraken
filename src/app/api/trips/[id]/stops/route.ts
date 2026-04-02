import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * POST — move a stop to a different day and/or position.
 * Body: { stopId, targetDayId, targetOrder }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;
  const body = await req.json();
  const { stopId, targetDayId, targetOrder } = body;

  if (!stopId || !targetDayId || targetOrder === undefined) {
    return NextResponse.json(
      { error: "stopId, targetDayId, and targetOrder are required" },
      { status: 400 }
    );
  }

  await db.$transaction(async (tx) => {
    // Get the stop and its current day
    const stop = await tx.itineraryStop.findUnique({
      where: { id: stopId },
      include: { day: true },
    });
    if (!stop) throw new Error("Stop not found");

    const sourceDayId = stop.dayId;

    // Verify the target day belongs to this trip
    const targetDay = await tx.itineraryDay.findFirst({
      where: { id: targetDayId, tripId },
    });
    if (!targetDay) throw new Error("Target day not found");

    // Shift stops in the target day to make room
    await tx.itineraryStop.updateMany({
      where: { dayId: targetDayId, order: { gte: targetOrder } },
      data: { order: { increment: 1 } },
    });

    // Move the stop
    await tx.itineraryStop.update({
      where: { id: stopId },
      data: { dayId: targetDayId, order: targetOrder },
    });

    // Re-compact the source day's order to remove gaps
    if (sourceDayId !== targetDayId) {
      const remaining = await tx.itineraryStop.findMany({
        where: { dayId: sourceDayId },
        orderBy: { order: "asc" },
      });
      for (let i = 0; i < remaining.length; i++) {
        await tx.itineraryStop.update({
          where: { id: remaining[i].id },
          data: { order: i },
        });
      }
    }
  });

  // Return updated trip
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
