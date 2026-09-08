import Foundation
import Testing
import TripKrakenKit

@testable import TripKrakenRouting

@Suite("PathDTO decoding")
struct PathDTODecodingTests {
    @Test("a missing kind key decodes to .unknown — the single most important test in this slice")
    func missingKindKeyIsUnknown() throws {
        let json = """
            { "from": {"lat":1,"lng":2}, "to": {"lat":3,"lng":4},
              "travelCost": {"distanceMeters":10,"durationSeconds":5,"basisOfCost":"straightLine","answeredBy":"haversine"} }
            """.data(using: .utf8)!
        let dto = try JSONDecoder().decode(PathDTO.self, from: json)
        #expect(dto.kind == nil)
        #expect(toDomain(dto).kind == nil, ".unknown has no PathKind")
    }

    @Test("an explicit null kind also decodes to .unknown")
    func explicitNullKindIsUnknown() throws {
        let json = """
            { "kind": null, "from": {"lat":1,"lng":2}, "to": {"lat":3,"lng":4},
              "travelCost": {"distanceMeters":10,"durationSeconds":5,"basisOfCost":"straightLine","answeredBy":"haversine"} }
            """.data(using: .utf8)!
        let dto = try JSONDecoder().decode(PathDTO.self, from: json)
        #expect(dto.kind == nil)
    }

    @Test("a rail Path with a lineName decodes to .rail")
    func railWithLineName() throws {
        let json = """
            { "kind": "rail", "lineName": "Yamanote", "from": {"lat":1,"lng":2}, "to": {"lat":3,"lng":4},
              "travelCost": {"distanceMeters":10,"durationSeconds":5,"basisOfCost":"railNetwork","answeredBy":"osm-japan","costAsMinutes":0.083} }
            """.data(using: .utf8)!
        let dto = try JSONDecoder().decode(PathDTO.self, from: json)
        #expect(toDomain(dto).asRail?.lineName == "Yamanote", "the redundant wire-only costAsMinutes is ignored, not a decode error")
    }

    @Test("a rail Path with no lineName degrades to .other rather than failing")
    func railWithoutLineNameDegradesToOther() throws {
        let json = """
            { "kind": "rail", "from": {"lat":1,"lng":2}, "to": {"lat":3,"lng":4},
              "travelCost": {"distanceMeters":10,"durationSeconds":5,"basisOfCost":"railNetwork","answeredBy":"osm-japan"} }
            """.data(using: .utf8)!
        let dto = try JSONDecoder().decode(PathDTO.self, from: json)
        let path = toDomain(dto)
        #expect(path.asOther != nil)
        #expect(path.kind == .other)
    }

    @Test("a walking Path needs no lineName/operator")
    func walkingPath() throws {
        let json = """
            { "kind": "walking", "from": {"lat":1,"lng":2}, "to": {"lat":3,"lng":4},
              "travelCost": {"distanceMeters":10,"durationSeconds":5,"basisOfCost":"routingService","answeredBy":"osrm"} }
            """.data(using: .utf8)!
        let dto = try JSONDecoder().decode(PathDTO.self, from: json)
        #expect(toDomain(dto).asWalking != nil)
    }

    @Test("a full response batch decodes, including a null result and a retry index")
    func fullResponse() throws {
        let json = """
            { "results": [
                [{ "kind": "walking", "from": {"lat":1,"lng":2}, "to": {"lat":3,"lng":4},
                   "travelCost": {"distanceMeters":10,"durationSeconds":5,"basisOfCost":"routingService","answeredBy":"osrm"} }],
                null
              ],
              "retry": [1] }
            """.data(using: .utf8)!
        let response = try JSONDecoder().decode(PathGeometryResponseDTO.self, from: json)
        #expect(response.results.count == 2)
        #expect(response.results[1] == nil)
        #expect(response.retry == [1])
    }
}

@Suite("PathGeometryRequestDTO encoding")
struct PathGeometryRequestDTOEncodingTests {
    @Test("encodes roadProfile as a plain string, matching the server's expected shape")
    func encodesRoadProfileAsString() throws {
        let dto = PathGeometryRequestDTO(
            pairs: [PathPair(from: PathEndpoint(lat: 1, lng: 2), to: PathEndpoint(lat: 3, lng: 4))],
            roadProfile: .driving, journeyRoadKinds: []
        )
        let data = try JSONEncoder().encode(dto)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        #expect(json?["roadProfile"] as? String == "driving")
    }
}
