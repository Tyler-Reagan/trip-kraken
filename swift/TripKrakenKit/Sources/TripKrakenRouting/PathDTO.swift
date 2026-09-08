import Foundation
import TripKrakenKit

/// Mirror of `src/types/path.ts` as JSON, not of `Path` as Swift — the BFF returns repository
/// domain objects directly (no zod, no server-side DTO layer), so this is the shape that's
/// actually on the wire.
///
/// **`kind` is optional on the wire, and its absence is meaningful.** `UnknownPath` is
/// `{ kind?: undefined }`, and `JSON.stringify` drops `undefined`, so an unknown Path arrives with
/// no `kind` key at all. Synthesized `Decodable` maps a missing key for an `Optional` property to
/// `nil` — this needs no custom `init(from:)` — but it does need the test that proves it
/// (`PathDTOTests`), because a hand-written decoder using `decode(_:forKey:)` would throw on
/// exactly the most common case.
struct PathDTO: Decodable {
    var kind: PathKind?
    var from: PathEndpoint
    var to: PathEndpoint
    var travelCost: TravelCost
    var geometry: [PathGeometry]?
    var lineName: String?
    var `operator`: Operator?
    var jrPassSupplementRequired: Bool?
}

struct PathGeometryResponseDTO: Decodable {
    var results: [[PathDTO]?]
    var retry: [Int]
}

struct PathGeometryRequestDTO: Encodable {
    var pairs: [PathPair]
    var roadProfile: RoadProfile
    var journeyRoadKinds: [JourneyRoadKind]
}

/// Absent `kind` → `.unknown`. A `rail`/`bus` Path that arrives with no `lineName` degrades to
/// `.other` rather than failing the batch or fabricating an empty line name: `.other` is precisely
/// "travel that was routed but falls outside the kinds we model," which is an honest reading of a
/// nameless routed leg. The wire's redundant `costAsMinutes` needs no handling here —
/// `JSONDecoder` ignores unknown keys, and the Swift port already made it a computed property
/// (`Path.swift`), so there is no `TravelCostDTO` to write.
func toDomain(_ dto: PathDTO) -> Path {
    let base = PathBase(from: dto.from, to: dto.to, travelCost: dto.travelCost, geometry: dto.geometry)
    switch dto.kind {
    case nil:
        return .unknown(base)
    case .rail:
        guard let lineName = dto.lineName else { return .other(OtherPath(base: base, lineName: nil, operator: dto.operator)) }
        return .rail(RailPath(base: base, lineName: lineName, operator: dto.operator, jrPassSupplementRequired: dto.jrPassSupplementRequired))
    case .bus:
        guard let lineName = dto.lineName else { return .other(OtherPath(base: base, lineName: nil, operator: dto.operator)) }
        return .bus(BusPath(base: base, lineName: lineName, operator: dto.operator))
    case .other:
        return .other(OtherPath(base: base, lineName: dto.lineName, operator: dto.operator))
    case .walking:
        return .walking(WalkingPath(base: base))
    case .driving:
        return .driving(DrivingPath(base: base, operator: dto.operator))
    case .bicycle:
        return .bicycle(BicyclePath(base: base, operator: dto.operator))
    }
}
