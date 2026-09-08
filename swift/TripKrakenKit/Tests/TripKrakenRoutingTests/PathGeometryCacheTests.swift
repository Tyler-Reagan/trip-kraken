import Foundation
import Testing
import TripKrakenKit

@testable import TripKrakenRouting

private actor StubProvider: PathGeometryProviding {
    private var answers: [PathGeometryBatch]
    private(set) var requestedPairSets: [[PathPair]] = []

    init(answers: [PathGeometryBatch]) {
        self.answers = answers
    }

    func geometry(for pairs: [PathPair], profile: RoadProfile, journeyRoadKinds: [JourneyRoadKind]) async throws -> PathGeometryBatch {
        requestedPairSets.append(pairs)
        guard !answers.isEmpty else { return PathGeometryBatch(results: Array(repeating: nil, count: pairs.count), retryIndices: []) }
        return answers.removeFirst()
    }
}

private func pair(_ n: Double) -> PathPair {
    PathPair(from: PathEndpoint(lat: n, lng: n), to: PathEndpoint(lat: n + 1, lng: n + 1))
}

private func realPath() -> Path {
    .walking(WalkingPath(base: PathBase(
        from: PathEndpoint(lat: 0, lng: 0), to: PathEndpoint(lat: 1, lng: 1),
        travelCost: TravelCost(distanceMeters: 1, durationSeconds: 1, basisOfCost: .routingService, answeredBy: .osrm), geometry: nil
    )))
}

@MainActor
@Suite("PathGeometryCache")
struct PathGeometryCacheTests {
    @Test("a real answer lands in held, keyed by pairKey")
    func realAnswerLands() async throws {
        let provider = StubProvider(answers: [PathGeometryBatch(results: [[realPath()]], retryIndices: [])])
        let cache = PathGeometryCache(provider: provider)
        let p = pair(0)

        cache.ensure(pairs: [p], profile: .walking, journeyRoadKinds: [])
        try await Task.sleep(for: .milliseconds(50))

        let key = pairKey(profile: .walking, pair: p, journeyRoadKinds: [])
        #expect(cache.held[key]?.first != nil)
    }

    @Test("a nil answer caches as an empty array, not left absent")
    func nilAnswerCachesAsEmpty() async throws {
        let provider = StubProvider(answers: [PathGeometryBatch(results: [nil], retryIndices: [])])
        let cache = PathGeometryCache(provider: provider)
        let p = pair(0)

        cache.ensure(pairs: [p], profile: .walking, journeyRoadKinds: [])
        try await Task.sleep(for: .milliseconds(50))

        let key = pairKey(profile: .walking, pair: p, journeyRoadKinds: [])
        #expect(cache.held[key] == [], "absent and [] both draw dashed straight, but a real answer was already given — cache it")
    }

    @Test("only missing pairs are asked for on a second ensure")
    func onlyMissingPairsAreAsked() async throws {
        let p1 = pair(0)
        let p2 = pair(10)
        let provider = StubProvider(answers: [PathGeometryBatch(results: [[realPath()]], retryIndices: [])])
        let cache = PathGeometryCache(provider: provider)

        cache.ensure(pairs: [p1], profile: .walking, journeyRoadKinds: [])
        try await Task.sleep(for: .milliseconds(50))
        cache.ensure(pairs: [p1, p2], profile: .walking, journeyRoadKinds: [])
        try await Task.sleep(for: .milliseconds(50))

        let requested = await provider.requestedPairSets
        #expect(requested.count == 2)
        #expect(requested[1] == [p2], "p1 is already held, so the second ensure asks only for p2")
    }

    @Test("a retry index is never cached, and is retried after the delay")
    func retryIndexIsRetried() async throws {
        let p = pair(0)
        let provider = StubProvider(answers: [
            PathGeometryBatch(results: [nil], retryIndices: [0]),
            PathGeometryBatch(results: [[realPath()]], retryIndices: []),
        ])
        let cache = PathGeometryCache(provider: provider, maxRetryRounds: 2, retryDelay: .milliseconds(10))

        cache.ensure(pairs: [p], profile: .walking, journeyRoadKinds: [])
        try await Task.sleep(for: .milliseconds(20))

        let key = pairKey(profile: .walking, pair: p, journeyRoadKinds: [])
        #expect(cache.held[key] == nil, "not yet answered after the first (retryable) attempt")

        try await Task.sleep(for: .milliseconds(100))
        #expect(cache.held[key]?.first != nil, "the retry round succeeded")
    }

    @Test("reset clears held state so a trip switch starts clean")
    func resetClears() async throws {
        let provider = StubProvider(answers: [PathGeometryBatch(results: [[realPath()]], retryIndices: [])])
        let cache = PathGeometryCache(provider: provider)
        let p = pair(0)

        cache.ensure(pairs: [p], profile: .walking, journeyRoadKinds: [])
        try await Task.sleep(for: .milliseconds(50))
        cache.reset()

        #expect(cache.held.isEmpty)
    }
}
