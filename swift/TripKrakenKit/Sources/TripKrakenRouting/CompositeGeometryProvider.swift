import Foundation
import TripKrakenKit

/// Dispatches each pair across an on-device provider (MapKit) and a server-backed one (HTTP/rail,
/// ADR-0043), and reconciles their answers per pair.
///
/// **The dispatch order is a real design tradeoff, not a mechanical detail — worth stating
/// plainly.** Neither provider can be asked "is this pair rail?" in advance: `MapKitGeometryProvider`
/// happily answers *any* coordinate pair with a walking/driving route whether or not a human would
/// actually take a train there, so "ask MapKit first, fall back to HTTP only when it declines"
/// would almost never reach the server at all — it would silently misrepresent rail journeys as
/// walkable. Conversely, the server's own registry dispatch (`describeJourney`) hands `osm-japan`
/// first crack at *any* pair inside its graph's reach regardless of profile, so "ask HTTP first,
/// fall back to MapKit only on failure" would make nearly every in-Japan pair hit the server even
/// when MapKit could have answered it locally for free — undercutting the on-device benefit
/// ADR-0042 exists for.
///
/// The resolution here: **ask both providers concurrently, then prefer the HTTP answer only when
/// it is a kind MapKit could never honestly produce** (`rail`/`bus` — real transit service
/// identity, not a road route). For every other pair, MapKit's on-device answer is used even when
/// the server also answered, since it is equally valid, was free, and discarding it would only add
/// latency without adding correctness. This does mean a network request still goes out for every
/// pair (there is no way to skip it up front without already knowing the answer), but it never
/// blocks the on-device answer on the network one, and it never lets HTTP overwrite a valid
/// on-device answer with a same-kind server answer.
public struct CompositeGeometryProvider: PathGeometryProviding {
    private let onDevice: PathGeometryProviding
    private let server: PathGeometryProviding

    public init(onDevice: PathGeometryProviding, server: PathGeometryProviding) {
        self.onDevice = onDevice
        self.server = server
    }

    public func geometry(
        for pairs: [PathPair], profile: RoadProfile, journeyRoadKinds: [JourneyRoadKind]
    ) async throws -> PathGeometryBatch {
        guard !pairs.isEmpty else { return PathGeometryBatch(results: [], retryIndices: []) }

        async let onDeviceBatch = onDevice.geometry(for: pairs, profile: profile, journeyRoadKinds: journeyRoadKinds)
        async let serverBatch = server.geometry(for: pairs, profile: profile, journeyRoadKinds: journeyRoadKinds)
        let (fromDevice, fromServer) = try await (onDeviceBatch, serverBatch)

        var results: [[Path]?] = Array(repeating: nil, count: pairs.count)
        var retryIndices: Set<Int> = []

        for index in pairs.indices {
            let serverPaths = fromServer.results[index]
            let isRailOrBus = serverPaths?.contains { $0.kind == .rail || $0.kind == .bus } ?? false

            if isRailOrBus {
                results[index] = serverPaths
            } else if let devicePaths = fromDevice.results[index] {
                results[index] = devicePaths
            } else if let serverPaths {
                results[index] = serverPaths
            }

            if results[index] == nil, fromDevice.retryIndices.contains(index) || fromServer.retryIndices.contains(index) {
                retryIndices.insert(index)
            }
        }

        return PathGeometryBatch(results: results, retryIndices: retryIndices)
    }
}
