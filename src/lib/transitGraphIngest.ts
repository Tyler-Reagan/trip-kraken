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
 * Deliberately out of scope here: tracing a line's actual rail-geometry (`way` members) to sum
 * real track length between stops. The coarse-by-design duration model (ADR-0019) already treats
 * per-hop distance as an input to a per-line-type effective speed, not a precision timing figure,
 * so straight-line distance between the two real station coordinates is the honest granularity —
 * consistent with `haversineMeters` already being the "real distance" primitive everywhere else
 * in this graph (`osmTransitProvider.ts`).
 */

import { haversineMeters } from "@/lib/travelCost";
import {
  createGraph,
  type TransitGraph,
  type StopNode,
  type StationCluster,
  type LineType,
} from "@/lib/transitGraph";

export interface OsmNode {
  id: string;
  lat: number;
  lon: number;
  tags: Record<string, string>;
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

function lineTypeOf(relation: OsmRelation): LineType {
  const route = relation.tags.route;
  if (route === "subway") return "subway";
  if (route === "light_rail" || route === "monorail") return "commuter";
  // route === "train": OSM's `service` sub-tag distinguishes trunk speed classes.
  if (relation.tags.service === "high_speed") return "shinkansen";
  if (relation.tags.service === "long_distance") return "limitedExpress";
  return "commuter";
}

function lineNameOf(relation: OsmRelation): string {
  return relation.tags.name ?? relation.tags.ref ?? relation.id;
}

/** A stop node's id is scoped to its line (route relation), matching the two-tier model: the
 * same physical OSM node reachable by two lines becomes two distinct stop nodes. */
function stopNodeId(relationId: string, osmNodeId: string): string {
  return `${relationId}:${osmNodeId}`;
}

function stationNameOf(node: OsmNode): string {
  return node.tags.name ?? node.id;
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
  relations: OsmRelation[]
): Map<string, string[]> {
  // Maps a raw OSM node id to every stop node id created from it (one per line through that
  // physical location) — cluster derivation below needs this to translate stop_area membership
  // (which references raw OSM nodes) back into our stop node ids.
  const rawNodeToStopNodes = new Map<string, string[]>();

  for (const relation of relations) {
    if (!RAIL_ROUTE_VALUES.has(relation.tags.route ?? "")) continue;

    const lineType = lineTypeOf(relation);
    const lineName = lineNameOf(relation);
    const stopMembers = relation.members.filter(
      (m) => m.type === "node" && m.role.startsWith("stop")
    );

    let sequence = 0;
    let previous: { id: string; node: OsmNode } | null = null;
    for (const member of stopMembers) {
      const osmNode = nodesById.get(member.ref);
      if (!osmNode) continue; // referenced node missing from the extract — skip, don't fabricate.

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
        graph.rideEdges.push({
          fromStopId: previous.id,
          toStopId: id,
          distanceMeters: haversineMeters(
            { lat: previous.node.lat, lng: previous.node.lon },
            { lat: osmNode.lat, lng: osmNode.lon }
          ),
        });
      }
      previous = { id, node: osmNode };
    }
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

/** The pure transform (Seam 2): parsed OSM nodes + relations → a complete `TransitGraph`. */
export function buildTransitGraph(nodes: OsmNode[], relations: OsmRelation[]): TransitGraph {
  const graph = createGraph();
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const rawNodeToStopNodes = buildLines(graph, nodesById, relations);
  buildClusters(graph, relations, rawNodeToStopNodes);
  return graph;
}
