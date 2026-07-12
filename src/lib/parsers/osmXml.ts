/**
 * Parses OSM XML (the `.osm` format `osmium cat -f osm` produces from a filtered `.osm.pbf`
 * extract) into the `OsmNode`/`OsmRelation` shape `transitGraphIngest.ts`'s pure transform
 * consumes. I/O-adjacent (reads a string, no network) but not the unit-tested seam (ADR-0019's
 * ticket #87 draws that line at "parsed OSM elements", i.e. after this step) — this file's job
 * is solely turning XML text into plain data, mirroring `parsers/kml.ts`'s XMLParser usage.
 *
 * `way` elements aren't parsed here: nothing downstream needs a line's rail geometry (see
 * `transitGraphIngest.ts`'s docstring on why ride-edge distance is real-coordinate haversine, not
 * traced track length), so way parsing would be speculative.
 */

import { XMLParser } from "fast-xml-parser";
import type { OsmNode, OsmRelation, OsmMember } from "@/lib/transitGraphIngest";

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function tagsOf(raw: Record<string, unknown>): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const tag of toArray(raw.tag as Record<string, string> | Record<string, string>[] | undefined)) {
    const k = tag["@_k"];
    const v = tag["@_v"];
    if (typeof k === "string" && typeof v === "string") tags[k] = v;
  }
  return tags;
}

export function parseOsmXml(xml: string): { nodes: OsmNode[]; relations: OsmRelation[] } {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (name) => ["node", "relation", "member", "tag"].includes(name),
    // fast-xml-parser's entity-expansion guard defaults to 1000 total expansions — a billion-laughs
    // safeguard sized for arbitrary untrusted input. A nationwide rail extract is neither untrusted
    // nor small: station/line names routinely carry `&amp;`/`&apos;` entities, easily exceeding the
    // default across hundreds of thousands of tags. This is our own pinned, trusted Geofabrik
    // extract (never user-supplied XML), so raising the ceiling is safe, not a security regression.
    processEntities: { maxTotalExpansions: 5_000_000, maxExpandedLength: 50_000_000 },
  });

  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch (err) {
    throw new Error(`OSM XML parse error: ${(err as Error).message}`);
  }

  const osm = (parsed as Record<string, unknown>).osm as Record<string, unknown> | undefined;
  if (!osm) throw new Error("OSM XML parse error: no <osm> root element");

  const nodes: OsmNode[] = toArray(osm.node as Record<string, unknown>[] | undefined).map((n) => ({
    id: String(n["@_id"]),
    lat: Number(n["@_lat"]),
    lon: Number(n["@_lon"]),
    tags: tagsOf(n),
  }));

  const relations: OsmRelation[] = toArray(osm.relation as Record<string, unknown>[] | undefined).map((r) => ({
    id: String(r["@_id"]),
    tags: tagsOf(r),
    members: toArray(r.member as Record<string, unknown>[] | undefined).map(
      (m): OsmMember => ({
        type: m["@_type"] as OsmMember["type"],
        ref: String(m["@_ref"]),
        role: (m["@_role"] as string) ?? "",
      })
    ),
  }));

  return { nodes, relations };
}
