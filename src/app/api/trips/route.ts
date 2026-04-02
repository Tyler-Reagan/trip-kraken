import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const trips = await db.trip.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { locations: true } },
    },
  });
  return NextResponse.json(trips);
}
