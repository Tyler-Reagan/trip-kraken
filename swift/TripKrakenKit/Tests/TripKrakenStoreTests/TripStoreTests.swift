import Foundation
import SQLite3
import Testing
import TripKrakenKit

@testable import TripKrakenStore

@MainActor
@Suite("TripStore.seedIfEmpty")
struct SeedIfEmptyTests {
    @Test("seeds an empty store and loads it")
    func seedsEmptyStore() throws {
        let store = try makeInMemoryStore()
        let id = try store.seedIfEmpty(with: makeTrip(locations: [.activity(makeActivity(id: "a"))]))
        #expect(id == "t1")
        #expect(store.trip?.id == "t1")
        #expect(store.days.count == numDaysOf(startDate: "2026-09-01", endDate: "2026-09-05"))
    }

    @Test("never overwrites an existing trip")
    func doesNotOverwriteExisting() throws {
        let container = try TripKrakenContainer.inMemory()
        let store1 = TripStore(container: container)
        try store1.seedIfEmpty(with: makeTrip(id: "real-trip"))

        let store2 = TripStore(container: container)
        let id = try store2.seedIfEmpty(with: makeTrip(id: "fixture-trip"))
        #expect(id == "real-trip", "an existing trip is loaded, never replaced by the seed")
    }
}

@MainActor
@Suite("TripStore.load")
struct LoadTests {
    @Test("throws for an unknown trip id")
    func unknownTrip() throws {
        let store = try makeInMemoryStore()
        #expect(throws: StoreMappingError.tripNotFound("ghost")) {
            try store.load(tripId: "ghost")
        }
    }

    @Test("populates days and metros alongside the trip")
    func populatesDerivations() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(startDate: "2026-09-01", endDate: "2026-09-03"))
        #expect(store.days.count == 3)
    }
}

@MainActor
@Suite("TripStore.createTrip")
struct CreateTripTests {
    @Test("creates a blank-slate trip and switches to it")
    func createsAndSwitches() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(id: "existing"))
        let id = try store.createTrip(name: "Kyoto", startDate: "2026-10-01", endDate: "2026-10-05")

        #expect(store.trip?.id == id)
        #expect(store.trip?.name == "Kyoto")
        #expect(store.trip?.locations.isEmpty == true)
        #expect((try store.listTripSummaries()).count == 2, "the existing trip is kept, not replaced")
    }

    @Test("rejects an end date before the start date")
    func rejectsInvertedRange() throws {
        let store = try makeInMemoryStore()
        #expect(throws: TripCreationError.invalidDateRange(startDate: "2026-10-05", endDate: "2026-10-01")) {
            try store.createTrip(name: "Kyoto", startDate: "2026-10-05", endDate: "2026-10-01")
        }
    }
}

@MainActor
@Suite("TripStore.importFromTursoExport")
struct ImportFromTursoExportTests {
    @Test("imports a Trip from a real SQLite file and switches to it")
    func importsAndSwitches() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".sqlite")
        var db: OpaquePointer?
        #expect(sqlite3_open(url.path, &db) == SQLITE_OK)
        defer { sqlite3_close(db); try? FileManager.default.removeItem(at: url) }
        let sql = """
            CREATE TABLE "Trip" (id TEXT PRIMARY KEY, name TEXT, sourceUrl TEXT, startDate TEXT, endDate TEXT, dayLabels TEXT, roadProfile TEXT, transitCaveatDismissed INTEGER, hasJrPass INTEGER, createdAt TEXT, updatedAt TEXT);
            CREATE TABLE "Location" (id TEXT PRIMARY KEY, tripId TEXT, kind TEXT, name TEXT, address TEXT, lat REAL, lng REAL, placeId TEXT, excluded INTEGER, note TEXT, rating REAL, reviewCount INTEGER, categories TEXT, visitDuration INTEGER, openTime TEXT, closeTime TEXT, hoursJson TEXT, phone TEXT, checkInDate TEXT, checkOutDate TEXT, arriveAt TEXT, departAt TEXT, enrichmentStatus TEXT, enrichmentError TEXT);
            CREATE TABLE "Placement" (id TEXT PRIMARY KEY, tripId TEXT, locationId TEXT, date TEXT, "order" INTEGER);
            CREATE TABLE "JourneyRoadKind" (id TEXT PRIMARY KEY, tripId TEXT, locationAId TEXT, locationBId TEXT, kind TEXT);
            INSERT INTO "Trip" (id, name, sourceUrl, startDate, endDate, dayLabels, roadProfile, transitCaveatDismissed, hasJrPass, createdAt, updatedAt)
            VALUES ('t1', 'Kyoto', NULL, '2026-10-01', '2026-10-05', NULL, 'walking', 0, 0, '2026-09-01 10:00:00', '2026-09-01 10:00:00');
            """
        #expect(sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK)

        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(id: "existing"))
        let ids = try store.importFromTursoExport(path: url.path)

        #expect(ids == ["t1"])
        #expect(store.trip?.id == "t1")
        #expect(store.trip?.name == "Kyoto")
        #expect((try store.listTripSummaries()).count == 2, "the existing trip is kept, not replaced")
    }
}

@MainActor
@Suite("TripStore.listTripSummaries")
struct ListTripSummariesTests {
    @Test("counts locations per trip")
    func countsLocations() throws {
        let store = try makeInMemoryStore()
        try store.seedIfEmpty(with: makeTrip(locations: [.activity(makeActivity(id: "a")), .activity(makeActivity(id: "b"))]))
        let summaries = try store.listTripSummaries()
        #expect(summaries.first?.locationCount == 2)
    }

    @Test("an empty store has no summaries")
    func emptyStore() throws {
        let store = try makeInMemoryStore()
        #expect(try store.listTripSummaries().isEmpty)
    }
}
