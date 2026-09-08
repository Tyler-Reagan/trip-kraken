import Testing
import TripKrakenKit

// Ported from `src/lib/db/index.ts`'s three DB-level uniqueness guarantees, now app-level
// validation per ADR-0040.

@Suite("checkTripNameCollision")
struct CheckTripNameCollisionTests {
    func summary(_ id: String, _ name: String, count: Int = 0) -> TripSummary {
        TripSummary(id: id, name: name, createdAt: .distantPast, locationCount: count)
    }

    @Test("no match returns nil")
    func noMatch() {
        #expect(checkTripNameCollision(name: "Osaka", existing: [summary("t1", "Tokyo")]) == nil)
    }

    @Test("one match suggests the Finder-style rename")
    func oneMatch() {
        let collision = checkTripNameCollision(name: "Tokyo", existing: [summary("t1", "Tokyo")])
        #expect(collision?.existingTrips.map(\.id) == ["t1"])
        #expect(collision?.suggestedName == "Tokyo (2)")
    }

    @Test("multiple matches are all returned — the new post-index reality")
    func multipleMatches() {
        let existing = [summary("t1", "Tokyo"), summary("t2", "Tokyo"), summary("t3", "Osaka")]
        let collision = checkTripNameCollision(name: "Tokyo", existing: existing)
        #expect(collision?.existingTrips.map(\.id).sorted() == ["t1", "t2"])
    }
}

@Suite("validateTripDateRange")
struct ValidateTripDateRangeTests {
    @Test("a same-day trip is valid")
    func sameDayIsValid() throws {
        try validateTripDateRange(startDate: "2026-10-01", endDate: "2026-10-01")
    }

    @Test("start after end throws")
    func startAfterEndThrows() {
        #expect(throws: TripCreationError.invalidDateRange(startDate: "2026-10-05", endDate: "2026-10-01")) {
            try validateTripDateRange(startDate: "2026-10-05", endDate: "2026-10-01")
        }
    }
}

@Suite("planTripEdgeAssignment")
struct PlanTripEdgeAssignmentTests {
    @Test("no prior holder: dates from the trip, nothing released")
    func noPriorHolder() throws {
        let airport = makeActivity(id: "airport")
        let trip = makeTrip(locations: [.activity(airport)], startDate: "2026-09-01", endDate: "2026-09-05")
        let plan = try planTripEdgeAssignment(trip, edge: .arrival, locationId: "airport", time: "10:00")
        #expect(plan.isoDateTime == "2026-09-01T10:00")
        #expect(plan.releasedLocationId == nil)
        #expect(!plan.releasedBecomesActivity)
    }

    @Test("bare date with no time")
    func noTime() throws {
        let airport = makeActivity(id: "airport")
        let trip = makeTrip(locations: [.activity(airport)], startDate: "2026-09-01", endDate: "2026-09-05")
        let plan = try planTripEdgeAssignment(trip, edge: .departure, locationId: "airport", time: nil)
        #expect(plan.isoDateTime == "2026-09-05")
    }

    @Test("prior holder with only this edge demotes to activity")
    func priorHolderDemotes() throws {
        let old = makeTransit(id: "old", arriveAt: "2026-09-01T09:00")
        let new = makeActivity(id: "new")
        let trip = makeTrip(locations: [.transit(old), .activity(new)])
        let plan = try planTripEdgeAssignment(trip, edge: .arrival, locationId: "new", time: nil)
        #expect(plan.releasedLocationId == "old")
        #expect(plan.releasedBecomesActivity, "old held no other edge, so releasing arrival leaves it a plain activity")
    }

    @Test("prior holder with both edges stays transit")
    func priorHolderStaysTransit() throws {
        let old = makeTransit(id: "old", arriveAt: "2026-09-01T09:00", departAt: "2026-09-05T18:00")
        let new = makeActivity(id: "new")
        let trip = makeTrip(locations: [.transit(old), .activity(new)])
        let plan = try planTripEdgeAssignment(trip, edge: .arrival, locationId: "new", time: nil)
        #expect(plan.releasedLocationId == "old")
        #expect(!plan.releasedBecomesActivity, "old still holds departAt, so it stays transit")
    }

    @Test("reassigning the same location to its own edge releases no one")
    func sameLocation() throws {
        let airport = makeTransit(id: "airport", arriveAt: "2026-09-01T09:00")
        let trip = makeTrip(locations: [.transit(airport)])
        let plan = try planTripEdgeAssignment(trip, edge: .arrival, locationId: "airport", time: "11:00")
        #expect(plan.releasedLocationId == nil)
    }

    @Test("malformed time is rejected")
    func badTime() {
        let trip = makeTrip(locations: [.activity(makeActivity(id: "a"))])
        #expect(throws: TransitValidationError.invalidTime("14:5")) {
            try planTripEdgeAssignment(trip, edge: .arrival, locationId: "a", time: "14:5")
        }
    }

    @Test("a Location outside the trip is rejected")
    func foreignLocation() {
        let trip = makeTrip(locations: [.activity(makeActivity(id: "a"))])
        #expect(throws: TransitValidationError.locationNotInTrip("ghost")) {
            try planTripEdgeAssignment(trip, edge: .arrival, locationId: "ghost", time: nil)
        }
    }
}

@Suite("planTripEdgeClear")
struct PlanTripEdgeClearTests {
    @Test("clearing the last edge relegates to activity")
    func clearsLastEdge() throws {
        let airport = makeTransit(id: "airport", arriveAt: "2026-09-01T09:00")
        let trip = makeTrip(locations: [.transit(airport)])
        let plan = try planTripEdgeClear(trip, edge: .arrival, locationId: "airport")
        #expect(plan.relegateToActivity)
    }

    @Test("clearing one of two edges keeps it transit")
    func keepsOtherEdge() throws {
        let airport = makeTransit(id: "airport", arriveAt: "2026-09-01T09:00", departAt: "2026-09-05T18:00")
        let trip = makeTrip(locations: [.transit(airport)])
        let plan = try planTripEdgeClear(trip, edge: .arrival, locationId: "airport")
        #expect(!plan.relegateToActivity)
    }

    @Test("a foreign Location is rejected")
    func foreignLocation() {
        let trip = makeTrip()
        #expect(throws: TransitValidationError.locationNotInTrip("ghost")) {
            try planTripEdgeClear(trip, edge: .arrival, locationId: "ghost")
        }
    }
}

@Suite("tripEdgeViolations")
struct TripEdgeViolationsTests {
    @Test("no violation when at most one Location holds each edge")
    func noViolation() {
        let a = makeTransit(id: "a", arriveAt: "2026-09-01T09:00")
        let d = makeTransit(id: "d", departAt: "2026-09-05T18:00")
        #expect(tripEdgeViolations(makeTrip(locations: [.transit(a), .transit(d)])).isEmpty)
    }

    @Test("two arrivals is representable and flagged now that the DB index is gone")
    func twoArrivals() {
        let a1 = makeTransit(id: "a1", arriveAt: "2026-09-01T09:00")
        let a2 = makeTransit(id: "a2", arriveAt: "2026-09-01T10:00")
        let violations = tripEdgeViolations(makeTrip(locations: [.transit(a1), .transit(a2)]))
        #expect(violations == [.multipleArrivals(["a1", "a2"])])
    }
}

@Suite("planJourneyRoadKindWrite")
struct PlanJourneyRoadKindWriteTests {
    @Test("insert canonicalizes the pair")
    func insertCanonicalizes() {
        let plan = planJourneyRoadKindWrite([], tripId: "t1", newId: "new1", from: "b", to: "a", kind: .driving)
        #expect(plan.insert?.locationAId == "a")
        #expect(plan.insert?.locationBId == "b")
        #expect(plan.deleteIds.isEmpty)
        #expect(plan.updateId == nil)
    }

    @Test("reverse-order lookup finds the same row")
    func reverseOrderFindsRow() {
        let existing = JourneyRoadKind(id: "r1", tripId: "t1", locationAId: "a", locationBId: "b", kind: .walking)
        let plan = planJourneyRoadKindWrite([existing], tripId: "t1", newId: "unused", from: "b", to: "a", kind: .driving)
        #expect(plan.updateId == "r1")
        #expect(plan.insert == nil)
    }

    @Test("duplicates collapse: keep the first, delete the rest")
    func duplicatesCollapse() {
        let dup1 = JourneyRoadKind(id: "r1", tripId: "t1", locationAId: "a", locationBId: "b", kind: .walking)
        let dup2 = JourneyRoadKind(id: "r2", tripId: "t1", locationAId: "a", locationBId: "b", kind: .driving)
        let plan = planJourneyRoadKindWrite([dup1, dup2], tripId: "t1", newId: "unused", from: "a", to: "b", kind: .driving)
        #expect(plan.updateId == "r1")
        #expect(plan.deleteIds == ["r2"])
    }

    @Test("nil kind deletes all rows for the pair")
    func nilKindDeletes() {
        let existing = JourneyRoadKind(id: "r1", tripId: "t1", locationAId: "a", locationBId: "b", kind: .walking)
        let plan = planJourneyRoadKindWrite([existing], tripId: "t1", newId: "unused", from: "a", to: "b", kind: nil)
        #expect(plan.deleteIds == ["r1"])
        #expect(plan.insert == nil)
        #expect(plan.updateId == nil)
    }

    @Test("a different trip's row for the same pair is untouched")
    func scopedByTrip() {
        let otherTrip = JourneyRoadKind(id: "r1", tripId: "t2", locationAId: "a", locationBId: "b", kind: .walking)
        let plan = planJourneyRoadKindWrite([otherTrip], tripId: "t1", newId: "new1", from: "a", to: "b", kind: .driving)
        #expect(plan.insert != nil, "t1 has no row yet, regardless of t2's")
        #expect(plan.deleteIds.isEmpty)
    }
}

@Suite("validateLodgingDates")
struct ValidateLodgingDatesTests {
    @Test("a valid stay within trip dates passes")
    func validStay() throws {
        let trip = makeTrip(locations: [.activity(makeActivity(id: "hotel"))], startDate: "2026-09-01", endDate: "2026-09-05")
        try validateLodgingDates(trip, locationId: "hotel", checkInDate: "2026-09-01", checkOutDate: "2026-09-03")
    }

    @Test("adjacent same-day switch does not overlap")
    func adjacentSwitchPasses() throws {
        let existing = makeLodging(id: "hotelA", checkIn: "2026-09-01", checkOut: "2026-09-03")
        let trip = makeTrip(
            locations: [.lodging(existing), .activity(makeActivity(id: "hotelB"))],
            startDate: "2026-09-01", endDate: "2026-09-05"
        )
        try validateLodgingDates(trip, locationId: "hotelB", checkInDate: "2026-09-03", checkOutDate: "2026-09-05")
    }

    @Test("unparseable date is rejected")
    func unparseableDate() {
        let trip = makeTrip(locations: [.activity(makeActivity(id: "hotel"))])
        #expect(throws: LodgingValidationError.unparseableDate("2026-13-40")) {
            try validateLodgingDates(trip, locationId: "hotel", checkInDate: "2026-13-40", checkOutDate: "2026-09-03")
        }
    }

    @Test("check-in must be before check-out")
    func checkInNotBeforeCheckOut() {
        let trip = makeTrip(locations: [.activity(makeActivity(id: "hotel"))])
        #expect(throws: LodgingValidationError.checkInNotBeforeCheckOut) {
            try validateLodgingDates(trip, locationId: "hotel", checkInDate: "2026-09-03", checkOutDate: "2026-09-03")
        }
    }

    @Test("a stay entirely outside the trip's dates is rejected")
    func outsideTripDates() {
        let trip = makeTrip(locations: [.activity(makeActivity(id: "hotel"))], startDate: "2026-09-01", endDate: "2026-09-05")
        #expect(throws: LodgingValidationError.outsideTripDates(tripStart: "2026-09-01", tripEnd: "2026-09-05")) {
            try validateLodgingDates(trip, locationId: "hotel", checkInDate: "2026-09-10", checkOutDate: "2026-09-12")
        }
    }

    @Test("checking out the morning of the trip's start still counts as outside")
    func checkoutAtTripStartIsOutside() {
        let trip = makeTrip(locations: [.activity(makeActivity(id: "hotel"))], startDate: "2026-09-01", endDate: "2026-09-05")
        #expect(throws: LodgingValidationError.outsideTripDates(tripStart: "2026-09-01", tripEnd: "2026-09-05")) {
            try validateLodgingDates(trip, locationId: "hotel", checkInDate: "2026-08-30", checkOutDate: "2026-09-01")
        }
    }

    @Test("a foreign Location is rejected")
    func foreignLocation() {
        let trip = makeTrip(startDate: "2026-09-01", endDate: "2026-09-05")
        #expect(throws: LodgingValidationError.locationNotInTrip("ghost")) {
            try validateLodgingDates(trip, locationId: "ghost", checkInDate: "2026-09-01", checkOutDate: "2026-09-03")
        }
    }

    @Test("overlapping an existing lodging is rejected")
    func overlapsExisting() {
        let existing = makeLodging(id: "hotelA", checkIn: "2026-09-01", checkOut: "2026-09-04")
        let trip = makeTrip(
            locations: [.lodging(existing), .activity(makeActivity(id: "hotelB"))],
            startDate: "2026-09-01", endDate: "2026-09-05"
        )
        #expect(throws: LodgingValidationError.overlapsExistingLodging(locationId: "hotelA")) {
            try validateLodgingDates(trip, locationId: "hotelB", checkInDate: "2026-09-03", checkOutDate: "2026-09-05")
        }
    }
}
