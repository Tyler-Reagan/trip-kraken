import Foundation
import Testing
import TripKrakenKit

// Ported from `optimize.ts`'s own derivation logic (`toInput`/stays-from-lodging-dates/edge-
// resolution/`kinds`-selection) — ADR-0045.

@Suite("optimizationProblem")
struct OptimizationProblemTests {
    @Test("maps activities, lodgings, and edge Transits into locations; excludes excluded activities")
    func mapsLocations() {
        var excludedBase = makeBase(id: "skip")
        excludedBase.excluded = true
        let trip = makeTrip(locations: [
            .activity(makeActivity(id: "a", visitDuration: 45)),
            .activity(Activity(base: excludedBase)),
            .lodging(makeLodging(id: "hotel", checkIn: "2026-09-01", checkOut: "2026-09-03")),
            .transit(makeTransit(id: "airport-in", arriveAt: "2026-09-01T10:00")),
        ])

        let problem = optimizationProblem(for: trip)

        let ids = problem.locations.map(\.id)
        #expect(ids.contains("a"))
        #expect(ids.contains("hotel"))
        #expect(ids.contains("airport-in"))
        #expect(!ids.contains("skip"), "an excluded activity is dropped")

        let activityInput = problem.locations.first { $0.id == "a" }
        #expect(activityInput?.kind == .activity)
        #expect(activityInput?.visitDuration == 45)

        let transitInput = problem.locations.first { $0.id == "airport-in" }
        #expect(transitInput?.kind == .transit)
        #expect(transitInput?.arriveAt == "2026-09-01T10:00")
    }

    @Test("a lodging's dates become a clamped night-range")
    func lodgingBecomesStayPlan() {
        let trip = makeTrip(
            locations: [.lodging(makeLodging(id: "hotel", checkIn: "2026-09-01", checkOut: "2026-09-04"))],
            startDate: "2026-09-01", endDate: "2026-09-05"
        )

        let problem = optimizationProblem(for: trip)

        #expect(problem.stays == [OptimizeStayPlan(lodgingId: "hotel", startNight: 1, endNight: 3)])
    }

    @Test("a stay entirely outside the trip's dates produces no StayPlan")
    func stayOutsideTripDatesIsDropped() {
        let trip = makeTrip(
            locations: [.lodging(makeLodging(id: "hotel", checkIn: "2026-08-01", checkOut: "2026-08-05"))],
            startDate: "2026-09-01", endDate: "2026-09-05"
        )

        let problem = optimizationProblem(for: trip)

        #expect(problem.stays.isEmpty)
    }

    @Test("arrival/departure edges resolve from tripEdgesOf, deduplicated for a round trip")
    func edgesResolveAndDeduplicate() {
        let airport = makeTransit(id: "airport", arriveAt: "2026-09-01T10:00", departAt: "2026-09-05T18:00")
        let trip = makeTrip(locations: [.transit(airport)])

        let problem = optimizationProblem(for: trip)

        #expect(problem.edges.arrivalId == "airport")
        #expect(problem.edges.departureId == "airport")
        #expect(problem.locations.filter { $0.id == "airport" }.count == 1, "a round-trip airport appears once, not twice")
    }

    @Test("kinds are always rail/bus plus the trip's own road profile")
    func kindsIncludeRailBusAndRoadProfile() {
        let trip = TripWithDetails(
            id: "t1", name: "Trip", sourceUrl: nil, startDate: "2026-09-01", endDate: "2026-09-05",
            dayLabels: nil, roadProfile: .driving, transitCaveatDismissed: false, hasJrPass: false,
            createdAt: Date(), updatedAt: Date(), locations: [], placements: [], journeyRoadKinds: []
        )

        let problem = optimizationProblem(for: trip)

        #expect(problem.kinds == [.rail, .bus, .driving])
    }

    @Test("numDays derives from the trip's own date range")
    func numDaysDerivesFromDateRange() {
        let trip = makeTrip(startDate: "2026-09-01", endDate: "2026-09-03")

        #expect(optimizationProblem(for: trip).numDays == 3)
    }
}
