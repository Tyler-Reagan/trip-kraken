import type { PathEndpoint } from "@/types/path";

/** Generous enough for a month-long Trip with a full Day of stops, low enough that a malformed
 * client cannot ask for unbounded work. Shared by every path-geometry route. */
export const MAX_PAIRS = 600;

export interface PairRequest {
  from: PathEndpoint;
  to: PathEndpoint;
}

function parseEndpoint(value: unknown): PathEndpoint | null {
  if (!value || typeof value !== "object") return null;
  const { lat, lng, locationId } = value as {
    lat?: unknown;
    lng?: unknown;
    locationId?: unknown;
  };
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  // Kept (not stripped) so the pair's Location pin, if any, can be looked up (#223) — the client
  // already sends it, embedded on every chain-derived endpoint (`pathPairs.ts`'s `chainOfDay`).
  return typeof locationId === "string" ? { lat, lng, locationId } : { lat, lng };
}

export function parsePairs(value: unknown): PairRequest[] | null {
  if (!Array.isArray(value)) return null;
  const pairs: PairRequest[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null;
    const from = parseEndpoint((entry as { from?: unknown }).from);
    const to = parseEndpoint((entry as { to?: unknown }).to);
    if (!from || !to) return null;
    pairs.push({ from, to });
  }
  return pairs;
}
