/**
 * Metro clustering tests (#116): a pure geo-clustering function, no DB. Standalone (no test
 * runner): run with `tsx src/lib/metroCluster.test.ts`.
 */

import assert from "node:assert/strict";
import { clusterByMetro, METRO_CLUSTER_RADIUS_METERS } from "@/lib/metroCluster";
import type { Activity, Lodging } from "@/types";

let seq = 0;
function activity(lat: number | null, lng: number | null): Activity {
  seq++;
  return {
    id: `act-${seq}`,
    tripId: "trip-1",
    name: `Activity ${seq}`,
    address: null,
    lat,
    lng,
    placeId: null,
    excluded: false,
    note: null,
    rating: null,
    reviewCount: null,
    categories: null,
    visitDuration: null,
    openTime: null,
    closeTime: null,
    hoursJson: null,
    phone: null,
    enrichmentStatus: "done",
    kind: "activity",
  };
}

function lodging(lat: number | null, lng: number | null): Lodging {
  seq++;
  return {
    ...activity(lat, lng),
    id: `lodging-${seq}`,
    kind: "lodging",
    checkInDate: "2026-07-01",
    checkOutDate: "2026-07-05",
  };
}

// Real coordinates, ~400km apart (the "Shopping & Coffee" import: 19 Osaka + 6 Tokyo stops).
const OSAKA = { lat: 34.6937, lng: 135.5023 };
const TOKYO = { lat: 35.6762, lng: 139.6503 };

function scattered(center: { lat: number; lng: number }, count: number): Activity[] {
  // Small jitter (~0-2km) — well inside one metro, never enough to bridge the Osaka/Tokyo gap.
  return Array.from({ length: count }, (_, i) =>
    activity(center.lat + (i % 5) * 0.005, center.lng + (i % 3) * 0.005)
  );
}

// ── Two distant metros split into two clusters ──────────────────────────────

{
  const osakaStops = scattered(OSAKA, 19);
  const tokyoStops = scattered(TOKYO, 6);
  const clusters = clusterByMetro([...osakaStops, ...tokyoStops], []);

  assert.equal(clusters.length, 2, "Osaka + Tokyo stops split into two metro clusters");
  const sizes = clusters.map((c) => c.activities.length).sort((a, b) => a - b);
  assert.deepEqual(sizes, [6, 19], "cluster sizes match the 19 Osaka / 6 Tokyo split");
}

// ── A single metro's spread stays one cluster (no false positives) ──────────

{
  const clusters = clusterByMetro(scattered(OSAKA, 10), []);
  assert.equal(clusters.length, 1, "intra-city spread doesn't fragment into multiple clusters");
}

// ── A cluster matches a lodging within the metro radius ─────────────────────

{
  const osakaLodging = lodging(OSAKA.lat + 0.01, OSAKA.lng + 0.01);
  const tokyoLodging = lodging(TOKYO.lat, TOKYO.lng);
  const clusters = clusterByMetro([...scattered(OSAKA, 3), ...scattered(TOKYO, 2)], [osakaLodging, tokyoLodging]);

  assert.equal(clusters.length, 2);
  for (const c of clusters) {
    assert.equal(c.lodgings.length, 1, "every cluster here has exactly one covering lodging");
  }
  const osakaCluster = clusters.find((c) => c.activities[0].lat! < 35)!;
  assert.equal(osakaCluster.lodgings[0].id, osakaLodging.id, "cluster matched to the lodging in its own metro");
}

// ── Multiple lodgings covering the same metro all match (union, not "the" lodging) ──

{
  const hotelA = lodging(OSAKA.lat, OSAKA.lng);
  const hotelB = lodging(OSAKA.lat + 0.02, OSAKA.lng + 0.02); // a mid-stay hotel change, same metro
  const clusters = clusterByMetro(scattered(OSAKA, 5), [hotelA, hotelB]);

  assert.equal(clusters.length, 1);
  assert.deepEqual(
    clusters[0].lodgings.map((l) => l.id).sort(),
    [hotelA.id, hotelB.id].sort(),
    "both lodgings in the same metro match, not just the nearest one"
  );
}

// ── No covering lodging → empty, not a false match to a distant one ────────

{
  const farLodging = lodging(TOKYO.lat, TOKYO.lng);
  const clusters = clusterByMetro(scattered(OSAKA, 4), [farLodging]);

  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0].lodgings, [], "a lodging outside the metro radius is not a match");
}

// ── Activities without real coordinates are excluded, not clustered as (0,0) ─

{
  const clusters = clusterByMetro([...scattered(OSAKA, 2), activity(0, 0), activity(null, null)], []);
  assert.equal(clusters.length, 1, "ungeocoded activities drop out rather than forming a phantom cluster");
  assert.equal(clusters[0].activities.length, 2);
}

console.log(`metroCluster.test.ts passed (radius ${METRO_CLUSTER_RADIUS_METERS}m)`);
