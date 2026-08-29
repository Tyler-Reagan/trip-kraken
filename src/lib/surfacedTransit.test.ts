/**
 * surfacedTransit tests (ADR-0035). Standalone: run with `tsx src/lib/surfacedTransit.test.ts`.
 */

import assert from "node:assert/strict";
import { surfacedTransitOf } from "./surfacedTransit";
import { makeTravelCost } from "@/types/path";
import type { Path, PathEndpoint, WalkingPath, RailPath } from "@/types/path";

const TRIP_ID = "trip-1";

const point = (
  lat: number,
  lng: number,
  stationName?: string,
  locationId?: string,
): PathEndpoint => ({
  lat,
  lng,
  ...(stationName !== undefined ? { stationName } : {}),
  ...(locationId !== undefined ? { locationId } : {}),
});

const walk = (from: PathEndpoint, to: PathEndpoint): WalkingPath => ({
  kind: "walking",
  from,
  to,
  travelCost: makeTravelCost(100, 60, "straightLine", "osm-japan"),
});

const rail = (
  from: PathEndpoint,
  to: PathEndpoint,
  lineName = "Test Line",
): RailPath => ({
  kind: "rail",
  from,
  to,
  lineName,
  travelCost: makeTravelCost(1000, 120, "railNetwork", "osm-japan"),
});

// ── No ride at all: a plain walk, no station anywhere ──────────────────────────────────────────
{
  const hotel = point(35.0, 139.0, undefined, "hotel");
  const activity = point(35.1, 139.1, undefined, "activity");
  const chain: Path[] = [walk(hotel, activity)];

  const surfaced = surfacedTransitOf(chain, TRIP_ID);
  assert.equal(
    surfaced.length,
    0,
    "a walk-only Journey with no station surfaces nothing",
  );
}

// ── One rail leg, no transfer: boarding and alighting stations both surface ───────────────────
{
  const hotel = point(35.0, 139.0, undefined, "hotel");
  const shibuya = point(35.1, 139.1, "Shibuya");
  const yoyogi = point(35.2, 139.2, "Yoyogi");
  const meijiJingu = point(35.3, 139.3, undefined, "meiji-jingu");
  const chain: Path[] = [
    walk(hotel, shibuya),
    rail(shibuya, yoyogi),
    walk(yoyogi, meijiJingu),
  ];

  const surfaced = surfacedTransitOf(chain, TRIP_ID);
  const names = surfaced.map((t) => t.name).sort();
  assert.deepEqual(
    names,
    ["Shibuya", "Yoyogi"],
    "boarding and alighting stations surface, journey ends do not",
  );
  for (const t of surfaced) {
    assert.equal(t.kind, "transit", "surfaced entries are kind: transit");
    assert.equal(t.authored, false, "surfaced entries are never authored");
    assert.equal(t.tripId, TRIP_ID);
    assert.equal(
      t.enrichmentStatus,
      "done",
      "sentinel enrichment status — never actually enriched",
    );
    assert.equal(t.arriveAt, null);
    assert.equal(
      t.placeId,
      null,
      "no place metadata for a station never searched",
    );
  }
}

// ── A single rail leg with NO walk legs: the journey's own ends must not leak, even though ────
// ── both carry a stationName (e.g. the traveler's own Location is itself a major station). ────
{
  const tokyo = point(35.0, 139.0, "Tokyo");
  const shinOsaka = point(34.0, 135.0, "Shin-Osaka");
  const chain: Path[] = [rail(tokyo, shinOsaka, "Shinkansen")];

  const surfaced = surfacedTransitOf(chain, TRIP_ID);
  assert.equal(
    surfaced.length,
    0,
    "a single-Path chain's own from/to are the journey's ends, excluded by position",
  );
}

// ── A transfer with a real walk between two different platforms: the transfer's own cluster ───
// ── name wins over each adjacent rail leg's individual per-line name, on BOTH sides. ───────────
{
  const tokyo = point(35.0, 139.0, "Tokyo");
  // Same coordinate, two names: the rail leg's own (individual) vs the transfer walk's (cluster).
  const akihabaraIndividual = point(35.1, 139.1, "Akihabara");
  const akihabaraCluster = point(35.1, 139.1, "Akihabara Iwamotocho");
  const iwamotochoCluster = point(35.15, 139.15, "Akihabara Iwamotocho");
  const iwamotochoIndividual = point(35.15, 139.15, "Iwamotocho");
  const asakusa = point(35.2, 139.2, "Asakusa");
  const destination = point(35.3, 139.3, undefined, "destination");

  const chain: Path[] = [
    walk(tokyo, tokyo), // dropped in real code when zero-length; included here as a no-op access leg
    rail(tokyo, akihabaraIndividual, "Line A"),
    walk(akihabaraCluster, iwamotochoCluster), // transferPathOf's own shape: both ends cluster-named
    rail(iwamotochoIndividual, asakusa, "Line B"),
    walk(asakusa, destination),
  ].filter((p) => p.from.lat !== p.to.lat || p.from.lng !== p.to.lng); // walkPathOf drops zero-length

  const surfaced = surfacedTransitOf(chain, TRIP_ID);
  const byCoord = new Map(surfaced.map((t) => [`${t.lat},${t.lng}`, t.name]));
  assert.equal(
    surfaced.length,
    3,
    "Akihabara-side, Iwamotocho-side, and Asakusa all surface",
  );
  assert.equal(
    byCoord.get("35.1,139.1"),
    "Akihabara Iwamotocho",
    "cluster name wins on the boarding side of the transfer",
  );
  assert.equal(
    byCoord.get("35.15,139.15"),
    "Akihabara Iwamotocho",
    "cluster name wins on the alighting side of the transfer",
  );
  assert.equal(byCoord.get("35.2,139.2"), "Asakusa");
}

// ── A same-platform (zero-distance) transfer: one physical point, two Paths naming it ─────────
// ── differently — must collapse to exactly one surfaced entry, cluster name winning. ──────────
{
  const shinjuku = point(35.0, 139.0, "Shinjuku");
  const yoyogiIndividual = point(35.1, 139.1, "Yoyogi");
  const yoyogiCluster = point(35.1, 139.1, "Yoyogi (transfer)");
  const akihabara = point(35.2, 139.2, "Akihabara");

  // transferPathOf always emits a Path even at zero distance (TRANSFER_MINUTES, not a null walk),
  // unlike an access/egress walk — so both ends land in the chain here, coordinates identical.
  const chain: Path[] = [
    rail(shinjuku, yoyogiIndividual, "Line A"),
    walk(yoyogiCluster, yoyogiCluster),
    rail(yoyogiIndividual, akihabara, "Line B"),
  ];

  const surfaced = surfacedTransitOf(chain, TRIP_ID);
  assert.equal(
    surfaced.length,
    1,
    "one physical point surfaces once, not twice, despite two names",
  );
  assert.equal(
    surfaced[0].name,
    "Yoyogi (transfer)",
    "the transfer walk's cluster name wins the collision",
  );
  assert.equal(
    surfaced[0].id,
    surfaced[0].id,
    "id is present and deterministic",
  );
}

// ── Two Journeys through the same physical station produce the same id ────────────────────────
{
  const a = point(35.0, 139.0, undefined, "a");
  const shibuya = point(35.5, 139.5, "Shibuya");
  const b = point(35.9, 139.9, undefined, "b");

  const first = surfacedTransitOf(
    [walk(a, shibuya), walk(shibuya, b)],
    TRIP_ID,
  );
  const second = surfacedTransitOf(
    [walk(a, shibuya), rail(shibuya, b)],
    TRIP_ID,
  );
  assert.equal(
    first[0].id,
    second[0].id,
    "the same coordinate always produces the same id",
  );
}

console.log("✓ surfacedTransit.test.ts passed");
