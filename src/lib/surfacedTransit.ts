import type { Path, PathEndpoint } from "@/types/path";
import type { Transit } from "@/types";

/** Deterministic and stable across renders, never a database id — a surfaced entry is never a
 *  database row (ADR-0035). Keyed on the endpoint's own coordinates, at `pathPairs.ts`'s `coordOf`
 *  precision, so two Journeys passing through the same physical station produce the same id.
 *  Exported (ADR-0036) so a render surface holding just a `PathEndpoint` — not yet the `Transit`
 *  this module builds — can still look one up by the same identity, e.g. matching a clicked
 *  transfer station against `surfacedTransitOf`'s own output. */
export function surfacedTransitIdOf(lat: number, lng: number): string {
  return `surfaced-transit:${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/** A transfer's own walking Path, as `osmTransitProvider.ts`'s `transferPathOf` builds it: both
 *  ends carry the *cluster's* name ("change at Tokyo," not the two per-line names either side of
 *  it), unlike an access/egress walk, which only ever names its station-side end. Both-ends-named
 *  is the reliable signal — `kind` alone does not distinguish a transfer walk from an access or
 *  egress one. Exported (ADR-0036): the itinerary's shift-row list needs the same check, to decide
 *  which rows are clickable into a surfaced station. */
export function isTransferWalk(path: Path): boolean {
  return path.kind === "walking" && !!path.from.stationName && !!path.to.stationName;
}

/**
 * ADR-0035: the stations strictly between a Journey's own endpoints that its Path chain passes
 * through — every interior Path boundary that carries a station name, which is exactly the shifts
 * a traveler experiences (board, alight, transfer). The chain's own first `from` and last `to` are
 * excluded by position: those coordinates already belong to a real, Authored Location — surfacing
 * them again would render the same place through two different type paths, the duplication
 * ADR-0028 §6 named as the reason a surfaced station needs the `Location` shape at all.
 *
 * **A transfer boundary's coordinate is touched by two Paths that disagree on its name.** The rail
 * Path either side of a transfer names its own end with the per-line stop name
 * (`osmTransitProvider.ts`'s `endpointOfStop`, no override); the transfer's own walking Path names
 * both its ends with the cluster name instead, deliberately. Both describe the same physical point.
 * A transfer walk's naming wins on collision — it is the one `osmTransitProvider.ts` built for
 * exactly this boundary — which is why this walks every Path's both ends rather than just each
 * Path's `to`: the losing (rail) name may be seen first or second depending on the chain's shape,
 * and a first-seen-wins rule would sometimes keep the wrong one.
 *
 * Every `LocationBase` field this entry cannot honestly answer — enrichment, place metadata,
 * hours — is a sentinel, not a placeholder for one filled in later: this was never searched or
 * enriched, and, being recomputed on every read rather than stored, never will be.
 */
export function surfacedTransitOf(paths: Path[], tripId: string): Transit[] {
  const byId = new Map<string, PathEndpoint>();

  const consider = (endpoint: PathEndpoint, preferred: boolean) => {
    if (!endpoint.stationName) return;
    const id = surfacedTransitIdOf(endpoint.lat, endpoint.lng);
    if (preferred || !byId.has(id)) byId.set(id, endpoint);
  };

  paths.forEach((path, i) => {
    const preferred = isTransferWalk(path);
    if (i > 0) consider(path.from, preferred);
    if (i < paths.length - 1) consider(path.to, preferred);
  });

  return [...byId.values()].map((endpoint) => ({
    id: surfacedTransitIdOf(endpoint.lat, endpoint.lng),
    tripId,
    kind: "transit",
    authored: false,
    name: endpoint.stationName!,
    lat: endpoint.lat,
    lng: endpoint.lng,
    arriveAt: null,
    departAt: null,
    address: null,
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
    enrichmentError: null,
  }));
}
