import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// PATCH — toggle exclusion, update note, or rename a location
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; locationId: string }> }
) {
  const { locationId } = await params;
  const body = await req.json();
  const { excluded, note, name } = body;

  const location = await db.location.update({
    where: { id: locationId },
    data: {
      ...(excluded !== undefined && { excluded: Boolean(excluded) }),
      ...(note !== undefined && { note }),
      ...(name !== undefined && { name }),
    },
  });

  return NextResponse.json(location);
}

// DELETE — remove a location and its associated stops
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; locationId: string }> }
) {
  const { locationId } = await params;
  await db.location.delete({ where: { id: locationId } });
  return new NextResponse(null, { status: 204 });
}
