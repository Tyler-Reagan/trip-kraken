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
import { STATION_SNAP_RADIUS_METERS, type RideEdge } from "@/lib/transitGraph";
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
 * End-to-end assembly of the relation's unroled way members, by connectivity with member order as
 * the tie-break (ADR-0055 §1). A way is reversed when its far end matches; when no remaining way
 * meets the chain's tail, the next way in member order is concatenated anyway and the join is
 * recorded as a break rather than erroring. Concatenating rather than stopping is deliberate — it
 * keeps the ways after the gap available to the stops that sit on them, and §1's gate refuses only
 * the segments that actually cross the break.
 *
 * Member order alone is not enough to follow: contributors list a short way one place out of order
 * often enough that the 260101 のぞみ 9802494 alone had twenty joins where consecutive members do
 * not meet, nearly all of them a pair either side of one misplaced way, 4–372 m apart. Each refused
 * every hop it fell inside. So when the next way in member order does not meet the tail, the
 * nearest way that does — searching forward through member order first, then back — is taken
 * instead, and the skipped way waits for the tail to reach it.
 */
function assembleChain(
  relation: OsmRelation,
  waysById: Map<string, OsmWay>,
  nodesById: Map<string, OsmNode>,
): Chain | null {
  const ways = relation.members
    .filter((m) => m.type === "way" && m.role === "")
    .map((m) => waysById.get(m.ref))
    .filter((w): w is OsmWay => w !== undefined && w.nodeRefs.length >= 2);
  if (ways.length === 0) return null;

  // Every unplaced way, by the node at each of its ends. A way listed twice (an out-and-back's
  // stem) is two entries, placed independently.
  const byEnd = new Map<string, number[]>();
  const index = (id: string, i: number) => {
    const list = byEnd.get(id);
    if (list) list.push(i);
    else byEnd.set(id, [i]);
  };
  ways.forEach((way, i) => {
    index(way.nodeRefs[0], i);
    if (way.nodeRefs[way.nodeRefs.length - 1] !== way.nodeRefs[0])
      index(way.nodeRefs[way.nodeRefs.length - 1], i);
  });
  const placed = new Array<boolean>(ways.length).fill(false);

  /** The unplaced way meeting `nodeId` nearest after `last` in member order, else nearest before. */
  const meeting = (nodeId: string, last: number): number | undefined => {
    let after: number | undefined;
    let before: number | undefined;
    for (const i of byEnd.get(nodeId) ?? []) {
      if (placed[i]) continue;
      if (i > last && (after === undefined || i < after)) after = i;
      if (i < last && (before === undefined || i > before)) before = i;
    }
    return after ?? before;
  };

  let nodeIds = [...ways[0].nodeRefs];
  placed[0] = true;
  // The first way's own direction is unknowable until a second way is placed against it: if the
  // neighbour meets its *start* and not its end, it was laid down backwards. Both tests are
  // needed — a closed loop's second way meets the first at both ends, and reversing on the head
  // match alone would send the whole chain round backwards.
  if (ways.length > 1) {
    const next = ways[1].nodeRefs;
    const meets = (id: string) =>
      id === next[0] || id === next[next.length - 1];
    if (!meets(nodeIds[nodeIds.length - 1]) && meets(nodeIds[0]))
      nodeIds.reverse();
  }

  const breaks = new Set<number>();
  let last = 0;
  for (let placedCount = 1; placedCount < ways.length; placedCount++) {
    const tail = nodeIds[nodeIds.length - 1];
    const joined = meeting(tail, last);
    if (joined !== undefined) {
      const refs = ways[joined].nodeRefs;
      if (refs[0] === tail) nodeIds.push(...refs.slice(1));
      else nodeIds.push(...refs.slice(0, -1).reverse());
      placed[joined] = true;
      last = joined;
      continue;
    }
    // Nothing meets the tail: a real gap. Carry on from the next unplaced way in member order,
    // wrapping round, so the ways beyond the gap still reach the stops on them.
    let next = last + 1;
    while (placed[next % ways.length]) next++;
    next %= ways.length;
    breaks.add(nodeIds.length - 1);
    nodeIds.push(...ways[next].nodeRefs);
    placed[next] = true;
    last = next;
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

  return {
    occurrences,
    points,
    breaks: keptBreaks,
    closed: kept[0] === kept[kept.length - 1],
  };
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
  for (const [id, list] of chain.occurrences)
    occurrences.set(id, list.map((i) => last - i).reverse());
  return { occurrences, points, breaks, closed: chain.closed };
}

/** The point at a fractional chain index. */
function pointAt(chain: Chain, position: ChainPosition): Point {
  const index = Math.floor(position);
  const fraction = position - index;
  if (fraction === 0) return chain.points[index];
  const a = chain.points[index];
  const b = chain.points[index + 1];
  return {
    lat: a.lat + (b.lat - a.lat) * fraction,
    lng: a.lng + (b.lng - a.lng) * fraction,
  };
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
function locateStop(
  chain: Chain,
  node: OsmNode,
  after: ChainPosition,
): ChainPosition | null {
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
    const fraction = projectionFraction(
      station,
      chain.points[i],
      chain.points[i + 1],
    );
    const position = i + fraction;
    const meters = haversineMeters(station, pointAt(chain, position));
    if (!best || meters < best.meters) best = { position, meters };
  }
  if (!best || best.meters > STATION_SNAP_RADIUS_METERS) return null;
  return best.position;
}

/** The vertices between two positions, inclusive of both ends. `from` must be at or before `to`. */
function sliceBetween(
  chain: Chain,
  from: ChainPosition,
  to: ChainPosition,
): Point[] {
  const points: Point[] = [pointAt(chain, from)];
  for (let i = Math.floor(from) + 1; i <= Math.ceil(to) - 1; i++)
    points.push(chain.points[i]);
  points.push(pointAt(chain, to));
  return points;
}

/** True when any recorded break falls between the two positions — §1's gate. */
function crossesBreak(
  chain: Chain,
  from: ChainPosition,
  to: ChainPosition,
): boolean {
  for (let i = Math.floor(from); i <= Math.ceil(to) - 1; i++) {
    if (chain.breaks.has(i)) return true;
  }
  return false;
}

function lengthOf(points: Point[]): number {
  let meters = 0;
  for (let i = 1; i < points.length; i++)
    meters += haversineMeters(points[i - 1], points[i]);
  return meters;
}

function segmentBetween(
  chain: Chain,
  from: ChainPosition,
  to: ChainPosition,
): TracedSegment | null {
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
    if (crossesBreak(chain, from, last) || crossesBreak(chain, 0, to))
      return null;
    points = [
      ...sliceBetween(chain, from, last),
      ...sliceBetween(chain, 0, to).slice(1),
    ];
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
  points = points.filter(
    (p, i) =>
      i === 0 || p.lat !== points[i - 1].lat || p.lng !== points[i - 1].lng,
  );

  if (points.length < 2) return null;
  return {
    geometry: {
      type: "LineString",
      coordinates: points.map((p) => [p.lng, p.lat]),
    },
    tracedLengthMeters: lengthOf(points),
  };
}

/** Straight-line length of a stop sequence, summed hop by hop — what a line's stop order claims
 * the train covers. */
function stopSequenceMeters(
  stopOsmIds: string[],
  nodesById: Map<string, OsmNode>,
): number {
  let meters = 0;
  for (let i = 1; i < stopOsmIds.length; i++)
    meters += haversineMeters(
      pointOf(nodesById.get(stopOsmIds[i - 1])!),
      pointOf(nodesById.get(stopOsmIds[i])!),
    );
  return meters;
}

/** The one-stop correction: member order with a single stop moved to where the chain places it —
 * the gap between two neighbours whose own chain positions bracket it. Of every such move, the one
 * that shortens the line most. This is the candidate that survives a chain wrong somewhere *else*:
 * sorting every stop by chain position trusts the chain everywhere, and one のぞみ chain carries
 * 新大阪's track after 東京's, so a full sort drags 新大阪 to the end. Moving only 名古屋 does not. */
function bestSingleMove(
  stopOsmIds: string[],
  positions: ChainPosition[],
  nodesById: Map<string, OsmNode>,
): string[] | null {
  let best: { ids: string[]; meters: number } | null = null;
  for (let i = 0; i < stopOsmIds.length; i++) {
    const ids = stopOsmIds.filter((_, j) => j !== i);
    const rest = positions.filter((_, j) => j !== i);
    for (let k = 0; k <= ids.length; k++) {
      if (k === i) continue; // its own slot — no move.
      const afterPrevious = k === 0 || rest[k - 1] < positions[i];
      const beforeNext = k === ids.length || positions[i] < rest[k];
      if (!afterPrevious || !beforeNext) continue;
      const moved = [...ids.slice(0, k), stopOsmIds[i], ...ids.slice(k)];
      const meters = stopSequenceMeters(moved, nodesById);
      if (!best || meters < best.meters) best = { ids: moved, meters };
    }
  }
  return best?.ids ?? null;
}

/**
 * Alternative stop orders for a relation whose member order disagrees with its chain — possibly
 * none. ADR-0053: a stop member listed out of travel order (all four のぞみ relations append 名古屋
 * after their terminus) builds a phantom hop to it and a real hop that silently skips it.
 *
 * Member order and the assembled chain are two independent witnesses to travel order, and each
 * can be wrong — a contributor appends a stop in the wrong place, or appends its *track* in the
 * wrong place (one のぞみ chain carries 新大阪's track after 東京's). So two candidates are built:
 * every stop sorted by chain position, and the best single stop moved to its chain position with
 * the rest left in member order. Only a candidate that makes the line strictly
 * shorter, stop to stop, survives: a stop out of place always adds a doubled-back hop, so a
 * re-order that does not shorten the line is a witness being wrong rather than the stop list.
 * Which survivor wins is `traceLine`'s call, because only cutting the track can say.
 *
 * Only attempted where position along the chain means something:
 * - a closed chain has no start, so it orders nothing (§2's loops stay as listed);
 * - a stop listed twice, or a station the chain passes more than once, has no single position —
 *   the out-and-back and lasso shapes the 2026-08-20 amendment resolves by pass, not by sorting;
 * - a stop the chain cannot locate at all has nowhere to go.
 */
function reorderCandidates(
  chain: Chain,
  stopOsmIds: string[],
  positions: (ChainPosition | null)[],
  nodesById: Map<string, OsmNode>,
): string[][] {
  if (chain.closed) return [];
  if (new Set(stopOsmIds).size !== stopOsmIds.length) return [];
  if (positions.some((p) => p === null)) return [];
  if (stopOsmIds.some((id) => (chain.occurrences.get(id)?.length ?? 0) > 1))
    return [];

  const byChain = stopOsmIds
    .map((id, i) => ({ id, i, position: positions[i]! }))
    .sort((a, b) => a.position - b.position || a.i - b.i);
  if (byChain.every((stop, rank) => stop.i === rank)) return [];

  const memberMeters = stopSequenceMeters(stopOsmIds, nodesById);
  return [
    byChain.map((stop) => stop.id),
    bestSingleMove(stopOsmIds, positions as ChainPosition[], nodesById),
  ].filter(
    (candidate): candidate is string[] =>
      candidate !== null &&
      stopSequenceMeters(candidate, nodesById) < memberMeters,
  );
}

export interface TracedLine {
  /** The stop sequence the line actually runs: the relation's member order, unless the track proves
   * a stop was listed out of place (`reorderCandidates`). Ride edges must be built from this list,
   * not from the relation's members — `segments` is cut along it. */
  stopOsmIds: string[];
  /** One traced segment per ride edge, in edge order — index `i` is the shape between
   * `stopOsmIds[i]` and `stopOsmIds[i + 1]`, so this is one shorter than the stop list. `null` at an
   * index means that ride edge gets no geometry, for any of the reasons above; a caller never has
   * to ask which. */
  segments: (TracedSegment | null)[];
}

/**
 * Traces `relation`'s track and cuts it per ride edge, after first settling the order the stops
 * are ridden in.
 *
 * `stopOsmIds` is the *resolved* stop sequence `buildLines` kept, not the relation's raw members,
 * so the two stay aligned when the extract is missing a stop node. Every id must be in `nodesById`.
 */
export function traceLine(
  relation: OsmRelation,
  stopOsmIds: string[],
  waysById: Map<string, OsmWay>,
  nodesById: Map<string, OsmNode>,
): TracedLine {
  const untraced = (ids: string[]): TracedLine => ({
    stopOsmIds: ids,
    segments: new Array<TracedSegment | null>(Math.max(0, ids.length - 1)).fill(
      null,
    ),
  });
  let chain = assembleChain(relation, waysById, nodesById);
  if (!chain) return untraced(stopOsmIds);

  // Two passes, because the two questions need different answers. The direction vote must see
  // where each stop *first* sits on the chain, or a line that doubles back would always look
  // forward; the cut needs each stop's position on the pass actually being ridden.
  const locateFirst = (c: Chain) =>
    stopOsmIds.map((id) => locateStop(c, nodesById.get(id)!, -Infinity));

  // Which way round the chain runs, decided once for the whole line rather than per segment.
  let firstPositions = locateFirst(chain);
  let forward = 0;
  let backward = 0;
  for (let i = 0; i + 1 < firstPositions.length; i++) {
    const a = firstPositions[i];
    const b = firstPositions[i + 1];
    if (a === null || b === null || a === b) continue;
    if (b > a) forward++;
    else backward++;
  }
  if (backward > forward) {
    chain = reverseChain(chain);
    firstPositions = locateFirst(chain);
  }

  const cut = (ordered: string[]): TracedLine => {
    let previous: ChainPosition = -Infinity;
    const positions = ordered.map((id) => {
      const position = locateStop(chain!, nodesById.get(id)!, previous);
      if (position !== null) previous = position;
      return position;
    });
    return {
      stopOsmIds: ordered,
      segments: ordered.slice(1).map((_, i) => {
        const from = positions[i];
        const to = positions[i + 1];
        if (from === null || to === null) return null;
        return segmentBetween(chain!, from, to);
      }),
    };
  };

  // A stop out of place is a fact about the stop list, so it is settled before the line is kept —
  // otherwise the cut either refuses the phantom hop or traces the real one straight past the
  // missing station. Every candidate has already shortened the line; the one the track explains
  // best wins, then the shorter. Straight-line length alone is the wrong judge between candidates —
  // real track curves, and the order the chain traces end to end beats a slightly shorter one it
  // cannot. And no candidate may explain *less* track than member order did: a re-order that
  // loses shapes is trading one witness's error for the other's.
  const asListed = cut(stopOsmIds);
  const tracedOf = (line: TracedLine) =>
    line.segments.filter((s) => s !== null).length;
  const best = reorderCandidates(chain, stopOsmIds, firstPositions, nodesById)
    .map((ordered) => ({
      line: cut(ordered),
      meters: stopSequenceMeters(ordered, nodesById),
    }))
    .filter(({ line }) => tracedOf(line) >= tracedOf(asListed))
    .sort(
      (a, b) => tracedOf(b.line) - tracedOf(a.line) || a.meters - b.meters,
    )[0];
  return best?.line ?? asListed;
}

/** One line as `buildLines` built it: its stops in ridden order, and the ride edge between each
 * consecutive pair (`edges[i]` runs `stopOsmIds[i]` → `stopOsmIds[i + 1]`). */
export interface BuiltLine {
  lineId: string;
  stopOsmIds: string[];
  edges: RideEdge[];
}

/**
 * Gives an untraced ride edge the shape another line traced over the same track (ADR-0053 §2).
 *
 * "The same track" is decided by OSM node identity, never by station name: a `stop` member is a
 * vertex of the track itself (PTv2's stop_position), so two lines stopping at the same two nodes
 * are on the same rails between them. Kodama's 品川 → 新横浜 and Nozomi's run between the
 * identical pair of stop_position nodes; Keikyu's 品川 shares a name with JR's and not a centimetre
 * of track. Matching by name or cluster would recover three times as many edges, and draw a fair
 * number of them on the wrong railway.
 *
 * The donor may be a run of several consecutive hops on one line, all traced natively, which is
 * how an express relates to the stopping service on the same rails: Nozomi's 京都 → 名古屋 is
 * Kodama's 京都 → 米原 → … → 名古屋 with the stops left out. Where several donors qualify, the
 * shortest trace wins — the most direct track between two fixed points is the one least likely to
 * have gone round a loop.
 *
 * Only native traces donate: a shape borrowed here is never lent onward, so the result does not
 * depend on the order lines are visited in. A borrowed shape is stored on the recipient edge like
 * any other (ADR-0030 §5 rejects a shared table), and reads back indistinguishable from a native
 * one — it *is* a native trace, just one made from another relation's ways.
 *
 * Mutates `lines`' edges in place; returns how many edges it filled.
 */
export function borrowSharedTrack(lines: BuiltLine[]): number {
  // Snapshot what each line traced on its own before anything is filled in.
  const traced = new Map(
    lines.map((line) => [
      line,
      line.edges.map((e) => e.geometry !== undefined),
    ]),
  );
  const occurrences = new Map<string, { line: BuiltLine; index: number }[]>();
  for (const line of lines) {
    line.stopOsmIds.forEach((id, index) => {
      const list = occurrences.get(id);
      if (list) list.push({ line, index });
      else occurrences.set(id, [{ line, index }]);
    });
  }

  let filled = 0;
  for (const line of lines) {
    line.edges.forEach((edge, i) => {
      if (edge.geometry) return;
      const from = line.stopOsmIds[i];
      const to = line.stopOsmIds[i + 1];
      if (from === to) return;

      let best: TracedSegment | null = null;
      for (const a of occurrences.get(from) ?? []) {
        if (a.line === line) continue;
        for (const b of occurrences.get(to) ?? []) {
          if (b.line !== a.line) continue;
          const shape = runBetween(
            a.line,
            a.index,
            b.index,
            traced.get(a.line)!,
          );
          if (
            shape &&
            (!best || shape.tracedLengthMeters < best.tracedLengthMeters)
          )
            best = shape;
        }
      }
      if (!best) return;
      edge.geometry = best.geometry;
      edge.tracedLengthMeters = best.tracedLengthMeters;
      filled++;
    });
  }
  return filled;
}

/** The donor's own shapes from stop `from` to stop `to`, joined end to end and turned round when
 * the donor runs the other way — or `null` if any hop between them is not natively traced. */
function runBetween(
  line: BuiltLine,
  from: number,
  to: number,
  natively: boolean[],
): TracedSegment | null {
  if (from === to) return null;
  const [lo, hi] = from < to ? [from, to] : [to, from];
  const coordinates: GeoJSON.Position[] = [];
  let tracedLengthMeters = 0;
  for (let k = lo; k < hi; k++) {
    const edge = line.edges[k];
    if (!natively[k] || !edge.geometry || edge.tracedLengthMeters === undefined)
      return null;
    const part = edge.geometry.coordinates;
    const joint = coordinates[coordinates.length - 1];
    const sharesJoint =
      joint !== undefined && joint[0] === part[0][0] && joint[1] === part[0][1];
    coordinates.push(...(sharesJoint ? part.slice(1) : part));
    tracedLengthMeters += edge.tracedLengthMeters;
  }
  if (from > to) coordinates.reverse();
  return {
    geometry: { type: "LineString", coordinates },
    tracedLengthMeters,
  };
}
