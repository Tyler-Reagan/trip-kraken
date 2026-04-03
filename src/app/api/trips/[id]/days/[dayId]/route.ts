import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; dayId: string }> }
) {
  const { dayId } = await params;
  const body = await req.json();
  const { label } = body;

  db.prepare("UPDATE ItineraryDay SET label = ? WHERE id = ?").run(label ?? null, dayId);

  const day = db.prepare("SELECT * FROM ItineraryDay WHERE id = ?").get(dayId);
  return NextResponse.json(day);
}
