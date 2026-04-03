import { NextResponse } from "next/server";
import { listTrips } from "@/lib/db";

export async function GET() {
  return NextResponse.json(listTrips());
}
