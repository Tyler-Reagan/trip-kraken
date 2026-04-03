import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; stopId: string }> }
) {
  const { stopId } = await params;
  getDb().prepare("DELETE FROM ItineraryStop WHERE id = ?").run(stopId);
  return new NextResponse(null, { status: 204 });
}
