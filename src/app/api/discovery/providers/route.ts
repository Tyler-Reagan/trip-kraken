import { NextRequest, NextResponse } from "next/server";
import { listDiscoveryProviders, type DiscoveryMode } from "@/lib/discovery";

/**
 * The discovery registry, for building source toggles client-side (ADR-0009).
 * Optional `mode` filters to providers serving that mode; optional `lat`/`lng`
 * filters to providers that apply at the anchor (a regional provider gates by region).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("mode") as DiscoveryMode | null;
  const lat = searchParams.has("lat") ? parseFloat(searchParams.get("lat")!) : null;
  const lng = searchParams.has("lng") ? parseFloat(searchParams.get("lng")!) : null;
  const hasAnchor = lat !== null && lng !== null && !Number.isNaN(lat) && !Number.isNaN(lng);

  const providers = listDiscoveryProviders()
    .filter((p) => (mode ? p.modes.includes(mode) : true))
    .filter((p) => (hasAnchor ? p.applies({ kind: "anchor", lat: lat!, lng: lng! }) : true))
    .map((p) => ({ id: p.id, label: p.label }));

  return NextResponse.json(providers);
}
