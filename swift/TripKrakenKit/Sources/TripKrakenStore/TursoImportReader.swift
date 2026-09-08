import Foundation
import SQLite3
import TripKrakenKit

public enum TursoImportError: Error, Sendable, Hashable {
    case cannotOpenDatabase
    case queryFailed(String)
    /// Mirrors `toLocation`'s own thrown "DB inconsistency" branch (`TripMapping.swift`) — a
    /// lodging-kind row with no dates is a real data problem worth surfacing plainly, not silently
    /// coercing to a plain activity and losing that this Location was ever lodging.
    case lodgingMissingDates(locationId: String)
}

/// Reads a one-time Turso/libSQL SQLite export — the exact production schema
/// (`src/lib/db/schema.ts`) this app's Swift domain model was ported from 1:1, so every column
/// maps straight onto `LocationBase`/`TripWithDetails` with no intermediate DTO layer. Read-only:
/// never writes back to the source file. Not an ongoing sync path — ADR-0038 already keeps Turso
/// itself out of the Swift client entirely — this exists to load real trip data once, so gaps
/// against the web app's actual behavior/UI become visible against real data instead of the
/// sample fixture.
public struct TursoImportReader: Sendable {
    private let path: String

    public init(path: String) {
        self.path = path
    }

    public func readTrips() throws -> [TripWithDetails] {
        var db: OpaquePointer?
        guard sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK, let db else {
            throw TursoImportError.cannotOpenDatabase
        }
        defer { sqlite3_close(db) }

        var trips = try readBareTrips(db)
        for index in trips.indices {
            let tripId = trips[index].id
            trips[index].locations = try readLocations(db, tripId: tripId)
            trips[index].placements = try readPlacements(db, tripId: tripId)
            trips[index].journeyRoadKinds = try readJourneyRoadKinds(db, tripId: tripId)
        }
        return trips
    }

    private func readBareTrips(_ db: OpaquePointer) throws -> [TripWithDetails] {
        try query(
            db,
            #"SELECT id, name, sourceUrl, startDate, endDate, dayLabels, roadProfile, transitCaveatDismissed, hasJrPass, createdAt, updatedAt FROM "Trip""#
        ) { stmt in
            TripWithDetails(
                id: text(stmt, 0) ?? "", name: text(stmt, 1) ?? "", sourceUrl: text(stmt, 2),
                startDate: text(stmt, 3) ?? "", endDate: text(stmt, 4) ?? "",
                dayLabels: decodeJSON([String: String].self, text(stmt, 5)),
                roadProfile: RoadProfile(rawValue: text(stmt, 6) ?? "") ?? .walking,
                transitCaveatDismissed: bool(stmt, 7), hasJrPass: bool(stmt, 8),
                createdAt: sqliteDateTime(text(stmt, 9)), updatedAt: sqliteDateTime(text(stmt, 10)),
                locations: [], placements: [], journeyRoadKinds: []
            )
        }
    }

    private func readLocations(_ db: OpaquePointer, tripId: String) throws -> [Location] {
        try query(
            db,
            #"SELECT id, tripId, kind, name, address, lat, lng, placeId, excluded, note, rating, reviewCount, categories, visitDuration, openTime, closeTime, hoursJson, phone, checkInDate, checkOutDate, arriveAt, departAt, enrichmentStatus, enrichmentError FROM "Location" WHERE tripId = ? ORDER BY name"#,
            bind: { sqlite3_bind_text($0, 1, tripId, -1, SQLITE_TRANSIENT) }
        ) { stmt in
            let base = LocationBase(
                id: text(stmt, 0) ?? "", tripId: text(stmt, 1) ?? "", name: text(stmt, 3) ?? "",
                address: text(stmt, 4), lat: double(stmt, 5), lng: double(stmt, 6),
                placeId: text(stmt, 7), excluded: bool(stmt, 8), note: text(stmt, 9),
                rating: double(stmt, 10), reviewCount: int(stmt, 11),
                categories: decodeJSON([String].self, text(stmt, 12)), visitDuration: int(stmt, 13),
                openTime: text(stmt, 14), closeTime: text(stmt, 15),
                hoursJson: decodeJSON([String: DayHours].self, text(stmt, 16)), phone: text(stmt, 17),
                enrichmentStatus: EnrichmentStatus(rawValue: text(stmt, 22) ?? "") ?? .pending,
                enrichmentError: text(stmt, 23)
            )
            switch text(stmt, 2) {
            case "transit":
                return .transit(Transit(base: base, authored: true, arriveAt: text(stmt, 20), departAt: text(stmt, 21)))
            case "lodging":
                guard let checkIn = text(stmt, 18), let checkOut = text(stmt, 19) else {
                    throw TursoImportError.lodgingMissingDates(locationId: base.id)
                }
                return .lodging(Lodging(base: base, checkInDate: checkIn, checkOutDate: checkOut))
            default:
                return .activity(Activity(base: base))
            }
        }
    }

    private func readPlacements(_ db: OpaquePointer, tripId: String) throws -> [Placement] {
        try query(
            db, #"SELECT id, tripId, locationId, date, "order" FROM "Placement" WHERE tripId = ?"#,
            bind: { sqlite3_bind_text($0, 1, tripId, -1, SQLITE_TRANSIENT) }
        ) { stmt in
            Placement(
                id: text(stmt, 0) ?? "", tripId: text(stmt, 1) ?? "", locationId: text(stmt, 2) ?? "",
                date: text(stmt, 3) ?? "", order: int(stmt, 4) ?? 0
            )
        }
    }

    private func readJourneyRoadKinds(_ db: OpaquePointer, tripId: String) throws -> [JourneyRoadKind] {
        try query(
            db, #"SELECT id, tripId, locationAId, locationBId, kind FROM "JourneyRoadKind" WHERE tripId = ?"#,
            bind: { sqlite3_bind_text($0, 1, tripId, -1, SQLITE_TRANSIENT) }
        ) { stmt in
            JourneyRoadKind(
                id: text(stmt, 0) ?? "", tripId: text(stmt, 1) ?? "", locationAId: text(stmt, 2) ?? "",
                locationBId: text(stmt, 3) ?? "", kind: RoadProfile(rawValue: text(stmt, 4) ?? "") ?? .walking
            )
        }
    }
}

// MARK: - SQLite3 C-API helpers

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

private func query<T>(
    _ db: OpaquePointer, _ sql: String, bind: (OpaquePointer) -> Void = { _ in },
    row: (OpaquePointer) throws -> T
) throws -> [T] {
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else {
        throw TursoImportError.queryFailed(String(cString: sqlite3_errmsg(db)))
    }
    defer { sqlite3_finalize(stmt) }
    bind(stmt)
    var results: [T] = []
    while sqlite3_step(stmt) == SQLITE_ROW {
        results.append(try row(stmt))
    }
    return results
}

private func text(_ stmt: OpaquePointer, _ index: Int32) -> String? {
    guard let cstr = sqlite3_column_text(stmt, index) else { return nil }
    return String(cString: cstr)
}

private func double(_ stmt: OpaquePointer, _ index: Int32) -> Double? {
    sqlite3_column_type(stmt, index) == SQLITE_NULL ? nil : sqlite3_column_double(stmt, index)
}

private func int(_ stmt: OpaquePointer, _ index: Int32) -> Int? {
    sqlite3_column_type(stmt, index) == SQLITE_NULL ? nil : Int(sqlite3_column_int64(stmt, index))
}

private func bool(_ stmt: OpaquePointer, _ index: Int32) -> Bool {
    sqlite3_column_int64(stmt, index) != 0
}

private func decodeJSON<T: Decodable>(_ type: T.Type, _ json: String?) -> T? {
    guard let json, let data = json.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
}

/// Drizzle's `datetime('now')` default writes SQLite's own "YYYY-MM-DD HH:MM:SS" format (UTC,
/// space-separated, no 'T') — distinct from `IsoDate`'s date-only convention elsewhere in this
/// module. Falls back to now rather than throwing: an unparseable timestamp on a one-time import
/// of otherwise-good trip data isn't worth aborting the whole import over.
private func sqliteDateTime(_ raw: String?) -> Date {
    guard let raw else { return Date() }
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.timeZone = TimeZone(identifier: "UTC")
    formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
    return formatter.date(from: raw) ?? Date()
}
