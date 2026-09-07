import Testing
import TripKrakenKit

private func endpoint(_ lat: Double = 0, _ lng: Double = 0) -> PathEndpoint {
    PathEndpoint(lat: lat, lng: lng)
}

private func cost(distance: Double = 0, duration: Double, basis: BasisOfCost, answeredBy: ProviderId = .osrm) -> TravelCost {
    TravelCost(distanceMeters: distance, durationSeconds: duration, basisOfCost: basis, answeredBy: answeredBy)
}

private func walkingPath(_ travelCost: TravelCost) -> Path {
    .walking(WalkingPath(base: PathBase(from: endpoint(), to: endpoint(), travelCost: travelCost)))
}

@Suite("TravelCost")
struct TravelCostTests {
    @Test("costAsMinutes always tracks durationSeconds")
    func costAsMinutesDerived() {
        let c = cost(duration: 300, basis: .routingService)
        #expect(c.costAsMinutes == 5)
    }

    @Test("PersistableTravelCost refuses a Google-answered cost")
    func persistableRefusesGoogle() {
        let googleCost = cost(duration: 60, basis: .routingService, answeredBy: .google)
        #expect(PersistableTravelCost(googleCost) == nil)
        #expect(!isPersistable(googleCost))

        let osrmCost = cost(duration: 60, basis: .routingService, answeredBy: .osrm)
        #expect(PersistableTravelCost(osrmCost) != nil)
        #expect(isPersistable(osrmCost))
    }
}

@Suite("journeyCost")
struct JourneyCostTests {
    @Test("empty chain has no cost")
    func empty() {
        #expect(journeyCost([]) == nil)
    }

    @Test("sums distance and duration across the chain")
    func sums() {
        let paths = [
            walkingPath(cost(distance: 100, duration: 60, basis: .routingService)),
            walkingPath(cost(distance: 200, duration: 120, basis: .routingService)),
        ]
        let total = journeyCost(paths)
        #expect(total?.distanceMeters == 300)
        #expect(total?.durationSeconds == 180)
    }

    @Test("most-routed wins over straightLine, even when the straightLine leg is longer")
    func mostRoutedBeatsWeakestLink() {
        // Mirrors the rail-Journey fixture this rule exists for: a flat straightLine transfer
        // out-durates a short routed hop, and weakest-link would wrongly mark the whole Journey
        // straightLine.
        let routedHop = walkingPath(cost(duration: 60, basis: .railNetwork, answeredBy: .osmJapan))
        let longerTransfer = walkingPath(cost(duration: 300, basis: .straightLine, answeredBy: .osmJapan))
        let total = journeyCost([routedHop, longerTransfer])
        #expect(total?.basisOfCost == .railNetwork)
        #expect(total?.answeredBy == .osmJapan)
    }

    @Test("ties between equally-routed legs break on duration")
    func tiesBreakOnDuration() {
        let shortLeg = walkingPath(cost(duration: 60, basis: .routingService, answeredBy: .osrm))
        let longLeg = walkingPath(cost(duration: 600, basis: .routingService, answeredBy: .osrm))
        let total = journeyCost([shortLeg, longLeg])
        #expect(total?.durationSeconds == 660)
    }
}
