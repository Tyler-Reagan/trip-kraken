import { NextRequest, NextResponse } from "next/server";
import { updateDayLabel } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; dayId: string }> }
) {
  const { dayId } = await params;
  const body = await req.json();
  const { label } = body;

  const day = updateDayLabel(dayId, label ?? null);
  return NextResponse.json(day);
}
