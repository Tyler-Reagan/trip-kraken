import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; dayId: string }> }
) {
  const { dayId } = await params;
  const body = await req.json();
  const { label } = body;

  const day = await db.itineraryDay.update({
    where: { id: dayId },
    data: { label: label ?? null },
  });

  return NextResponse.json(day);
}
