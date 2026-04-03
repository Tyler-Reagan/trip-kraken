import { NextRequest, NextResponse } from "next/server";
import { moveStop } from "@/lib/db";

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

  try {
    const updated = moveStop(tripId, stopId, targetDayId, targetOrder);
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 404 });
  }
}
