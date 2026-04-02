import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const trip = await db.trip.findUnique({
    where: { id },
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

  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  return NextResponse.json(trip);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { name, numDays, startDate } = body;

  const trip = await db.trip.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(numDays !== undefined && { numDays: Number(numDays) }),
      ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
    },
  });

  return NextResponse.json(trip);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await db.trip.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
