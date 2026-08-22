/**
 * The pure OSM → transit-graph transform (ADR-0019, issue #87/J2) — the seam this ticket unit-
 * tests directly: already-parsed OSM elements in, a `TransitGraph` (`transitGraph.ts`) out. No
 * file I/O, no network, no `osmium` here — that's `parsers/osmXml.ts` (turning a filtered OSM
 * XML file into the `OsmNode`/`OsmRelation` shape below) and the ingest CLI script
 * (`scripts/ingest-transit-graph.ts`), neither of which this module knows about.
 *
 * Two node tiers derive from two different OSM relation kinds:
 *  - Stop nodes/ride edges come from `route` relations (PTv2): one stop node per line/station,
 *    consecutive stop members become ride edges carrying the real haversine distance between
 *    the two stations' actual coordinates.
 *  - Station clusters come from `stop_area`/`stop_area_group` relations first; any stop node OSM
 *    left unclustered (no grouping relation covers it) falls back to proximity + normalized-name
 *    matching, per the design doc's explicit fallback.
 *
 * Way members are now traced (`railGeometry.ts`, ADR-0030), but only for *rendering*. The
 * exclusion this file used to record stands for *duration*: `distanceMeters` is still the
 * straight-line haversine between the two real station coordinates, and the traced track length
 * sits beside it consumed by nothing. The coarse-by-design duration model (ADR-0019) treats
 * per-hop distance as an input to a per-line-type effective speed, not a precision timing figure,
 * so haversine remains the honest granularity — consistent with `haversineMeters` being the "real
 * distance" primitive everywhere else in this graph (`osmTransitProvider.ts`). Swapping the traced
 * length in raises every rail duration ~7.7% (ADR-0030 §4) and is its own ticket (#193), which also
 * retunes `LINE_TYPE_SPEEDS_KMH` against the line-type classifier fixed here (#192) rather than
 * against a model where every Shinkansen ran at the `commuter` speed.
 */

import { haversineMeters } from "@/lib/geo";
import { traceLineGeometry } from "@/lib/railGeometry";
import {
  createGraph,
  type TransitGraph,
  type StopNode,
  type StationCluster,
  type LineType,
  type RideEdge,
} from "@/lib/transitGraph";

export interface OsmNode {
  id: string;
  lat: number;
  lon: number;
  tags: Record<string, string>;
}

/** A way, reduced to what tracing needs. Tags are not retained — see `parsers/osmXml.ts`. */
export interface OsmWay {
  id: string;
  nodeRefs: string[];
}

export interface OsmMember {
  type: "node" | "way" | "relation";
  ref: string;
  role: string;
}

export interface OsmRelation {
  id: string;
  tags: Record<string, string>;
  members: OsmMember[];
}

// Route values that are rail (per ADR-0019's coverage decision) — everything else (bus,
// trolleybus, ferry, ...) is excluded by simply never being in this list.
const RAIL_ROUTE_VALUES = new Set(["train", "subway", "light_rail", "monorail"]);

// ADR-0019's own fix, thresholded as it suggested: real Japanese `route=train` relations do not
// reliably carry the `service` sub-tag (issue #192 measured zero of 1,419 lines classified via it
// nationally), but a named Shinkansen/limited-express relation's own `duration` tag, divided by its
// stops' real distance, self-calibrates without depending on how any one contributor tagged it.
const SHINKANSEN_SPEED_THRESHOLD_KMH = 150;
const LIMITED_EXPRESS_SPEED_THRESHOLD_KMH = 80;

/** OSM's plain `duration` tag on a route relation: `H:MM` or `H:MM:SS`, no seen use of ISO 8601 on
 * real Japanese rail relations. Anything else returns null rather than guess. */
function parseDurationSeconds(duration: string | undefined): number | null {
  if (!duration) return null;
  const parts = duration.split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !Number.isFinite(p))) return null;
  const [h, m, s = 0] = parts;
  return h * 3600 + m * 60 + s;
}

/** The straight-line distance a route relation's own stops span, summed consecutively. Computed
 * independently of ride-edge construction because classification has to happen before any edge
 * exists to read it from — this walks the same stop members the same way, so it is the same
 * distance those edges end up carrying. */
function lineDistanceMeters(stopMembers: OsmMember[], nodesById: Map<string, OsmNode>): number {
  let total = 0;
  let previous: OsmNode | null = null;
  for (const member of stopMembers) {
    const osmNode = nodesById.get(member.ref);
    if (!osmNode) continue;
    if (previous) {
      total += haversineMeters(
        { lat: previous.lat, lng: previous.lon },
        { lat: osmNode.lat, lng: osmNode.lon }
      );
    }
    previous = osmNode;
  }
  return total;
}

function lineTypeOf(relation: OsmRelation, distanceMeters: number): LineType {
  const route = relation.tags.route;
  if (route === "subway") return "subway";
  if (route === "light_rail" || route === "monorail") return "commuter";
  // route === "train": the `service` sub-tag stays the first check — some contributors do tag it —
  // falling back to the relation's own implied average speed when it doesn't.
  if (relation.tags.service === "high_speed") return "shinkansen";
  if (relation.tags.service === "long_distance") return "limitedExpress";
  const durationSeconds = parseDurationSeconds(relation.tags.duration);
  if (durationSeconds) {
    const impliedSpeedKmh = distanceMeters / 1000 / (durationSeconds / 3600);
    if (impliedSpeedKmh > SHINKANSEN_SPEED_THRESHOLD_KMH) return "shinkansen";
    if (impliedSpeedKmh > LIMITED_EXPRESS_SPEED_THRESHOLD_KMH) return "limitedExpress";
  }
  return "commuter";
}

/** English name if OSM tagged one (`name:en`, near-universal on JR/subway route relations in the
 * Japan extract) — the local-script `name` was never a deliberate choice, just the only tag this
 * read before #139's sidebar made a line's name something an English-speaking traveler reads
 * directly rather than passes through to a map label. */
function lineNameOf(relation: OsmRelation): string {
  return relation.tags["name:en"] ?? relation.tags.name ?? relation.tags.ref ?? relation.id;
}

/** A stop node's id is scoped to its line (route relation), matching the two-tier model: the
 * same physical OSM node reachable by two lines becomes two distinct stop nodes. */
function stopNodeId(relationId: string, osmNodeId: string): string {
  return `${relationId}:${osmNodeId}`;
}

/** English name if tagged (`name:en`) — same rationale as `lineNameOf` above. */
function stationNameOf(node: OsmNode): string {
  return node.tags["name:en"] ?? node.tags.name ?? node.id;
}

function normalizeStationName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "");
}

// Stop nodes further apart than this never cluster via the proximity+name fallback, even when
// their normalized names match — distinct stations occasionally share a generic name.
const FALLBACK_CLUSTER_RADIUS_METERS = 300;

/**
 * Builds ride edges (and their stop nodes) from every rail `route` relation, in relation-member
 * order — PTv2 route relations carry their stop members in travel-sequence order, so consecutive
 * stop members are consecutive stations, no reordering needed.
 */
function buildLines(
  graph: TransitGraph,
  nodesById: Map<string, OsmNode>,
  waysById: Map<string, OsmWay>,
  relations: OsmRelation[]
): Map<string, string[]> {
  // Maps a raw OSM node id to every stop node id created from it (one per line through that
  // physical location) — cluster derivation below needs this to translate stop_area membership
  // (which references raw OSM nodes) back into our stop node ids.
  const rawNodeToStopNodes = new Map<string, string[]>();

  for (const relation of relations) {
    if (!RAIL_ROUTE_VALUES.has(relation.tags.route ?? "")) continue;

    const lineName = lineNameOf(relation);
    const stopMembers = relation.members.filter(
      (m) => m.type === "node" && m.role.startsWith("stop")
    );
    const lineType = lineTypeOf(relation, lineDistanceMeters(stopMembers, nodesById));

    let sequence = 0;
    let previous: { id: string; node: OsmNode } | null = null;
    // The resolved stop sequence and the edges built from it, kept aligned so tracing below can
    // hand segment `i` to the edge between stop `i` and stop `i + 1`.
    const stopOsmIds: string[] = [];
    const edgesOfLine: RideEdge[] = [];
    for (const member of stopMembers) {
      const osmNode = nodesById.get(member.ref);
      if (!osmNode) continue; // referenced node missing from the extract — skip, don't fabricate.
      stopOsmIds.push(osmNode.id);

      const id = stopNodeId(relation.id, osmNode.id);
      if (!graph.stopNodes.has(id)) {
        const stop: StopNode = {
          id,
          lineId: relation.id,
          lineName,
          lineType,
          stationName: stationNameOf(osmNode),
          lat: osmNode.lat,
          lng: osmNode.lon,
          sequence,
        };
        graph.stopNodes.set(id, stop);
        const existing = rawNodeToStopNodes.get(osmNode.id);
        if (existing) existing.push(id);
        else rawNodeToStopNodes.set(osmNode.id, [id]);
      }
      sequence++;

      if (previous) {
        const edge: RideEdge = {
          fromStopId: previous.id,
          toStopId: id,
          distanceMeters: haversineMeters(
            { lat: previous.node.lat, lng: previous.node.lon },
            { lat: osmNode.lat, lng: osmNode.lon }
          ),
        };
        graph.rideEdges.push(edge);
        edgesOfLine.push(edge);
      }
      previous = { id, node: osmNode };
    }

    // The line's real track, cut per ride edge (ADR-0030). A refused segment leaves the edge
    // without geometry, which is what makes the map draw that stretch dashed rather than claim a
    // shape we do not have.
    traceLineGeometry(relation, stopOsmIds, waysById, nodesById).forEach((segment, i) => {
      const edge = edgesOfLine[i];
      if (!segment || !edge) return;
      edge.geometry = segment.geometry;
      edge.tracedLengthMeters = segment.tracedLengthMeters;
    });
  }

  return rawNodeToStopNodes;
}

function addCluster(graph: TransitGraph, id: string, name: string, stopNodeIds: string[]): void {
  if (stopNodeIds.length < 2) return; // a lone stop node has no transfer to represent.
  graph.clusters.set(id, { id, name, stopNodeIds });
  for (let i = 0; i < stopNodeIds.length; i++) {
    for (let j = i + 1; j < stopNodeIds.length; j++) {
      graph.transferEdges.push({ fromStopId: stopNodeIds[i], toStopId: stopNodeIds[j], clusterId: id });
    }
  }
}

/**
 * Clusters stop nodes into station interchanges: `stop_area`/`stop_area_group` relations first,
 * then the proximity+normalized-name fallback for whatever's left uncovered.
 */
function buildClusters(
  graph: TransitGraph,
  relations: OsmRelation[],
  rawNodeToStopNodes: Map<string, string[]>
): void {
  const stopAreas = relations.filter((r) => r.tags.public_transport === "stop_area");
  const stopAreaGroups = relations.filter((r) => r.tags.public_transport === "stop_area_group");

  const stopNodeIdsOfArea = (area: OsmRelation): string[] =>
    area.members
      .filter((m) => m.type === "node")
      .flatMap((m) => rawNodeToStopNodes.get(m.ref) ?? []);

  const absorbedAreaIds = new Set<string>();
  for (const group of stopAreaGroups) {
    const memberAreaIds = group.members.filter((m) => m.type === "relation").map((m) => m.ref);
    const stopIds = memberAreaIds
      .flatMap((areaId) => {
        const area = stopAreas.find((a) => a.id === areaId);
        if (!area) return [];
        absorbedAreaIds.add(areaId);
        return stopNodeIdsOfArea(area);
      });
    addCluster(graph, group.id, group.tags.name ?? group.id, [...new Set(stopIds)]);
  }

  for (const area of stopAreas) {
    if (absorbedAreaIds.has(area.id)) continue;
    addCluster(graph, area.id, area.tags.name ?? area.id, [...new Set(stopNodeIdsOfArea(area))]);
  }

  // Fallback: any stop node not already placed in a cluster above, grouped by normalized name +
  // proximity with other still-unclustered stop nodes.
  const clustered = new Set([...graph.clusters.values()].flatMap((c) => c.stopNodeIds));
  const unclustered = [...graph.stopNodes.values()].filter((s) => !clustered.has(s.id));

  const byName = new Map<string, StopNode[]>();
  for (const stop of unclustered) {
    const key = normalizeStationName(stop.stationName);
    const group = byName.get(key);
    if (group) group.push(stop);
    else byName.set(key, [stop]);
  }

  for (const [name, group] of byName) {
    // Within a same-name group, still only cluster stops within the proximity radius of each
    // other — a simple connected-components pass over the pairwise-distance graph.
    const remaining = [...group];
    let clusterIndex = 0;
    while (remaining.length > 0) {
      const seed = remaining.shift()!;
      const bucket = [seed];
      // Fixed-point sweep: keep absorbing remaining stops within radius of *any* bucket member,
      // since a chain (A near B, B near C, A far from C) must still land in one cluster.
      let grew = true;
      while (grew) {
        grew = false;
        for (let i = remaining.length - 1; i >= 0; i--) {
          if (bucket.some((b) => haversineMeters(b, remaining[i]) <= FALLBACK_CLUSTER_RADIUS_METERS)) {
            bucket.push(...remaining.splice(i, 1));
            grew = true;
          }
        }
      }
      addCluster(graph, `fallback:${name}:${clusterIndex++}`, seed.stationName, bucket.map((s) => s.id));
    }
  }
}

/** The pure transform (Seam 2): parsed OSM nodes + ways + relations → a complete `TransitGraph`.
 * Ways joined the signature with ADR-0030 — they carry the geometry each ride edge is traced from,
 * and tracing belongs behind this seam, where ADR-0019's ticket #87 drew the unit-test line. */
export function buildTransitGraph(nodes: OsmNode[], ways: OsmWay[], relations: OsmRelation[]): TransitGraph {
  const graph = createGraph();
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const waysById = new Map(ways.map((w) => [w.id, w]));
  const rawNodeToStopNodes = buildLines(graph, nodesById, waysById, relations);
  buildClusters(graph, relations, rawNodeToStopNodes);
  return graph;
}
