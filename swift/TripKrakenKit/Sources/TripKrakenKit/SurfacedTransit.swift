/// Deterministic and stable across renders, never a database id — a surfaced entry is never a
/// database row (ADR-0035). Keyed on the endpoint's own coordinates, at the same precision
/// `PathPairs.swift`'s `coordOf` uses, so two Journeys passing through the same physical station
/// produce the same id.
public func surfacedTransitIdOf(lat: Double, lng: Double) -> String {
    "surfaced-transit:\(String(format: "%.6f", lat)),\(String(format: "%.6f", lng))"
}

/// A transfer's own walking Path, as an OSM-transit provider would build it: both ends carry the
/// *cluster's* name ("change at Tokyo," not the two per-line names either side of it), unlike an
/// access/egress walk, which only ever names its station-side end. Both-ends-named is the reliable
/// signal — `kind` alone does not distinguish a transfer walk from an access or egress one.
public func isTransferWalk(_ path: Path) -> Bool {
    path.kind == .walking && path.base.from.stationName != nil && path.base.to.stationName != nil
}

/// ADR-0035: the stations strictly between a Journey's own endpoints that its Path chain passes
/// through — every interior Path boundary that carries a station name, which is exactly the shifts
/// a traveler experiences (board, alight, transfer). The chain's own first `from` and last `to` are
/// excluded by position: those coordinates already belong to a real, Authored Location — surfacing
/// them again would render the same place through two different type paths.
///
/// **A transfer boundary's coordinate is touched by two Paths that disagree on its name.** The rail
/// Path either side of a transfer names its own end with the per-line stop name; the transfer's own
/// walking Path names both its ends with the cluster name instead, deliberately. A transfer walk's
/// naming wins on collision, which is why this walks every Path's both ends rather than just each
/// Path's `to`: the losing (rail) name may be seen first or second depending on the chain's shape,
/// and a first-seen-wins rule would sometimes keep the wrong one.
///
/// Every `LocationBase` field this entry cannot honestly answer — enrichment, place metadata,
/// hours — is a sentinel, not a placeholder for one filled in later: this was never searched or
/// enriched, and, being recomputed on every read rather than stored, never will be.
public func surfacedTransitOf(_ paths: [Path], tripId: String) -> [Transit] {
    var byId: [String: PathEndpoint] = [:]
    var order: [String] = []

    func consider(_ endpoint: PathEndpoint, preferred: Bool) {
        guard let stationName = endpoint.stationName, !stationName.isEmpty else { return }
        let id = surfacedTransitIdOf(lat: endpoint.lat, lng: endpoint.lng)
        guard preferred || byId[id] == nil else { return }
        if byId[id] == nil { order.append(id) }
        byId[id] = endpoint
    }

    for (i, path) in paths.enumerated() {
        let preferred = isTransferWalk(path)
        if i > 0 { consider(path.base.from, preferred: preferred) }
        if i < paths.count - 1 { consider(path.base.to, preferred: preferred) }
    }

    return order.compactMap { id in
        guard let endpoint = byId[id], let stationName = endpoint.stationName else { return nil }
        let base = LocationBase(
            id: id, tripId: tripId, name: stationName, lat: endpoint.lat, lng: endpoint.lng,
            enrichmentStatus: .done
        )
        return Transit(base: base, authored: false)
    }
}
