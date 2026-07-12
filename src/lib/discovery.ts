/**
 * Discovery provider layer (ADR-0009). Discovery — finding candidate Locations —
 * sits behind a pluggable `DiscoveryProvider` interface so adding a source is a
 * contained implementation rather than a route rewrite. Each provider declares:
 *   - which modes it serves: anchored (near an existing Location) and/or
 *     unanchored (free-text, no anchor), and
 *   - where it applies: global providers always apply; regional ones gate by
 *     region (replacing the old incidental nearestPrefecture gating).
 * All providers return the common NearbyPlace shape.
 *
 * Enrichment stays single-provider Google-canonical (ADR-0009) and is NOT here —
 * this module is discovery only.
 */

import type { NearbyPlace } from "@/types";
import { searchNearby, searchText } from "./places";
import { haversineMeters } from "./travelCost";

export type DiscoveryMode = "anchored" | "unanchored";

export interface AnchoredQuery {
  lat: number;
  lng: number;
  radius?: number;
  keyword?: string;
  type?: string;
  limit?: number;
  openNow?: boolean;
}

export interface UnanchoredQuery {
  query: string;
  limit?: number;
}

export interface DiscoveryProvider {
  readonly id: string;
  readonly label: string;
  readonly modes: readonly DiscoveryMode[];
  /** Whether this provider serves the given anchor. Global providers always apply;
   *  regional ones gate by region. */
  appliesAt(lat: number, lng: number): boolean;
  searchAnchored?(q: AnchoredQuery): Promise<NearbyPlace[]>;
  searchUnanchored?(q: UnanchoredQuery): Promise<NearbyPlace[]>;
}

// ─── Google: global, both modes ──────────────────────────────────────────────
const googleProvider: DiscoveryProvider = {
  id: "google",
  label: "Google",
  modes: ["anchored", "unanchored"],
  appliesAt: () => true,
  async searchAnchored(q) {
    const places = await searchNearby(q.lat, q.lng, {
      radius: q.radius,
      keyword: q.keyword,
      type: q.type,
      limit: q.limit,
      openNow: q.openNow,
    });
    // searchNearby returns precise coords for every result, so anchor→place
    // distance is a pure in-process computation (no extra API calls).
    return places.map((p) =>
      p.lat !== null && p.lng !== null
        ? { ...p, distanceMeters: Math.round(haversineMeters({ lat: q.lat, lng: q.lng }, { lat: p.lat, lng: p.lng })) }
        : p
    );
  },
  async searchUnanchored(q) {
    return searchText(q.query, { limit: q.limit });
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
