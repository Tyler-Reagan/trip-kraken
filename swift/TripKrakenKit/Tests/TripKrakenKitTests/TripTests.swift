import Testing
import TripKrakenKit

// Ported from `src/types/index.test.ts` — "tripEdgesOf: the one place 'the Trip's two edges' is
// looked up (ADR-0028)".
@Suite("tripEdgesOf")
struct TripEdgesOfTests {
    @Test("distinct arrival and departure")
    func distinctEdges() {
        let arrival = makeTransit(id: "airport-in", arriveAt: "2026-09-01T10:00")
        let departure = makeTransit(id: "airport-out", departAt: "2026-09-05T18:00")
        let edges = tripEdgesOf(makeTrip(locations: [.transit(arrival), .transit(departure)]))
        #expect(edges.arrival?.base.id == "airport-in")
        #expect(edges.departure?.base.id == "airport-out")
    }

    @Test("round trip through one airport: one Location answers both")
    func roundTrip() {
        let airport = makeTransit(id: "airport", arriveAt: "2026-09-01T10:00", departAt: "2026-09-05T18:00")
        let edges = tripEdgesOf(makeTrip(locations: [.transit(airport)]))
        #expect(edges.arrival?.base.id == "airport")
        #expect(edges.departure?.base.id == "airport")
        #expect(edges.arrival == edges.departure)
    }

    @Test("no edges designated")
    func noEdges() {
        let edges = tripEdgesOf(makeTrip())
        #expect(edges.arrival == nil)
        #expect(edges.departure == nil)
    }
}

// Ported from `getEnrichableLocations` (`src/lib/db/index.ts`) — ADR-0044.
@Suite("enrichableLocations")
struct EnrichableLocationsTests {
    private func activity(id: String, status: EnrichmentStatus) -> Location {
        .activity(Activity(base: LocationBase(id: id, tripId: "t1", name: "Loc \(id)", enrichmentStatus: status)))
    }

    @Test("pending and failed are eligible; done is not")
    func filtersByStatus() {
        let trip = makeTrip(locations: [
            activity(id: "a", status: .pending),
            activity(id: "b", status: .failed),
            activity(id: "c", status: .done),
        ])
        #expect(enrichableLocations(trip).map(\.base.id) == ["a", "b"])
    }

    @Test("no eligible locations answers empty, not every location")
    func noneEligible() {
        let trip = makeTrip(locations: [activity(id: "a", status: .done)])
        #expect(enrichableLocations(trip).isEmpty)
    }
}

@Suite("date helpers")
struct DateHelperTests {
    @Test func addDays() {
        #expect(addDaysIso("2026-09-01", 4) == "2026-09-05")
        #expect(addDaysIso("2026-09-01", -1) == "2026-08-31")
    }

    @Test("crosses a year boundary")
    func addDaysAcrossYear() {
        #expect(addDaysIso("2026-12-30", 3) == "2027-01-02")
    }

    @Test func numDays() {
        #expect(numDaysOf(startDate: "2026-09-01", endDate: "2026-09-05") == 5)
        #expect(numDaysOf(startDate: "2026-09-01", endDate: "2026-09-01") == 1)
    }

    @Test func tripDatesAreInclusiveAndOrdered() {
        #expect(tripDates(startDate: "2026-09-01", endDate: "2026-09-03") == ["2026-09-01", "2026-09-02", "2026-09-03"])
    }

    @Test func dayNumber() {
        #expect(dayNumberOf(startDate: "2026-09-01", date: "2026-09-01") == 1)
        #expect(dayNumberOf(startDate: "2026-09-01", date: "2026-09-05") == 5)
    }
}

@Suite("lodging night coverage")
struct LodgingNightTests {
    @Test("half-open [checkIn, checkOut)")
    func halfOpen() {
        let l = makeLodging(id: "hotel", checkIn: "2026-09-01", checkOut: "2026-09-03")
        #expect(lodgingCoversNight(l, "2026-09-01"))
        #expect(lodgingCoversNight(l, "2026-09-02"))
        #expect(!lodgingCoversNight(l, "2026-09-03"), "checkout date is not a covered night")
        #expect(!lodgingCoversNight(l, "2026-08-31"))
    }

    @Test("no lodging covers a night with no match")
    func noMatch() {
        let l = makeLodging(id: "hotel", checkIn: "2026-09-01", checkOut: "2026-09-03")
        #expect(lodgingOnNight([l], on: "2026-09-05") == nil)
        #expect(lodgingOnNight([l], on: "2026-09-01")?.base.id == "hotel")
    }
}

@Suite("deriveTripPlanDays")
struct DeriveTripPlanDaysTests {
    @Test("a travel day gets a checkInWaypoint, a static day doesn't")
    func travelDay() {
        let hotelA = makeLodging(id: "hotelA", checkIn: "2026-09-01", checkOut: "2026-09-02")
        let hotelB = makeLodging(id: "hotelB", checkIn: "2026-09-02", checkOut: "2026-09-04")
        let trip = makeTrip(
            locations: [.lodging(hotelA), .lodging(hotelB)],
            startDate: "2026-09-01", endDate: "2026-09-03"
        )
        let days = deriveTripPlanDays(trip)
        #expect(days.count == 3)

        // Day 2: woke at hotelA, sleeps at hotelB — a travel day.
        #expect(days[1].checkInWaypoint?.base.id == "hotelB")

        // Day 3: woke at hotelB, still sleeps at hotelB — not a travel day.
        #expect(days[2].checkInWaypoint == nil)
    }

    @Test("day 1 starts at the trip's arrival when one is designated")
    func day1StartsAtArrival() {
        let arrival = makeTransit(id: "airport", arriveAt: "2026-09-01T10:00")
        let trip = makeTrip(locations: [.transit(arrival)], startDate: "2026-09-01", endDate: "2026-09-02")
        let days = deriveTripPlanDays(trip)
        #expect(days[0].startAnchor?.base.id == "airport")
    }

    @Test("stops are ordered and only include placed activities")
    func stopsOrdered() {
        let activity = makeActivity(id: "museum")
        let placement = Placement(id: "p1", tripId: "t1", locationId: "museum", date: "2026-09-01", order: 0)
        let trip = makeTrip(
            locations: [.activity(activity)], placements: [placement],
            startDate: "2026-09-01", endDate: "2026-09-01"
        )
        let days = deriveTripPlanDays(trip)
        #expect(days[0].stops.map(\.location.base.id) == ["museum"])
    }
}

@Suite("rolesOf")
struct RolesOfTests {
    @Test func lodgingIsAlwaysLodgingRole() {
        #expect(rolesOf(.lodging(makeLodging(id: "l", checkIn: "2026-09-01", checkOut: "2026-09-02"))) == [.lodging])
    }

    @Test func activityHasNoRoles() {
        #expect(rolesOf(.activity(makeActivity(id: "a"))) == [])
    }

    @Test func transitReflectsWhicheverFieldsAreSet() {
        let both = makeTransit(id: "t", arriveAt: "2026-09-01T10:00", departAt: "2026-09-05T18:00")
        #expect(rolesOf(.transit(both)) == [.arrival, .departure])

        let neither = makeTransit(id: "t2")
        #expect(rolesOf(.transit(neither)) == [])
    }
}
