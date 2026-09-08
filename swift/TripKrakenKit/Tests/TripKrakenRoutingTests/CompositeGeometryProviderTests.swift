import Foundation
import Testing
import TripKrakenKit

@testable import TripKrakenRouting

private struct StubProvider: PathGeometryProviding {
    var batch: PathGeometryBatch
    func geometry(for pairs: [PathPair], profile: RoadProfile, journeyRoadKinds: [JourneyRoadKind]) async throws -> PathGeometryBatch {
        batch
    }
}

private struct ThrowingProvider: PathGeometryProviding {
    struct Failure: Error {}
    func geometry(for pairs: [PathPair], profile: RoadProfile, journeyRoadKinds: [JourneyRoadKind]) async throws -> PathGeometryBatch {
        throw Failure()
    }
}

private func pair(_ n: Double) -> PathPair {
    PathPair(from: PathEndpoint(lat: n, lng: n), to: PathEndpoint(lat: n + 1, lng: n + 1))
}

private func walkingPath() -> Path {
    .walking(WalkingPath(base: PathBase(
        from: PathEndpoint(lat: 0, lng: 0), to: PathEndpoint(lat: 1, lng: 1),
        travelCost: TravelCost(distanceMeters: 1, durationSeconds: 1, basisOfCost: .routingService, answeredBy: .mapKit), geometry: nil
    )))
}

private func railPath() -> Path {
    .rail(RailPath(base: PathBase(
        from: PathEndpoint(lat: 0, lng: 0), to: PathEndpoint(lat: 1, lng: 1),
        travelCost: TravelCost(distanceMeters: 1, durationSeconds: 1, basisOfCost: .railNetwork, answeredBy: .osmJapan), geometry: nil
    ), lineName: "Yamanote"))
}

@Suite("CompositeGeometryProvider")
struct CompositeGeometryProviderTests {
    @Test("a rail answer from the server wins over an on-device road answer")
    func railAnswerWins() async throws {
        let onDevice = StubProvider(batch: PathGeometryBatch(results: [[walkingPath()]], retryIndices: []))
        let server = StubProvider(batch: PathGeometryBatch(results: [[railPath()]], retryIndices: []))
        let composite = CompositeGeometryProvider(onDevice: onDevice, server: server)

        let batch = try await composite.geometry(for: [pair(0)], profile: .walking, journeyRoadKinds: [])

        #expect(batch.results[0]?.first?.kind == .rail)
    }

    @Test("a non-rail server answer does not override a valid on-device answer")
    func onDeviceWinsForNonRail() async throws {
        let onDevice = StubProvider(batch: PathGeometryBatch(results: [[walkingPath()]], retryIndices: []))
        let server = StubProvider(batch: PathGeometryBatch(results: [[walkingPath()]], retryIndices: []))
        let composite = CompositeGeometryProvider(onDevice: onDevice, server: server)

        let batch = try await composite.geometry(for: [pair(0)], profile: .walking, journeyRoadKinds: [])

        #expect(batch.results[0]?.first?.base.travelCost.answeredBy == .mapKit, "the on-device answer is used, not discarded for an equally-valid server one")
    }

    @Test("the server's answer is used when on-device has none")
    func serverFillsGapWhenDeviceHasNone() async throws {
        let onDevice = StubProvider(batch: PathGeometryBatch(results: [nil], retryIndices: []))
        let server = StubProvider(batch: PathGeometryBatch(results: [[walkingPath()]], retryIndices: []))
        let composite = CompositeGeometryProvider(onDevice: onDevice, server: server)

        let batch = try await composite.geometry(for: [pair(0)], profile: .walking, journeyRoadKinds: [])

        #expect(batch.results[0] != nil)
    }

    @Test("neither answering leaves the pair nil, not a crash")
    func neitherAnswers() async throws {
        let onDevice = StubProvider(batch: PathGeometryBatch(results: [nil], retryIndices: []))
        let server = StubProvider(batch: PathGeometryBatch(results: [nil], retryIndices: []))
        let composite = CompositeGeometryProvider(onDevice: onDevice, server: server)

        let batch = try await composite.geometry(for: [pair(0)], profile: .walking, journeyRoadKinds: [])

        #expect(batch.results == [nil])
    }

    @Test("a retry from either side is surfaced when nothing else answered")
    func retryIsSurfaced() async throws {
        let onDevice = StubProvider(batch: PathGeometryBatch(results: [nil], retryIndices: [0]))
        let server = StubProvider(batch: PathGeometryBatch(results: [nil], retryIndices: []))
        let composite = CompositeGeometryProvider(onDevice: onDevice, server: server)

        let batch = try await composite.geometry(for: [pair(0)], profile: .walking, journeyRoadKinds: [])

        #expect(batch.retryIndices == [0])
    }

    @Test("an empty request answers an empty batch without calling either provider incorrectly")
    func emptyRequest() async throws {
        let onDevice = StubProvider(batch: PathGeometryBatch(results: [], retryIndices: []))
        let server = StubProvider(batch: PathGeometryBatch(results: [], retryIndices: []))
        let composite = CompositeGeometryProvider(onDevice: onDevice, server: server)

        let batch = try await composite.geometry(for: [], profile: .walking, journeyRoadKinds: [])

        #expect(batch.results.isEmpty)
    }

    @Test("the server throwing (e.g. no dev server running) still returns the on-device answer, not a thrown error")
    func serverThrowingStillReturnsOnDeviceAnswer() async throws {
        let onDevice = StubProvider(batch: PathGeometryBatch(results: [[walkingPath()]], retryIndices: []))
        let server = ThrowingProvider()
        let composite = CompositeGeometryProvider(onDevice: onDevice, server: server)

        let batch = try await composite.geometry(for: [pair(0)], profile: .walking, journeyRoadKinds: [])

        #expect(batch.results[0]?.first?.base.travelCost.answeredBy == .mapKit)
    }

    @Test("the on-device provider throwing still returns the server answer, and marks the pair for retry if it doesn't answer")
    func onDeviceThrowingStillReturnsServerAnswer() async throws {
        let onDevice = ThrowingProvider()
        let server = StubProvider(batch: PathGeometryBatch(results: [[railPath()]], retryIndices: []))
        let composite = CompositeGeometryProvider(onDevice: onDevice, server: server)

        let batch = try await composite.geometry(for: [pair(0)], profile: .walking, journeyRoadKinds: [])

        #expect(batch.results[0]?.first?.kind == .rail)
    }

    @Test("both providers throwing surfaces the pair for retry instead of throwing the whole batch")
    func bothThrowingSurfacesRetry() async throws {
        let onDevice = ThrowingProvider()
        let server = ThrowingProvider()
        let composite = CompositeGeometryProvider(onDevice: onDevice, server: server)

        let batch = try await composite.geometry(for: [pair(0)], profile: .walking, journeyRoadKinds: [])

        #expect(batch.results == [nil])
        #expect(batch.retryIndices == [0])
    }
}
