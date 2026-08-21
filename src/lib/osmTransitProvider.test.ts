/**
 * OSM-Japan `PathProvider` tests (issue #85, Seam 1). Standalone (no test runner): run with
 * `tsx src/lib/osmTransitProvider.test.ts`. Exercises the provider purely through its public
 * `PathProvider` interface (`costMatrix`/`describeJourney`) against a small hand-built graph
 * fixture — no runtime network I/O, so the fixture is a graph, not an HTTP mock (unlike
 * googleRoutesProvider.test.ts, which mocks `global.fetch`).
 *
 * Fixture geography (all coordinates real Tokyo-area positions, distances/lines invented for the
 * test): a Shinkansen trunk (Tokyo <-> Nagoya, one long hop) crossed with a subway loop
 * (Yamanote-ish: Tokyo <-> Kanda <-> Akihabara) and a short Marunouchi-ish subway spur off Tokyo
 * (Tokyo <-> Otemachi), joined to the Yamanote-ish line only at Tokyo (an interchange cluster).
 * A standalone subway hop of the Shinkansen trunk's exact distance backs the line-type speed
 * comparison; a decoy stop node sits within Akihabara's snap radius but farther away, to prove
 * nearest-station selection actually discriminates. One far-flung point has no station in range
 * at all, to exercise the decline path (ADR-0024 §4 — no station in range is no longer a
 * fabricated straight-line walk, it's `null`; the registry's terminal `haversine` entry is what
 * fills it now).
 *
 * An outlying stop further up the loop, with a point ~1,200m from it, covers the two-radius split
 * (ADR-0019, amended 2026-08-17): near enough to be walkable, far enough that the dense-urban
 * radius alone would have declined it. The pair either side of that boundary is the point — the
 * decoy above proves the dense radius still refuses to over-reach, this proves the wider one
 * engages when it has to.
 */

import assert from "node:assert/strict";
import { createGraph, buildSpatialIndex, type TransitGraph } from "./transitGraph";
import { createOsmTransitProvider, snapStations, LINE_TYPE_SPEEDS_KMH, PREMIUM_BOARDING_MINUTES } from "./osmTransitProvider";
import { journeyCost, type PathKind } from "@/types/path";

// tsx compiles this file to CJS (no "type": "module" in package.json), which doesn't support
// top-level await — same wrapper as optimizer.test.ts, with an explicit exit-1 on failure.
main().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function main() {

function buildFixture(): TransitGraph {
  const graph = createGraph();

  // Commuter loop: Tokyo -> Kanda -> Akihabara (two consecutive hops, same line).
  graph.stopNodes.set("loop-tokyo", {
    id: "loop-tokyo", lineId: "loop", lineName: "Loop Line", lineType: "commuter",
    stationName: "Tokyo", lat: 35.6812, lng: 139.7671, sequence: 0,
  });
  graph.stopNodes.set("loop-kanda", {
    id: "loop-kanda", lineId: "loop", lineName: "Loop Line", lineType: "commuter",
    stationName: "Kanda", lat: 35.6918, lng: 139.7708, sequence: 1,
  });
  graph.stopNodes.set("loop-akihabara", {
    id: "loop-akihabara", lineId: "loop", lineName: "Loop Line", lineType: "commuter",
    stationName: "Akihabara", lat: 35.6984, lng: 139.7731, sequence: 2,
  });
  // Two traced hops (ADR-0030): each shape runs from its edge's `fromStopId` to its `toStopId`,
  // which is the only direction stored. A search crossing them the other way must reverse.
  graph.rideEdges.push({
    fromStopId: "loop-tokyo", toStopId: "loop-kanda", distanceMeters: 1200,
    geometry: { type: "LineString", coordinates: [[139.7671, 35.6812], [139.769, 35.687], [139.7708, 35.6918]] },
    tracedLengthMeters: 1260,
  });
  graph.rideEdges.push({
    fromStopId: "loop-kanda", toStopId: "loop-akihabara", distanceMeters: 1300,
    geometry: { type: "LineString", coordinates: [[139.7708, 35.6918], [139.7731, 35.6984]] },
    tracedLengthMeters: 1320,
  });

  // Subway spur: Tokyo -> Otemachi (one hop, different line, interchanges with the loop at Tokyo).
  graph.stopNodes.set("spur-tokyo", {
    id: "spur-tokyo", lineId: "spur", lineName: "Spur Subway", lineType: "subway",
    stationName: "Tokyo", lat: 35.6812, lng: 139.7671, sequence: 0,
  });
  graph.stopNodes.set("spur-otemachi", {
    id: "spur-otemachi", lineId: "spur", lineName: "Spur Subway", lineType: "subway",
    stationName: "Otemachi", lat: 35.687, lng: 139.7645, sequence: 1,
  });
  // Deliberately untraced — the refused case (ADR-0030 §1). A Journey crossing it must carry a
  // gap, not a substitute.
  graph.rideEdges.push({ fromStopId: "spur-tokyo", toStopId: "spur-otemachi", distanceMeters: 900 });

  // Interchange cluster at Tokyo Station, joining the loop and the spur.
  graph.clusters.set("cluster-tokyo", {
    id: "cluster-tokyo", name: "Tokyo", stopNodeIds: ["loop-tokyo", "spur-tokyo"],
  });
  graph.transferEdges.push({ fromStopId: "loop-tokyo", toStopId: "spur-tokyo", clusterId: "cluster-tokyo" });
  graph.transferEdges.push({ fromStopId: "spur-tokyo", toStopId: "loop-tokyo", clusterId: "cluster-tokyo" });

  // Shinkansen trunk: one long hop from Tokyo to a distant city stop, same real-world distance
  // class as a subway hop would need many stops for — used to compare effective speed, not to
  // interchange with the loop/spur (an isolated one-line network is enough for a speed check).
  graph.stopNodes.set("shinkansen-tokyo", {
    id: "shinkansen-tokyo", lineId: "shinkansen", lineName: "Tokaido Shinkansen", lineType: "shinkansen",
    stationName: "Tokyo (Shinkansen)", lat: 35.6812, lng: 139.7671, sequence: 0,
  });
  graph.stopNodes.set("shinkansen-nagoya", {
    id: "shinkansen-nagoya", lineId: "shinkansen", lineName: "Tokaido Shinkansen", lineType: "shinkansen",
    stationName: "Nagoya", lat: 35.1709, lng: 136.8815, sequence: 1,
  });
  graph.rideEdges.push({ fromStopId: "shinkansen-tokyo", toStopId: "shinkansen-nagoya", distanceMeters: 260_000 });

  // An isolated subway hop of the exact same distance as the Shinkansen trunk above — a clean
  // apples-to-apples duration comparison (same distance, different line type) with no derived rate.
  graph.stopNodes.set("compare-subway-a", {
    id: "compare-subway-a", lineId: "compare-subway", lineName: "Compare Subway", lineType: "subway",
    stationName: "Compare A", lat: 35.0, lng: 139.0, sequence: 0,
  });
  graph.stopNodes.set("compare-subway-b", {
    id: "compare-subway-b", lineId: "compare-subway", lineName: "Compare Subway", lineType: "subway",
    stationName: "Compare B", lat: 35.0, lng: 141.0, sequence: 1,
  });
  graph.rideEdges.push({ fromStopId: "compare-subway-a", toStopId: "compare-subway-b", distanceMeters: 260_000 });

  // A decoy stop node within Akihabara's snap radius but farther away than the real Akihabara
  // stop — proves station-snapping picks the nearest candidate, not just any candidate in range.
  graph.stopNodes.set("decoy-near-akihabara", {
    id: "decoy-near-akihabara", lineId: "decoy", lineName: "Decoy Line", lineType: "commuter",
    stationName: "Decoy", lat: 35.703, lng: 139.7731, sequence: 0,
  });

  // An outlying station further up the loop, backing the isolated-access case below: the real
  // shape is a resort Lodging sitting above its town, with its one station a long-but-walkable
  // way downhill and nothing at all inside the dense-urban radius (ADR-0019, amended 2026-08-17).
  graph.stopNodes.set("loop-outlying", {
    id: "loop-outlying", lineId: "loop", lineName: "Loop Line", lineType: "commuter",
    stationName: "Outlying", lat: 35.8, lng: 139.7731, sequence: 3,
  });
  graph.rideEdges.push({ fromStopId: "loop-akihabara", toStopId: "loop-outlying", distanceMeters: 11_000 });

  return graph;
}

const graph = buildFixture();
const spatialIndex = buildSpatialIndex(graph);
const provider = createOsmTransitProvider(graph, spatialIndex);

const P = (lat: number, lng: number) => ({ lat, lng });

// Points near each real station, but not exactly on it (a realistic "committed Location" a short
// walk from the platform) — exercises station-snapping, not just an exact-coordinate match.
const nearAkihabara = P(35.6983, 139.7733); // ~10m from loop-akihabara
const nearOtemachi = P(35.6869, 139.7644); // ~10m from spur-otemachi
const nearKanda = P(35.6917, 139.7707); // ~10m from loop-kanda
const nearNagoya = P(35.1708, 136.8816); // ~10m from shinkansen-nagoya
const nearTokyoForShinkansen = P(35.6813, 139.767); // ~10m from shinkansen-tokyo
const nearCompareA = P(35.0001, 139.0001); // ~10m from compare-subway-a
const nearCompareB = P(35.0001, 141.0001); // ~10m from compare-subway-b
const isolated = P(36.5, 140.5); // far from every stop node in the fixture
// ~1,200m due north of loop-outlying: outside STATION_SNAP_RADIUS_METERS (800), inside
// ISOLATED_ACCESS_RADIUS_METERS (2000). The SOKI ATAMI shape that motivated the amendment.
const aboveOutlyingStation = P(35.81078, 139.7731);

/** Every call in this file below expects a real routed answer, never a decline — this just
 * removes the null-check noise from each assertion while still failing loudly if one arrives. */
async function describe(from: { lat: number; lng: number }, to: { lat: number; lng: number }, kinds: PathKind[]) {
  const result = await provider.describeJourney(from, to, kinds);
  assert.ok(result, "expected a routed journey, got a decline");
  return result!;
}

// ── Multi-line journey: Akihabara -> Otemachi crosses the Tokyo interchange (loop -> spur).
//    Decomposed per shift (ADR-0032): access walk, the Loop Line ride, the transfer at Tokyo, the
//    Spur Subway ride, egress walk. ──
const multiLine = await describe(nearAkihabara, nearOtemachi, ["rail"]);
assert.deepEqual(
  multiLine.map((p) => p.kind),
  ["walking", "rail", "walking", "rail", "walking"],
  "a two-line Journey decomposes into access walk, ride, transfer, ride, egress walk"
);
assert.equal((multiLine[1] as { lineName: string }).lineName, "Loop Line", "each rail Path names one line, not a joined string");
assert.equal((multiLine[3] as { lineName: string }).lineName, "Spur Subway");

// The transfer is its own Path, named by the *cluster* — "change at Tokyo" is the fact a traveler
// acts on, not the two per-line station names either side of it (§3).
assert.equal(multiLine[2].from.stationName, "Tokyo", "the transfer's endpoints carry the station cluster's name");
assert.equal(multiLine[2].to.stationName, "Tokyo");
assert.equal(multiLine[2].travelCost.distanceMeters, 0, "a transfer has no modeled distance, only TRANSFER_MINUTES (§4)");
assert.equal(multiLine[2].travelCost.basisOfCost, "straightLine", "and says so — nothing routed it");

// A rail Path's own ends are nameable too, which is what #139's sidebar reads.
assert.equal(multiLine[1].from.stationName, "Akihabara", "a rail Path knows where it boarded");
assert.equal(multiLine[1].to.stationName, "Tokyo", "and where it alighted");
assert.equal(multiLine[1].travelCost.basisOfCost, "railNetwork", "a ride is graph traversal, not an estimate");

// Only the Journey's true ends carry a Location — every endpoint decomposition created is
// ephemeral (ADR-0022), so nothing here can become a Trip's derived arrival or departure.
assert.equal(multiLine[1].from.locationId, undefined, "an interchange endpoint carries no locationId");

// §5: the decomposed chain sums back to what the search itself arrived at. This is the invariant
// that makes decomposition a regrouping rather than a recalculation — if it drifts, some Path is
// pricing its own steps differently from the Dijkstra relaxation that chose them.
const summed = journeyCost(multiLine)!;
const matrixCell = (await provider.costMatrix([nearAkihabara, nearOtemachi], ["rail"]))[0][1]!;
assert.ok(
  Math.abs(summed.durationSeconds - matrixCell.durationSeconds) < 1e-6,
  "the decomposed Paths' durations sum to the Journey's own total"
);
assert.ok(
  Math.abs(summed.distanceMeters - matrixCell.distanceMeters) < 1e-6,
  "and so do their distances"
);
assert.equal(summed.basisOfCost, "railNetwork", "the summed Journey reports the basis of its dominant Path, not its weakest");

// ── Single-ride journey: Akihabara -> Kanda stays on one line ──
const singleRide = await describe(nearAkihabara, nearKanda, ["rail"]);
const singleRideRail = singleRide.find((p) => p.kind === "rail")!;
assert.equal((singleRideRail as { lineName: string }).lineName, "Loop Line", "single-line journey reports just that line");
assert.equal(
  singleRide.filter((p) => p.kind === "rail").length,
  1,
  "one line ridden is one rail Path, however many stations it passes"
);

// ── A Journey that never rides anything is a walking Path, not an UnknownPath (§7) ──
// Both points snap to loop-akihabara and nothing else is closer, so the search seeds and finishes
// at the same stop node without crossing a single ride edge.
const walkOnly = await describe(P(35.6983, 139.7733), P(35.6985, 139.773), ["rail"]);
assert.deepEqual(walkOnly.map((p) => p.kind), ["walking"], "a rideless Journey is one walking Path");
assert.equal(walkOnly[0].from.locationId, undefined);
assert.equal(walkOnly[0].geometry, undefined, "with no shape — nothing routed it");

// ── Shinkansen vs. subway: an equal-distance hop is faster on the Shinkansen ──
// Both hops are exactly 260km (compare-subway-a/b's ride edge matches the Shinkansen trunk's
// distance exactly), so this isolates line-type speed from trip length directly, with no derived
// rate: same distance, different effective speed.
const shinkansenJourney = await describe(nearTokyoForShinkansen, nearNagoya, ["rail"]);
const equalDistanceSubwayJourney = await describe(nearCompareA, nearCompareB, ["rail"]);
assert.ok(
  journeyCost(shinkansenJourney)!.durationSeconds < journeyCost(equalDistanceSubwayJourney)!.durationSeconds,
  "a Shinkansen hop is faster than an equal-distance subway hop"
);

// ── Premium boarding charge (ADR-0033) ──────────────────────────────────────────────────
//
// Boarding a Shinkansen costs flat minutes on top of the ride, charged once. 260 km at 220 km/h is
// ~71 min of riding; the Path must report that plus the charge, and nothing per-hop on top.
const shinkansenRail = shinkansenJourney.find((p) => p.kind === "rail")!;
const ridingMinutes = 260 / LINE_TYPE_SPEEDS_KMH.shinkansen * 60;
assert.ok(
  Math.abs(shinkansenRail.travelCost.durationSeconds / 60 - (ridingMinutes + PREMIUM_BOARDING_MINUTES.shinkansen)) < 1e-6,
  "a rail Path carries its ride time plus one boarding charge for the service it boarded"
);

// The charge is levied once per boarding, not per station: the two-hop Loop Line ride pays nothing
// (commuter), and a premium ride of many hops would still pay a single charge.
const commuterRail = multiLine[1];
assert.equal(PREMIUM_BOARDING_MINUTES.commuter, 0, "an ordinary commuter line carries no boarding charge");
assert.ok(
  Math.abs(commuterRail.travelCost.durationSeconds / 60 - 2500 / 1000 / LINE_TYPE_SPEEDS_KMH.commuter * 60) < 1e-6,
  "so a commuter Path's duration is exactly its ride time"
);

// And it must reach the matrix identically, since the optimizer plans against the same search
// (ADR-0033 §6) — a charge that changed only the described Journey would let the optimizer keep
// building Plans around free Shinkansen hops.
const shinkansenMatrix = await provider.costMatrix([nearTokyoForShinkansen, nearNagoya], ["rail"]);
assert.ok(
  Math.abs(shinkansenMatrix[0][1]!.durationSeconds - journeyCost(shinkansenJourney)!.durationSeconds) < 1e-6,
  "the boarding charge reaches costMatrix, not just describeJourney"
);

// ── Station-snapping picks the nearest station, not just any station in range ──
// decoy-near-akihabara is also within the snap radius (~520m) but farther than the real Akihabara
// stop (~20m), so this actually discriminates nearest-vs-farther rather than finding one candidate.
const nearestStops = snapStations(spatialIndex, nearAkihabara);
assert.ok(nearestStops.some((s) => s.id === "decoy-near-akihabara"), "the farther decoy is in range too");
assert.equal(nearestStops[0]?.id, "loop-akihabara", "the nearest stop in range is Akihabara, not the farther decoy");

// ── ...and a point that snaps inside the dense radius never reaches for the wider one ──
// loop-tokyo sits ~1.9km from nearAkihabara: outside STATION_SNAP_RADIUS_METERS but inside
// ISOLATED_ACCESS_RADIUS_METERS, so its absence here is what proves the second reach stayed
// dormant. Without this the two radii would silently collapse into one wide one, which is the
// exact outcome the amendment measured and rejected.
assert.ok(
  !nearestStops.some((s) => s.id === "loop-tokyo"),
  "a point with stations inside the dense radius does not pull in ones beyond it"
);

// ── Nothing inside the dense radius: reaches once more rather than declining (ADR-0019, amended
//    2026-08-17). Before this, such a point declined and the cell fell through to a road provider,
//    which answers an inter-city pair as a hundreds-of-kilometre walk. ──
const outlyingSnaps = snapStations(spatialIndex, aboveOutlyingStation);
assert.equal(outlyingSnaps[0]?.id, "loop-outlying", "the one walkable station beyond the dense radius is found");

const outlyingJourney = await describe(aboveOutlyingStation, nearAkihabara, ["rail"]);
assert.ok(outlyingJourney.some((p) => p.kind === "rail"), "an isolated-access journey still rides rail");
// 1,200m at WALK_SPEED_KMH is ~16 minutes, so the access walk cannot have been treated as free:
// the ride alone would come in under this. Decomposition now makes that walk its own Path, so the
// claim is checkable directly rather than only through the total.
assert.ok(
  journeyCost(outlyingJourney)!.durationSeconds > 900,
  "the access walk to the outlying station is priced into the journey, not ignored"
);
assert.equal(outlyingJourney[0].kind, "walking", "and it leads the chain as its own Path");
assert.ok(
  outlyingJourney[0].travelCost.distanceMeters > 1000,
  "carrying the real walk distance, not a token one"
);

// ── No station in either radius: declines (ADR-0024 §4) rather than fabricating a straight-line
//    walk — the registry's terminal haversine entry is what fills this cell now, not this provider ──
const noStationJourney = await provider.describeJourney(isolated, nearAkihabara, ["rail"]);
assert.equal(noStationJourney, null, "no station within either radius declines the whole journey");

// ── costMatrix backs the same provider surface in bulk, consistent with describeJourney ──
const matrix = await provider.costMatrix([nearAkihabara, nearOtemachi, isolated], ["rail"]);
assert.equal(matrix.length, 3, "one row per point");
assert.equal(
  matrix[0][1]?.durationSeconds,
  summed.durationSeconds,
  "costMatrix agrees with describeJourney's summed chain for the same pair"
);
assert.equal(matrix[0][2], null, "an isolated point declines rather than getting a fabricated walking estimate");
assert.equal(matrix[0][0], null, "a point costed against itself also declines — the terminal entry gives the same zero for free");

// ── Rail Path geometry (ADR-0030 §8, §9) ────────────────────────────────────────────────

// nearAkihabara -> nearKanda rides the Kanda->Akihabara edge *backwards*. The stored shape runs
// the other way, so the span must come back reversed — and the stored shape must not be mutated.
const storedKandaHop = graph.rideEdges.find((e) => e.fromStopId === "loop-kanda")!.geometry!;
const storedBefore = JSON.stringify(storedKandaHop.coordinates);

assert.deepEqual(
  singleRideRail.geometry,
  [{ type: "LineString", coordinates: [[139.7731, 35.6984], [139.7708, 35.6918]] }],
  "a ride crossed against the stored direction returns a reversed span"
);
assert.equal(JSON.stringify(storedKandaHop.coordinates), storedBefore, "and the stored shape is untouched");

// The same edge ridden the other way returns the stored orientation, unreversed.
const forwardRide = await describe(nearKanda, nearAkihabara, ["rail"]);
assert.deepEqual(
  forwardRide.find((p) => p.kind === "rail")!.geometry,
  [{ type: "LineString", coordinates: [[139.7708, 35.6918], [139.7731, 35.6984]] }],
  "and the same edge ridden forward is not reversed"
);

// Akihabara -> Otemachi rides two traced loop hops, transfers at Tokyo, then rides one untraced
// spur hop. Decomposition puts the two real spans on the Loop Line Path and leaves the Spur Subway
// Path with none (§9) — no invented line bridges the gap, and the whole Journey still carries
// exactly the two spans it did before it was split.
assert.deepEqual(
  multiLine.flatMap((p) => p.geometry ?? []).map((s) => s.coordinates),
  [
    [[139.7731, 35.6984], [139.7708, 35.6918]],
    [[139.7708, 35.6918], [139.769, 35.687], [139.7671, 35.6812]],
  ],
  "one span per traced ride edge, in travel order, each oriented to the direction ridden — and none for the refused one"
);
assert.equal(multiLine[1].geometry?.length, 2, "both traced spans belong to the line that was actually ridden over them");
assert.equal(multiLine[3].geometry, undefined, "the untraced ride carries no shape at all, not an empty list");

// A Journey whose only ride is untraced carries no geometry anywhere — absent, never an empty
// list, so the map's "is there a real shape" test reads the same as it did before rail had shapes.
const spurOnly = await describe(P(35.6813, 139.7672), nearOtemachi, ["rail"]);
assert.ok(spurOnly.every((p) => p.geometry === undefined), "an entirely untraced Journey carries no geometry");

// §11: the matrix skips step accumulation. Its costs must be identical to the described Journey's,
// or the flag changed the answer rather than only the work.
const geometryMatrix = await provider.costMatrix([nearAkihabara, nearOtemachi], ["rail"]);
assert.equal(
  geometryMatrix[0][1]!.durationSeconds,
  summed.durationSeconds,
  "skipping step accumulation leaves the matrix cost unchanged"
);
assert.equal(geometryMatrix[0][1]!.distanceMeters, summed.distanceMeters);

console.log("✓ osmTransitProvider.test.ts passed");
}
