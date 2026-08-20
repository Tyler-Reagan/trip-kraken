/**
 * Tracing a rail line's real track, per ride edge (ADR-0030 §1–§3). Pure: OSM elements in, one
 * traced segment (or a refusal) per ride edge out. No I/O, no `osmium`, no SQLite.
 *
 * This is a third job alongside the two `transitGraphIngest.ts` already owns, and it is the one
 * with real failure modes, so it lives in its own module. No osmium subcommand assembles a route
 * relation into an ordered line (research §C8), so assembly, gap detection, loop handling,
 * snapping and per-stop cutting are all ours. What that code is up against was measured, not
 * guessed: a naive assembler gets 95.6% of the shipped graph's 20,281 ride edges a shape, but only
 * 82.2% cleanly, and twelve relations — 山手線 and 大阪環状線 among them — assemble into closed
 * loops that a naive cut traces the long way round.
 *
 * **What refusal means here.** A `null` segment stores no shape, the map draws that stretch dashed
 * (ADR-0029 §3), and the traveler sees that we do not know. That is the whole design: presence of
 * geometry means *we trust this shape*. Nothing in this module ever invents a line to fill a gap.
 */

import { haversineMeters, type Point } from "@/lib/geo";
import { STATION_SNAP_RADIUS_METERS } from "@/lib/transitGraph";
import type { OsmNode, OsmRelation, OsmWay } from "@/lib/transitGraphIngest";

export interface TracedSegment {
  geometry: GeoJSON.LineString;
  /** Real track length along the traced shape. Stored because it is free once the shape exists,
   * and consumed by nothing — rail durations stay haversine (ADR-0030 §4). Swapping it in would
   * move every rail duration ~7.7%, which is not a rendering change's business, and is gated on a
   * classifier defect (#192) besides. */
  tracedLengthMeters: number;
}

/** Where a station sits along the assembled chain, as a fractional index: a whole number is a
 * chain vertex, a fraction is a point projected onto the segment after it. One representation for
 * both, so the cut below does not care which kind of stop it is slicing between. */
type ChainPosition = number;

interface Chain {
  /** Every vertex index each node id occupies, ascending. A list rather than one index because a
   * route can pass the same place twice — an out-and-back line retraces its stem, and a lasso
   * runs its stem out, loops, and comes back down it. Taking the first occurrence on the return
   * leg traces the whole outbound journey instead of the hop actually ridden. */
  occurrences: Map<string, number[]>;
  points: Point[];
  /** Chain indexes `i` where the join between `points[i]` and `points[i + 1]` is a concatenation
   * across two way ends that did not match — §1's gate. The assembler knows this exactly at the
   * moment it happens, which is why no jump-distance threshold is used: a Shinkansen viaduct's
   * sparse straight track looks like a gap and is not one. */
  breaks: Set<number>;
  closed: boolean;
}

function pointOf(node: OsmNode): Point {
  return { lat: node.lat, lng: node.lon };
}

/**
 * Greedy end-to-end assembly of the relation's unroled way members. A way is reversed when its far
 * end matches; when neither end matches, the way is concatenated anyway and the join is recorded
 * as a break rather than erroring. Concatenating rather than stopping is deliberate — it keeps the
 * ways after the gap available to the stops that sit on them, and §1's gate refuses only the
 * segments that actually cross the break.
 */
function assembleChain(relation: OsmRelation, waysById: Map<string, OsmWay>, nodesById: Map<string, OsmNode>): Chain | null {
  const ways = relation.members
    .filter((m) => m.type === "way" && m.role === "")
    .map((m) => waysById.get(m.ref))
    .filter((w): w is OsmWay => w !== undefined && w.nodeRefs.length >= 2);
  if (ways.length === 0) return null;

  let nodeIds = [...ways[0].nodeRefs];
  // The first way's own direction is unknowable until a second way is placed against it: if the
  // neighbour meets its *start* and not its end, it was laid down backwards. Both tests are
  // needed — a closed loop's second way meets the first at both ends, and reversing on the head
  // match alone would send the whole chain round backwards.
  if (ways.length > 1) {
    const next = ways[1].nodeRefs;
    const meets = (id: string) => id === next[0] || id === next[next.length - 1];
    if (!meets(nodeIds[nodeIds.length - 1]) && meets(nodeIds[0])) nodeIds.reverse();
  }

  const breaks = new Set<number>();
  for (let i = 1; i < ways.length; i++) {
    const refs = ways[i].nodeRefs;
    const tail = nodeIds[nodeIds.length - 1];
    if (refs[0] === tail) {
      nodeIds.push(...refs.slice(1));
    } else if (refs[refs.length - 1] === tail) {
      nodeIds.push(...refs.slice(0, -1).reverse());
    } else {
      breaks.add(nodeIds.length - 1);
      nodeIds.push(...refs);
    }
  }

  // A node the extract does not carry cannot contribute a coordinate. Dropping it silently would
  // invent a straight line across whatever it spanned, so the join it leaves behind is a break too.
  // Defensive rather than expected: the national extract has zero dangling references of any kind.
  // Breaks are re-indexed onto the kept vertices as we go, since the two lists diverge on a drop.
  const points: Point[] = [];
  const kept: string[] = [];
  const keptBreaks = new Set<number>();
  let previousIndex = -1;
  for (let i = 0; i < nodeIds.length; i++) {
    const node = nodesById.get(nodeIds[i]);
    if (!node) continue;
    if (kept.length > 0) {
      let broken = i !== previousIndex + 1;
      for (let b = previousIndex; b < i && !broken; b++) broken = breaks.has(b);
      if (broken) keptBreaks.add(kept.length - 1);
    }
    previousIndex = i;
    kept.push(nodeIds[i]);
    points.push(pointOf(node));
  }
  if (kept.length < 2) return null;

  const occurrences = new Map<string, number[]>();
  for (let i = 0; i < kept.length; i++) {
    const list = occurrences.get(kept[i]);
    if (list) list.push(i);
    else occurrences.set(kept[i], [i]);
  }

  return { occurrences, points, breaks: keptBreaks, closed: kept[0] === kept[kept.length - 1] };
}

/**
 * The same track, walked the other way. A route relation's ways carry no inherent direction, so a
 * chain can come out of assembly running against the line's stop order — measured at ~1% of
 * relations. Turning the chain around once, before any cutting, is what keeps that case exact:
 * every segment then runs forward and no per-segment reversal is needed. A single backwards hop in
 * an otherwise forward line is a different thing entirely and is refused, not reversed.
 */
function reverseChain(chain: Chain): Chain {
  const points = [...chain.points].reverse();
  const last = points.length - 1;
  const breaks = new Set<number>();
  // A break between vertices i and i+1 becomes a break between their mirrored neighbours.
  for (const i of chain.breaks) breaks.add(last - i - 1);
  const occurrences = new Map<string, number[]>();
  for (const [id, list] of chain.occurrences) occurrences.set(id, list.map((i) => last - i).reverse());
  return { occurrences, points, breaks, closed: chain.closed };
}

/** The point at a fractional chain index. */
function pointAt(chain: Chain, position: ChainPosition): Point {
  const index = Math.floor(position);
  const fraction = position - index;
  if (fraction === 0) return chain.points[index];
  const a = chain.points[index];
  const b = chain.points[index + 1];
  return { lat: a.lat + (b.lat - a.lat) * fraction, lng: a.lng + (b.lng - a.lng) * fraction };
}

/** Where along a segment `p` projects, as a fraction clamped into [0, 1]. Plane geometry on
 * degrees, with longitude scaled by latitude — a rail segment is a couple of hundred metres, far
 * too short for the earth's curvature to matter to which vertex a station is nearest. */
function projectionFraction(p: Point, a: Point, b: Point): number {
  const scale = Math.cos((a.lat * Math.PI) / 180);
  const ax = (p.lng - a.lng) * scale;
  const ay = p.lat - a.lat;
  const bx = (b.lng - a.lng) * scale;
  const by = b.lat - a.lat;
  const lengthSquared = bx * bx + by * by;
  if (lengthSquared === 0) return 0;
  return Math.min(1, Math.max(0, (ax * bx + ay * by) / lengthSquared));
}

/**
 * A station's position on the chain. A `stop`-role node is a vertex of the member ways by the PTv2
 * convention, so the common case is an exact id match; 3.4% of national stop members are not, most
 * of them the old-style `railway=station` node that genuinely sits beside the tracks.
 *
 * Those are cut at the nearest point on the chain, **but only inside
 * `STATION_SNAP_RADIUS_METERS`** (§3). Reusing the provider's radius is the point: it is already
 * this codebase's answer to "is this station reachable from here", and a second, separately-tuned
 * notion of nearness would be a second thing to get wrong. The bound also stops a loop line from
 * snapping to the wrong lap. Beyond it, `null` — and §1's gate refuses the segments either side.
 */
function locateStop(chain: Chain, node: OsmNode, after: ChainPosition): ChainPosition | null {
  const exact = chain.occurrences.get(node.id);
  if (exact !== undefined) {
    // The first pass through this place at or after the previous stop. Stops come in travel
    // order, so the track ridden between two of them runs forward along the chain — which makes
    // "the next occurrence" the exact answer for a line that doubles back, not a guess. When none
    // qualifies the route has genuinely wrapped past the chain's end, and the first occurrence is
    // what lets §2 recognise it.
    return exact.find((i) => i >= after) ?? exact[0];
  }

  const station = pointOf(node);
  let best: { position: ChainPosition; meters: number } | null = null;
  for (let i = 0; i < chain.points.length - 1; i++) {
    const fraction = projectionFraction(station, chain.points[i], chain.points[i + 1]);
    const position = i + fraction;
    const meters = haversineMeters(station, pointAt(chain, position));
    if (!best || meters < best.meters) best = { position, meters };
  }
  if (!best || best.meters > STATION_SNAP_RADIUS_METERS) return null;
  return best.position;
}

/** The vertices between two positions, inclusive of both ends. `from` must be at or before `to`. */
function sliceBetween(chain: Chain, from: ChainPosition, to: ChainPosition): Point[] {
  const points: Point[] = [pointAt(chain, from)];
  for (let i = Math.floor(from) + 1; i <= Math.ceil(to) - 1; i++) points.push(chain.points[i]);
  points.push(pointAt(chain, to));
  return points;
}

/** True when any recorded break falls between the two positions — §1's gate. */
function crossesBreak(chain: Chain, from: ChainPosition, to: ChainPosition): boolean {
  for (let i = Math.floor(from); i <= Math.ceil(to) - 1; i++) {
    if (chain.breaks.has(i)) return true;
  }
  return false;
}

function lengthOf(points: Point[]): number {
  let meters = 0;
  for (let i = 1; i < points.length; i++) meters += haversineMeters(points[i - 1], points[i]);
  return meters;
}

function segmentBetween(chain: Chain, from: ChainPosition, to: ChainPosition): TracedSegment | null {
  let points: Point[];

  // The same place twice — a relation listing one station as two consecutive stop members. There
  // is no track between them to trace.
  if (from === to) return null;

  if (to > from) {
    if (crossesBreak(chain, from, to)) return null;
    points = sliceBetween(chain, from, to);
  } else if (chain.closed) {
    // The hop that closes a loop (§2): the chain's tail joined to its head, which is an exact cut
    // rather than a heuristic. Special-cased instead of left to §1's gate deliberately — refusing
    // these would put the app's most conspicuous dashed line on the Yamanote, the Osaka Loop and a
    // Nagoya subway loop, three of the lines a Japan itinerary is most likely to actually ride.
    const last = chain.points.length - 1;
    if (crossesBreak(chain, from, last) || crossesBreak(chain, 0, to)) return null;
    points = [...sliceBetween(chain, from, last), ...sliceBetween(chain, 0, to).slice(1)];
  } else {
    // One hop runs against the chain while the line as a whole runs with it. A systematically
    // backwards chain was already turned around before any cutting happened, so what is left here
    // is a single stop pair the chain cannot explain — most often a lasso line, where the track
    // loops back on itself and the closing hop's return path is not `chain[from..to]` at all.
    //
    // Slicing it anyway and reversing traces the whole loop the wrong way round: measured at 25.3
    // km of track for a 1.0 km hop on 名古屋市営名城線. §2's wraparound is exact and applies only
    // to a genuinely closed chain; beyond that, §1's answer stands. We do not know this track, so
    // we do not draw it.
    return null;
  }

  // A repeated vertex carries nothing and the wraparound above produces one at the seam whenever a
  // loop's closing stop is the chain's own first node.
  points = points.filter((p, i) => i === 0 || p.lat !== points[i - 1].lat || p.lng !== points[i - 1].lng);

  if (points.length < 2) return null;
  return {
    geometry: { type: "LineString", coordinates: points.map((p) => [p.lng, p.lat]) },
    tracedLengthMeters: lengthOf(points),
  };
}

/**
 * One traced segment per ride edge of `relation`, in edge order — so the result at index `i` is
 * the shape between `stopOsmIds[i]` and `stopOsmIds[i + 1]`, and the array is one shorter than the
 * stop list. `null` at an index means that ride edge gets no geometry, for any of the reasons
 * above; a caller never has to ask which.
 *
 * `stopOsmIds` is the *resolved* stop sequence `buildLines` actually kept, not the relation's raw
 * members, so the two stay aligned when the extract is missing a stop node.
 */
export function traceLineGeometry(
  relation: OsmRelation,
  stopOsmIds: string[],
  waysById: Map<string, OsmWay>,
  nodesById: Map<string, OsmNode>
): (TracedSegment | null)[] {
  const empty = new Array<TracedSegment | null>(Math.max(0, stopOsmIds.length - 1)).fill(null);
  let chain = assembleChain(relation, waysById, nodesById);
  if (!chain) return empty;

  // Two passes, because the two questions need different answers. The direction vote must see
  // where each stop *first* sits on the chain, or a line that doubles back would always look
  // forward; the cut needs each stop's position on the pass actually being ridden.
  const locateFirst = (c: Chain) =>
    stopOsmIds.map((id) => {
      const node = nodesById.get(id);
      return node ? locateStop(c, node, -Infinity) : null;
    });

  // Which way round the chain runs, decided once for the whole line rather than per segment.
  const firstPositions = locateFirst(chain);
  let forward = 0;
  let backward = 0;
  for (let i = 0; i + 1 < firstPositions.length; i++) {
    const a = firstPositions[i];
    const b = firstPositions[i + 1];
    if (a === null || b === null || a === b) continue;
    if (b > a) forward++;
    else backward++;
  }
  if (backward > forward) chain = reverseChain(chain);

  let previous: ChainPosition = -Infinity;
  const positions = stopOsmIds.map((id) => {
    const node = nodesById.get(id);
    const position = node ? locateStop(chain, node, previous) : null;
    if (position !== null) previous = position;
    return position;
  });

  return empty.map((_, i) => {
    const from = positions[i];
    const to = positions[i + 1];
    if (from === null || to === null) return null;
    return segmentBetween(chain, from, to);
  });
}
