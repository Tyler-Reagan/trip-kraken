import { NextRequest, NextResponse } from "next/server";
import { setDayLabel } from "@/lib/db";

/**
 * Set or clear a day's label (ADR-0015). Days are a derived clustering, not an entity, so a day is
 * addressed by its date, not an id. Body: { date: "YYYY-MM-DD", label: string | null }.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tripId } = await params;
  const body = await req.json();
  const { date, label } = body;

  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date (YYYY-MM-DD) is required" }, { status: 400 });
  }

  const trip = setDayLabel(tripId, date, typeof label === "string" ? label : null);
  return NextResponse.json(trip);
}
