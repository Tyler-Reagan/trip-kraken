import Testing
import TripKrakenKit

@Suite("NoGeometryProvider")
struct NoGeometryProviderTests {
    @Test("every pair answers nil, with no retries")
    func everyPairNil() async throws {
        let pairs = [
            PathPair(from: PathEndpoint(lat: 0, lng: 0), to: PathEndpoint(lat: 1, lng: 1)),
            PathPair(from: PathEndpoint(lat: 2, lng: 2), to: PathEndpoint(lat: 3, lng: 3)),
        ]
        let batch = try await NoGeometryProvider().geometry(for: pairs, profile: .walking, journeyRoadKinds: [])
        #expect(batch.results == [nil, nil])
        #expect(batch.retryIndices.isEmpty)
    }

    @Test("an empty request answers an empty batch")
    func emptyRequest() async throws {
        let batch = try await NoGeometryProvider().geometry(for: [], profile: .walking, journeyRoadKinds: [])
        #expect(batch.results.isEmpty)
    }
}
