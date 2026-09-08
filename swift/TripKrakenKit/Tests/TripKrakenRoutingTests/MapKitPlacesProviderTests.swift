import Foundation
import Testing
import TripKrakenKit

@testable import TripKrakenRouting

// A fake `PlaceSearchRequesting` — `MKMapItem` has no public initializer with the fields we need,
// so a live `MKLocalSearch` call is never exercised here, mirroring `MapKitGeometryProviderTests`'
// own `FakeRequester`.
private actor FakeRequester: PlaceSearchRequesting {
    enum Answer {
        case results([PlaceSearchResult])
        case throttled
        case error
    }

    private var answers: [Answer]
    private(set) var callCount = 0
    private(set) var requestedQueries: [String] = []

    init(answers: [Answer]) {
        self.answers = answers
    }

    func search(query: String, near: Point?) async throws -> [PlaceSearchResult] {
        callCount += 1
        requestedQueries.append(query)
        guard !answers.isEmpty else { return [] }
        switch answers.removeFirst() {
        case .results(let results): return results
        case .throttled: throw PlaceSearchRequestError.throttled
        case .error: throw NSError(domain: "test", code: 1)
        }
    }
}

private func place(name: String = "Some Place") -> PlaceSearchResult {
    PlaceSearchResult(name: name, address: "123 Main St", phone: "555-0100", category: "Restaurant", lat: 35.0, lng: 139.0)
}

@Suite("MapKitPlacesProvider")
struct MapKitPlacesProviderTests {
    @Test("search returns every match")
    func searchReturnsEveryMatch() async throws {
        let requester = FakeRequester(answers: [.results([place(name: "A"), place(name: "B")])])
        let provider = MapKitPlacesProvider(requester: requester, maxRetries: 1, initialBackoff: .milliseconds(1))

        let results = try await provider.search(query: "coffee")

        #expect(results.map(\.name) == ["A", "B"])
    }

    @Test("enrich takes only the first, best match")
    func enrichTakesFirstMatch() async throws {
        let requester = FakeRequester(answers: [.results([place(name: "A"), place(name: "B")])])
        let provider = MapKitPlacesProvider(requester: requester, maxRetries: 1, initialBackoff: .milliseconds(1))

        let match = try await provider.enrich(name: "A", near: Point(lat: 35.0, lng: 139.0))

        #expect(match?.name == "A")
    }

    @Test("no matches answers nil for enrich, not a retry")
    func noMatchesAnswersNil() async throws {
        let requester = FakeRequester(answers: [.results([])])
        let provider = MapKitPlacesProvider(requester: requester, maxRetries: 1, initialBackoff: .milliseconds(1))

        let match = try await provider.enrich(name: "Nowhere", near: nil)

        #expect(match == nil)
    }

    @Test("throttling is retried with backoff, then succeeds")
    func throttleThenSucceeds() async throws {
        let requester = FakeRequester(answers: [.throttled, .results([place()])])
        let provider = MapKitPlacesProvider(requester: requester, maxRetries: 3, initialBackoff: .milliseconds(1))

        let match = try await provider.enrich(name: "Some Place", near: nil)

        #expect(match != nil)
        let calls = await requester.callCount
        #expect(calls == 2, "one throttled attempt, one that succeeded")
    }

    @Test("exhausting retries under sustained throttling throws, rather than answering nil")
    func exhaustsRetries() async throws {
        let requester = FakeRequester(answers: [.throttled, .throttled, .throttled])
        let provider = MapKitPlacesProvider(requester: requester, maxRetries: 2, initialBackoff: .milliseconds(1))

        await #expect(throws: PlaceSearchRequestError.self) {
            try await provider.enrich(name: "Some Place", near: nil)
        }
    }

    @Test("a non-throttle error is not retried")
    func nonThrottleErrorIsNotRetried() async throws {
        let requester = FakeRequester(answers: [.error])
        let provider = MapKitPlacesProvider(requester: requester, maxRetries: 3, initialBackoff: .milliseconds(1))

        await #expect(throws: (any Error).self) {
            try await provider.enrich(name: "Some Place", near: nil)
        }
        let calls = await requester.callCount
        #expect(calls == 1, "only throttling is retried — any other error fails fast")
    }
}

@Suite("MapKitPlacesProvider.searchAlongRoute")
struct SearchAlongRouteTests {
    private func place(name: String, lat: Double, lng: Double) -> PlaceSearchResult {
        PlaceSearchResult(name: name, lat: lat, lng: lng)
    }

    @Test("merges results across every sampled point along the route")
    func mergesAcrossSamples() async throws {
        let route = [Point(lat: 0, lng: 0), Point(lat: 0, lng: 0.1)]
        let requester = FakeRequester(answers: [
            .results([place(name: "near start", lat: 0, lng: 0.01)]),
            .results([place(name: "near end", lat: 0, lng: 0.09)]),
        ])
        let provider = MapKitPlacesProvider(requester: requester, maxRetries: 1, initialBackoff: .milliseconds(1))

        let results = try await provider.searchAlongRoute(query: "coffee", route: route, sampleEveryMeters: 5000, maxSamples: 2)

        #expect(results.map(\.name).sorted() == ["near end", "near start"])
    }

    @Test("the same result found at two samples is not duplicated")
    func dedupesAcrossSamples() async throws {
        let route = [Point(lat: 0, lng: 0), Point(lat: 0, lng: 0.1)]
        let same = place(name: "seen twice", lat: 0, lng: 0.05)
        let requester = FakeRequester(answers: [.results([same]), .results([same])])
        let provider = MapKitPlacesProvider(requester: requester, maxRetries: 1, initialBackoff: .milliseconds(1))

        let results = try await provider.searchAlongRoute(query: "coffee", route: route, sampleEveryMeters: 5000, maxSamples: 2)

        #expect(results.count == 1)
    }

    @Test("results are ranked by distance to the route, not by which sample found them")
    func ranksByDistanceToRoute() async throws {
        let route = [Point(lat: 0, lng: 0), Point(lat: 0, lng: 1)]
        let far = place(name: "far", lat: 5, lng: 0.5)
        let near = place(name: "near", lat: 0.001, lng: 0.5)
        // The far result is returned first (by the earlier sample) but should still rank behind
        // the near one once every sample's results are merged and re-ranked.
        let requester = FakeRequester(answers: [.results([far]), .results([near])])
        let provider = MapKitPlacesProvider(requester: requester, maxRetries: 1, initialBackoff: .milliseconds(1))

        let results = try await provider.searchAlongRoute(query: "coffee", route: route, sampleEveryMeters: 5000, maxSamples: 2)

        #expect(results.map(\.name) == ["near", "far"])
    }

    @Test("results are truncated to limit")
    func truncatesToLimit() async throws {
        let route = [Point(lat: 0, lng: 0), Point(lat: 0, lng: 0.1)]
        let requester = FakeRequester(answers: [
            .results([place(name: "a", lat: 0, lng: 0.01), place(name: "b", lat: 0, lng: 0.02)]),
        ])
        let provider = MapKitPlacesProvider(requester: requester, maxRetries: 1, initialBackoff: .milliseconds(1))

        let results = try await provider.searchAlongRoute(query: "coffee", route: route, sampleEveryMeters: 5000, maxSamples: 1, limit: 1)

        #expect(results.count == 1)
    }
}
