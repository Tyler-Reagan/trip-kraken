/**
 * Discovery provider layer (ADR-0009; contract locked in #102). Discovery —
 * finding candidate Locations — sits behind a pluggable `DiscoveryProvider`
 * interface so adding a source is a contained implementation rather than a
 * route rewrite. The contract is one `search` over a query whose spatial scope
 * varies (anchor / none / route); `modes` declares which scope kinds a provider
 * serves, and `applies` gates regional providers. All providers return the
 * common NearbyPlace shape; the contract promises candidates, not relevance —
 * ranking is deliberately caller-side (`scoreAndSort`).
 *
 * Enrichment stays single-provider Google-canonical (ADR-0009) and is NOT here —
 * this module is discovery only.
 */

import type { NearbyPlace } from "@/types";
import { searchAlongRoute, searchNearby, searchText } from "./places";
import { haversineMeters } from "./geo";
import type { Point } from "./geo";

export type DiscoveryMode = "anchored" | "unanchored" | "alongRoute";

export type DiscoveryScope =
  | { kind: "anchor"; lat: number; lng: number; radius?: number }
  | { kind: "none" }
  // encoded polyline + origin; caller computes both once per Path (ADR-0009). `origin` is what
  // lets a provider request a per-result distance-from-origin (#107) — the same "caller-computed
  // routing fact" status as the polyline, not Google-specific.
  | { kind: "route"; polyline: string; origin: Point };

export interface DiscoveryQuery {
  /** Free text. Required for "none"/"route" scopes (validated at the routes);
   *  optional for "anchor" (typeless nearby browse). */
  query?: string;
  scope: DiscoveryScope;
  limit?: number;
  openNow?: boolean;
}

export interface DiscoveryProvider {
  readonly id: string;
  readonly label: string;
  /** Capability declaration: which scope kinds this provider serves. */
  readonly modes: readonly DiscoveryMode[];
  /** Whether this provider serves the given scope. Global providers always
   *  apply; regional ones gate by region. */
  applies(scope: DiscoveryScope): boolean;
  search(q: DiscoveryQuery): Promise<NearbyPlace[]>;
}

/** The mode a scope exercises — for gating a query against `provider.modes`. */
export function modeForScope(scope: DiscoveryScope): DiscoveryMode {
  switch (scope.kind) {
    case "anchor":
      return "anchored";
    case "none":
      return "unanchored";
    case "route":
      return "alongRoute";
  }
}

// ─── Google: global; serves all three scopes ──────────────────────────────────
const googleProvider: DiscoveryProvider = {
  id: "google",
  label: "Google",
  modes: ["anchored", "unanchored", "alongRoute"],
  applies: () => true,
  async search(q) {
    const { scope } = q;
    switch (scope.kind) {
      case "anchor": {
        const places = await searchNearby(scope.lat, scope.lng, {
          radius: scope.radius,
          keyword: q.query,
          limit: q.limit,
          openNow: q.openNow,
        });
        // Precise coords come back for every result, so anchor→place distance
        // is a pure in-process computation (no extra API calls).
        return places.map((p) =>
          p.lat !== null && p.lng !== null
            ? {
                ...p,
                distanceMeters: Math.round(
                  haversineMeters(
                    { lat: scope.lat, lng: scope.lng },
                    { lat: p.lat, lng: p.lng },
                  ),
                ),
              }
            : p,
        );
      }
      case "none":
        if (!q.query)
          throw new Error("query is required for unanchored discovery");
        return searchText(q.query, { limit: q.limit, openNow: q.openNow });
      case "route":
        if (!q.query)
          throw new Error("query is required for along-route discovery");
        return searchAlongRoute(q.query, scope.polyline, scope.origin, {
          limit: q.limit,
          openNow: q.openNow,
        });
    }
  },
};

// Japan bounding box. Not used by any discovery provider today, but exported for
// the OSM-Japan transit-cost provider registry (travelCostRegistry.ts, ADR-0019),
// which gates on the same region and shares this check rather than duplicating the box.
export function inJapan(lat: number, lng: number): boolean {
  return lat >= 24 && lat <= 46 && lng >= 122 && lng <= 146;
}

const PROVIDERS: readonly DiscoveryProvider[] = [googleProvider];

export function getDiscoveryProvider(
  id: string,
): DiscoveryProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function listDiscoveryProviders(): readonly DiscoveryProvider[] {
  return PROVIDERS;
}

/**
 * Rank discovery results: rating quality + review depth, plus an optional
 * category-diversity bonus (anchored search uses it to favour variety on a day;
 * pass an empty set for no bonus). Shared by both discovery routes.
 *
 * #107: when results carry `detourMeters` (along-route scope only — always null elsewhere, so
 * this branch never fires for anchor/unanchored search), a flat rating sort clusters the top
 * results at the corridor's origin, because Google's own along-route results already skew there
 * for dense categories. Splitting the batch's own detourMeters range into thirds (not
 * equal-*count* buckets — a real corridor is exactly this skewed, with most results clustered
 * near the origin, so count-based buckets would still lump the far outliers in with the tail of
 * that cluster) and round-robin merging the rating-sorted buckets spreads the top results across
 * the corridor by construction.
 */
export function scoreAndSort(
  places: NearbyPlace[],
  dayCategories: Set<string> = new Set(),
): NearbyPlace[] {
  function score(p: NearbyPlace): number {
    const ratingScore = p.rating !== null ? (p.rating / 5) * 60 : 0;
    const reviewBonus =
      p.reviewCount !== null ? Math.min(p.reviewCount / 1000, 1) * 20 : 0;
    const diversityBonus =
      dayCategories.size > 0 && p.categories.some((c) => !dayCategories.has(c))
        ? 20
        : 0;
    return ratingScore + reviewBonus + diversityBonus;
  }
  const byScore = (list: NearbyPlace[]) =>
    [...list].sort((a, b) => score(b) - score(a));

  const withDetour = places.filter((p) => p.detourMeters !== null);
  if (withDetour.length === 0) return byScore(places);

  const withoutDetour = places.filter((p) => p.detourMeters === null);
  const min = Math.min(...withDetour.map((p) => p.detourMeters!));
  const max = Math.max(...withDetour.map((p) => p.detourMeters!));
  const span = max - min;
  const bucketOf = (d: number) =>
    span === 0 ? 0 : Math.min(2, Math.floor(((d - min) / span) * 3));
  const raw: NearbyPlace[][] = [[], [], []];
  for (const p of withDetour) raw[bucketOf(p.detourMeters!)].push(p);
  const buckets = raw.map(byScore).filter((b) => b.length > 0);

  const merged: NearbyPlace[] = [];
  for (let i = 0; i < withDetour.length; i++) {
    for (const bucket of buckets) if (bucket[i]) merged.push(bucket[i]);
  }
  return [...merged, ...byScore(withoutDetour)];
}
