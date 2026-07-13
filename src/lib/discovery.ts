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
import { searchNearby, searchText } from "./places";
import { haversineMeters } from "./travelCost";

export type DiscoveryMode = "anchored" | "unanchored" | "alongRoute";

export type DiscoveryScope =
  | { kind: "anchor"; lat: number; lng: number; radius?: number }
  | { kind: "none" }
  | { kind: "route"; polyline: string }; // encoded polyline; caller computes it once per leg

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
    case "anchor": return "anchored";
    case "none":   return "unanchored";
    case "route":  return "alongRoute";
  }
}

// ─── Google: global; anchor + none (alongRoute lands with route support) ─────
const googleProvider: DiscoveryProvider = {
  id: "google",
  label: "Google",
  modes: ["anchored", "unanchored"],
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
            ? { ...p, distanceMeters: Math.round(haversineMeters({ lat: scope.lat, lng: scope.lng }, { lat: p.lat, lng: p.lng })) }
            : p
        );
      }
      case "none":
        if (!q.query) throw new Error("query is required for unanchored discovery");
        return searchText(q.query, { limit: q.limit, openNow: q.openNow });
      case "route":
        throw new Error("google does not serve route scope yet");
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

export function getDiscoveryProvider(id: string): DiscoveryProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function listDiscoveryProviders(): readonly DiscoveryProvider[] {
  return PROVIDERS;
}

/**
 * Rank discovery results: rating quality + review depth, plus an optional
 * category-diversity bonus (anchored search uses it to favour variety on a day;
 * pass an empty set for no bonus). Shared by both discovery routes.
 */
export function scoreAndSort(
  places: NearbyPlace[],
  dayCategories: Set<string> = new Set()
): NearbyPlace[] {
  function score(p: NearbyPlace): number {
    const ratingScore = p.rating !== null ? (p.rating / 5) * 60 : 0;
    const reviewBonus = p.reviewCount !== null ? Math.min(p.reviewCount / 1000, 1) * 20 : 0;
    const diversityBonus =
      dayCategories.size > 0 && p.categories.some((c) => !dayCategories.has(c)) ? 20 : 0;
    return ratingScore + reviewBonus + diversityBonus;
  }
  return places
    .map((p) => ({ p, s: score(p) }))
    .sort((a, b) => b.s - a.s)
    .map(({ p }) => p);
}
