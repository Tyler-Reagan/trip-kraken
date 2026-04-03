import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; stopId: string }> }
) {
  const { stopId } = await params;
  db.prepare("DELETE FROM ItineraryStop WHERE id = ?").run(stopId);
  return new NextResponse(null, { status: 204 });
}
