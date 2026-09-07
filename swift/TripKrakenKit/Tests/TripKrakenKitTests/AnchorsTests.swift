import Testing
import TripKrakenKit

@Suite("anchorsOnDate")
struct AnchorsOnDateTests {
    @Test("day 1 starts at the arrival when designated, even with no woke lodging")
    func day1PrefersArrival() {
        let result = anchorsOnDate(
            dayNumber: 1, numDays: 5, wokeLodgingId: nil, sleepLodgingId: "hotelA",
            arrivalId: "airport", departureId: nil
        )
        #expect(result.startId == "airport")
    }

    @Test("a mid-trip day with no travel has no end anchor")
    func midTripNoTravel() {
        let result = anchorsOnDate(
            dayNumber: 3, numDays: 5, wokeLodgingId: "hotelA", sleepLodgingId: "hotelA",
            arrivalId: nil, departureId: nil
        )
        #expect(result.endId == nil)
    }

    @Test("a travel day ends at the new lodging")
    func travelDayEndsAtNewLodging() {
        let result = anchorsOnDate(
            dayNumber: 2, numDays: 5, wokeLodgingId: "hotelA", sleepLodgingId: "hotelB",
            arrivalId: nil, departureId: nil
        )
        #expect(result.endId == "hotelB")
    }

    @Test("the last day ends at the departure when designated, overriding travel-day logic")
    func lastDayPrefersDeparture() {
        let result = anchorsOnDate(
            dayNumber: 5, numDays: 5, wokeLodgingId: "hotelA", sleepLodgingId: "hotelB",
            arrivalId: nil, departureId: "airport"
        )
        #expect(result.endId == "airport")
    }
}

@Suite("anchorSubtext")
struct AnchorSubtextTests {
    @Test func checkinIsAlwaysDropBags() {
        #expect(anchorSubtext(role: .checkin, location: .activity(makeActivity(id: "a"))) == "Check-in · drop bags")
    }

    @Test func startWordingDependsOnEdgeVsLodging() {
        #expect(anchorSubtext(role: .start, location: .lodging(makeLodging(id: "l", checkIn: "2026-09-01", checkOut: "2026-09-02"))) == "Start of day")
        #expect(anchorSubtext(role: .start, location: .transit(makeTransit(id: "t", arriveAt: "2026-09-01T10:00"))) == "Arrive")
    }

    @Test func endWordingDependsOnEdgeVsLodging() {
        #expect(anchorSubtext(role: .end, location: .lodging(makeLodging(id: "l", checkIn: "2026-09-01", checkOut: "2026-09-02"))) == "Overnight")
        #expect(anchorSubtext(role: .end, location: .transit(makeTransit(id: "t", departAt: "2026-09-05T18:00"))) == "Depart")
    }
}
