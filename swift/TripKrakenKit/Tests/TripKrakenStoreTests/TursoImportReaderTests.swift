import Foundation
import SQLite3
import Testing
import TripKrakenKit

@testable import TripKrakenStore

// Unlike the MapKit providers (`MKRoute`/`MKMapItem` have no public initializer, hence their
// fake-`Requesting`-protocol seam), a real SQLite file is fully constructible in a test — so these
// tests exercise `TursoImportReader`'s actual SQLite3 C-API code paths against a real temporary
// database, not a fake.

private let fixtureSchema = """
    CREATE TABLE "Trip" (
      id TEXT PRIMARY KEY, name TEXT, sourceUrl TEXT, startDate TEXT, endDate TEXT,
      dayLabels TEXT, roadProfile TEXT, transitCaveatDismissed INTEGER, hasJrPass INTEGER,
      createdAt TEXT, updatedAt TEXT
    );
    CREATE TABLE "Location" (
      id TEXT PRIMARY KEY, tripId TEXT, kind TEXT, name TEXT, address TEXT, lat REAL, lng REAL,
      placeId TEXT, excluded INTEGER, note TEXT, rating REAL, reviewCount INTEGER, categories TEXT,
      visitDuration INTEGER, openTime TEXT, closeTime TEXT, hoursJson TEXT, phone TEXT,
      checkInDate TEXT, checkOutDate TEXT, arriveAt TEXT, departAt TEXT, enrichmentStatus TEXT,
      enrichmentError TEXT
    );
    CREATE TABLE "Placement" (
      id TEXT PRIMARY KEY, tripId TEXT, locationId TEXT, date TEXT, "order" INTEGER
    );
    CREATE TABLE "JourneyRoadKind" (
      id TEXT PRIMARY KEY, tripId TEXT, locationAId TEXT, locationBId TEXT, kind TEXT
    );
    """

private func makeFixtureDatabase(inserts: String) throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".sqlite")
    var db: OpaquePointer?
    guard sqlite3_open(url.path, &db) == SQLITE_OK, let db else {
        throw TursoImportError.cannotOpenDatabase
    }
    defer { sqlite3_close(db) }
    guard sqlite3_exec(db, fixtureSchema + inserts, nil, nil, nil) == SQLITE_OK else {
        throw TursoImportError.queryFailed(String(cString: sqlite3_errmsg(db)))
    }
    return url
}

@Suite("TursoImportReader")
struct TursoImportReaderTests {
    @Test("reads a Trip with one of every Location kind, a Placement, and a JourneyRoadKind")
    func readsFullTrip() throws {
        let url = try makeFixtureDatabase(inserts: """
            INSERT INTO "Trip" (id, name, sourceUrl, startDate, endDate, dayLabels, roadProfile, transitCaveatDismissed, hasJrPass, createdAt, updatedAt)
            VALUES ('t1', 'Kyoto', NULL, '2026-10-01', '2026-10-05', '{"2026-10-01":"Arrival"}', 'driving', 1, 1, '2026-09-01 10:00:00', '2026-09-02 11:30:00');

            INSERT INTO "Location" (id, tripId, kind, name, address, lat, lng, placeId, excluded, note, rating, reviewCount, categories, visitDuration, openTime, closeTime, hoursJson, phone, checkInDate, checkOutDate, arriveAt, departAt, enrichmentStatus, enrichmentError)
            VALUES ('loc-activity', 't1', 'activity', 'Fushimi Inari', '68 Fukakusa', 34.9, 135.7, 'place-1', 0, 'Bring good shoes', 4.6, 1200, '["shrine","tourist_attraction"]', 90, '09:00', '17:00', NULL, '555-0100', NULL, NULL, NULL, NULL, 'done', NULL);

            INSERT INTO "Location" (id, tripId, kind, name, address, lat, lng, placeId, excluded, note, rating, reviewCount, categories, visitDuration, openTime, closeTime, hoursJson, phone, checkInDate, checkOutDate, arriveAt, departAt, enrichmentStatus, enrichmentError)
            VALUES ('loc-lodging', 't1', 'lodging', 'Ryokan Yamato', NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-10-01', '2026-10-05', NULL, NULL, 'pending', NULL);

            INSERT INTO "Location" (id, tripId, kind, name, address, lat, lng, placeId, excluded, note, rating, reviewCount, categories, visitDuration, openTime, closeTime, hoursJson, phone, checkInDate, checkOutDate, arriveAt, departAt, enrichmentStatus, enrichmentError)
            VALUES ('loc-transit', 't1', 'transit', 'Kansai Airport', NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-10-01T14:00', NULL, 'failed', 'No match found');

            INSERT INTO "Placement" (id, tripId, locationId, date, "order")
            VALUES ('p1', 't1', 'loc-activity', '2026-10-02', 0);

            INSERT INTO "JourneyRoadKind" (id, tripId, locationAId, locationBId, kind)
            VALUES ('jrk1', 't1', 'loc-activity', 'loc-lodging', 'walking');
            """)
        defer { try? FileManager.default.removeItem(at: url) }

        let trips = try TursoImportReader(path: url.path).readTrips()

        #expect(trips.count == 1)
        let trip = trips[0]
        #expect(trip.name == "Kyoto")
        #expect(trip.startDate == "2026-10-01")
        #expect(trip.roadProfile == .driving)
        #expect(trip.transitCaveatDismissed == true)
        #expect(trip.hasJrPass == true)
        #expect(trip.dayLabels == ["2026-10-01": "Arrival"])

        let activity = trip.locations.first { $0.base.id == "loc-activity" }?.asActivity
        #expect(activity?.base.rating == 4.6)
        #expect(activity?.base.reviewCount == 1200)
        #expect(activity?.base.categories == ["shrine", "tourist_attraction"])
        #expect(activity?.base.visitDuration == 90)

        let lodging = trip.locations.first { $0.base.id == "loc-lodging" }?.asLodging
        #expect(lodging?.checkInDate == "2026-10-01")
        #expect(lodging?.checkOutDate == "2026-10-05")

        let transit = trip.locations.first { $0.base.id == "loc-transit" }?.asTransit
        #expect(transit?.arriveAt == "2026-10-01T14:00")
        #expect(transit?.base.enrichmentStatus == .failed)
        #expect(transit?.base.enrichmentError == "No match found")

        #expect(trip.placements.map(\.id) == ["p1"])
        #expect(trip.journeyRoadKinds.map(\.id) == ["jrk1"])
    }

    @Test("a lodging Location missing its dates throws, rather than silently becoming an activity")
    func lodgingMissingDatesThrows() throws {
        let url = try makeFixtureDatabase(inserts: """
            INSERT INTO "Trip" (id, name, sourceUrl, startDate, endDate, dayLabels, roadProfile, transitCaveatDismissed, hasJrPass, createdAt, updatedAt)
            VALUES ('t1', 'Broken Trip', NULL, '2026-10-01', '2026-10-05', NULL, 'walking', 0, 0, '2026-09-01 10:00:00', '2026-09-01 10:00:00');

            INSERT INTO "Location" (id, tripId, kind, name, address, lat, lng, placeId, excluded, note, rating, reviewCount, categories, visitDuration, openTime, closeTime, hoursJson, phone, checkInDate, checkOutDate, arriveAt, departAt, enrichmentStatus, enrichmentError)
            VALUES ('loc-bad', 't1', 'lodging', 'Mystery Hotel', NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'done', NULL);
            """)
        defer { try? FileManager.default.removeItem(at: url) }

        #expect(throws: TursoImportError.lodgingMissingDates(locationId: "loc-bad")) {
            try TursoImportReader(path: url.path).readTrips()
        }
    }

    @Test("multiple trips in one file are all read")
    func readsMultipleTrips() throws {
        let url = try makeFixtureDatabase(inserts: """
            INSERT INTO "Trip" (id, name, sourceUrl, startDate, endDate, dayLabels, roadProfile, transitCaveatDismissed, hasJrPass, createdAt, updatedAt)
            VALUES ('t1', 'Trip One', NULL, '2026-10-01', '2026-10-05', NULL, 'walking', 0, 0, '2026-09-01 10:00:00', '2026-09-01 10:00:00');
            INSERT INTO "Trip" (id, name, sourceUrl, startDate, endDate, dayLabels, roadProfile, transitCaveatDismissed, hasJrPass, createdAt, updatedAt)
            VALUES ('t2', 'Trip Two', NULL, '2026-11-01', '2026-11-05', NULL, 'walking', 0, 0, '2026-09-01 10:00:00', '2026-09-01 10:00:00');
            """)
        defer { try? FileManager.default.removeItem(at: url) }

        let trips = try TursoImportReader(path: url.path).readTrips()

        #expect(trips.map(\.name).sorted() == ["Trip One", "Trip Two"])
    }

    @Test("a nonexistent file throws cannotOpenDatabase")
    func nonexistentFileThrows() {
        #expect(throws: TursoImportError.cannotOpenDatabase) {
            try TursoImportReader(path: "/nonexistent/path.sqlite").readTrips()
        }
    }
}
