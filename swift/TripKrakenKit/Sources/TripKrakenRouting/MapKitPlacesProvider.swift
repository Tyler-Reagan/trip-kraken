import Foundation
import TripKrakenKit

/// ADR-0044: on-device search and enrichment via `MKLocalSearch`, replacing the web app's
/// Google-Places-backed `locations/search` and `enrich` endpoints — one provider answers both
/// jobs, since both are, at bottom, the same "find places matching this text" question.
///
/// Requests are serialized one at a time with exponential backoff on throttle, the same reasoning
/// as `MapKitGeometryProvider` (ADR-0042): `actor` isolation gives this for free, and MapKit's rate
/// limit is real but undocumented.
public actor MapKitPlacesProvider {
    private let requester: PlaceSearchRequesting
    private let maxRetries: Int
    private let initialBackoff: Duration

    public init(requester: PlaceSearchRequesting = MKLocalSearchRequester(), maxRetries: Int = 3, initialBackoff: Duration = .seconds(2)) {
        self.requester = requester
        self.maxRetries = maxRetries
        self.initialBackoff = initialBackoff
    }

    /// Free-text search for a new Location to add — every match, for the user to choose among.
    /// `near`, when given, biases results toward that point without restricting to it.
    public func search(query: String, near: Point? = nil) async throws -> [PlaceSearchResult] {
        try await searchWithRetry(query: query, near: near)
    }

    /// The single best match for an already-known Location's own name, region-biased to its own
    /// coordinates (when it has them) to disambiguate a same-named place elsewhere. `nil` means no
    /// match — a real, terminal answer, not a transient failure (ADR-0044).
    public func enrich(name: String, near: Point?) async throws -> PlaceSearchResult? {
        try await searchWithRetry(query: name, near: near).first
    }

    /// Along-route search — the deferred third discovery mode named in ADR-0044, picked back up:
    /// finds places near the *corridor* between two Locations rather than near one point.
    /// `MKLocalSearch` has no polyline-region option, so this samples several points along
    /// `route` (`samplePoints`, `TripKrakenKit`) — typically the map's own already-fetched Path
    /// geometry for that gap — searches near each in turn (still one request at a time, via this
    /// same actor's serialized retry), merges/dedupes what comes back, and ranks by actual
    /// distance to the whole route rather than to whichever sample happened to find it.
    public func searchAlongRoute(
        query: String, route: [Point], sampleEveryMeters: Double = 2000, maxSamples: Int = 6, limit: Int = 20
    ) async throws -> [PlaceSearchResult] {
        let samples = samplePoints(along: route, everyMeters: sampleEveryMeters, maxSamples: maxSamples)
        var seen: Set<PlaceSearchResult> = []
        var merged: [PlaceSearchResult] = []
        for sample in samples {
            let results = try await searchWithRetry(query: query, near: sample)
            for result in results where seen.insert(result).inserted {
                merged.append(result)
            }
        }
        let ranked = merged.sorted {
            distanceToRoute(Point(lat: $0.lat, lng: $0.lng), route: route)
                < distanceToRoute(Point(lat: $1.lat, lng: $1.lng), route: route)
        }
        return Array(ranked.prefix(limit))
    }

    private func searchWithRetry(query: String, near: Point?) async throws -> [PlaceSearchResult] {
        var attempt = 0
        var backoff = initialBackoff
        while true {
            do {
                return try await requester.search(query: query, near: near)
            } catch PlaceSearchRequestError.throttled where attempt < maxRetries {
                attempt += 1
                try await Task.sleep(for: backoff)
                backoff *= 2
            }
        }
    }
}
