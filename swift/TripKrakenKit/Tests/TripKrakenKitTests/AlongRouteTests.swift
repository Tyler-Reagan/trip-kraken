import Testing
import TripKrakenKit

private func walkingPath(from: Point, to: Point, geometry: [PathGeometry]? = nil) -> Path {
    .walking(WalkingPath(base: PathBase(
        from: PathEndpoint(lat: from.lat, lng: from.lng), to: PathEndpoint(lat: to.lat, lng: to.lng),
        travelCost: TravelCost(distanceMeters: 1, durationSeconds: 1, basisOfCost: .routingService, answeredBy: .mapKit),
        geometry: geometry
    )))
}

@Suite("flattenPathGeometry")
struct FlattenPathGeometryTests {
    @Test("a Path with real geometry contributes its own coordinates")
    func realGeometryIsUsed() {
        let path = walkingPath(
            from: Point(lat: 0, lng: 0), to: Point(lat: 1, lng: 1),
            geometry: [PathGeometry(coordinates: [[0, 0], [0.5, 0.5], [1, 1]])]
        )
        #expect(flattenPathGeometry([path]) == [Point(lat: 0, lng: 0), Point(lat: 0.5, lng: 0.5), Point(lat: 1, lng: 1)])
    }

    @Test("a Path with no geometry is bridged with a straight line between its endpoints")
    func noGeometryIsBridged() {
        let path = walkingPath(from: Point(lat: 0, lng: 0), to: Point(lat: 1, lng: 1))
        #expect(flattenPathGeometry([path]) == [Point(lat: 0, lng: 0), Point(lat: 1, lng: 1)])
    }

    @Test("consecutive duplicate points across chained Paths are not repeated")
    func duplicatesAreDropped() {
        let a = walkingPath(from: Point(lat: 0, lng: 0), to: Point(lat: 1, lng: 1))
        let b = walkingPath(from: Point(lat: 1, lng: 1), to: Point(lat: 2, lng: 2))
        #expect(flattenPathGeometry([a, b]) == [Point(lat: 0, lng: 0), Point(lat: 1, lng: 1), Point(lat: 2, lng: 2)])
    }

    @Test("an empty chain flattens to nothing")
    func emptyChain() {
        #expect(flattenPathGeometry([]).isEmpty)
    }
}

@Suite("samplePoints")
struct SamplePointsTests {
    @Test("always includes the route's first and last point")
    func includesEndpoints() {
        let route = [Point(lat: 0, lng: 0), Point(lat: 0, lng: 1)]
        let samples = samplePoints(along: route, everyMeters: 1000, maxSamples: 10)
        #expect(samples.first == route.first)
        #expect(samples.last == route.last)
    }

    @Test("a route shorter than everyMeters still returns at least two samples")
    func shortRouteStillSamples() {
        let route = [Point(lat: 0, lng: 0), Point(lat: 0.001, lng: 0.001)]
        let samples = samplePoints(along: route, everyMeters: 50_000, maxSamples: 10)
        #expect(samples.count == 2)
    }

    @Test("sample count is capped at maxSamples, re-spaced across the whole route")
    func capsAtMaxSamples() {
        let route = [Point(lat: 0, lng: 0), Point(lat: 0, lng: 1)] // ~111km at the equator
        let samples = samplePoints(along: route, everyMeters: 1000, maxSamples: 4)
        #expect(samples.count == 4)
        #expect(samples.first == route.first)
        #expect(samples.last == route.last)
    }

    @Test("an empty route samples nothing")
    func emptyRoute() {
        #expect(samplePoints(along: [], everyMeters: 1000, maxSamples: 5).isEmpty)
    }

    @Test("a single-point route samples just that point")
    func singlePointRoute() {
        let point = Point(lat: 10, lng: 20)
        #expect(samplePoints(along: [point], everyMeters: 1000, maxSamples: 5) == [point])
    }

    @Test("a zero-length route (identical points) samples just the one point")
    func zeroLengthRoute() {
        let point = Point(lat: 10, lng: 20)
        #expect(samplePoints(along: [point, point], everyMeters: 1000, maxSamples: 5) == [point])
    }
}

@Suite("distanceToRoute")
struct DistanceToRouteTests {
    @Test("zero for a point that is itself on the route")
    func zeroWhenOnRoute() {
        let route = [Point(lat: 0, lng: 0), Point(lat: 0, lng: 1)]
        #expect(distanceToRoute(Point(lat: 0, lng: 0), route: route) == 0)
    }

    @Test("a far-away point measures against the nearest vertex")
    func measuresNearestVertex() {
        let route = [Point(lat: 0, lng: 0), Point(lat: 0, lng: 10)]
        let near = distanceToRoute(Point(lat: 0.001, lng: 0), route: route)
        let far = distanceToRoute(Point(lat: 5, lng: 0), route: route)
        #expect(near < far)
    }

    @Test("an empty route answers infinity, not a crash")
    func emptyRoute() {
        #expect(distanceToRoute(Point(lat: 0, lng: 0), route: []) == .infinity)
    }
}
