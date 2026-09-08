import Foundation

// Along-route discovery (ADR-0044's own sizing note, picked back up): finding places near the
// corridor between two Locations, not just near one point. `MKLocalSearch` only takes a single
// circular region, so this module's job is turning an already-known route polyline into a handful
// of sample points a search provider can actually ask about, then ranking what comes back by
// nearness to the whole route rather than to any one sample.

/// Flattens a Journey's decomposed Paths into one ordered coordinate list — unlike the map's
/// honest dashed rendering (ADR-0030 §9), this only biases a Places search corridor, so a gap
/// between spans (or a walking Path, which never carries geometry) is bridged with a straight line
/// rather than left absent. Port of `flattenPathGeometry`
/// (`src/app/api/trips/[id]/locations/along-route/route.ts`).
public func flattenPathGeometry(_ paths: [Path]) -> [Point] {
    var coords: [Point] = []
    func push(_ point: Point) {
        if coords.last == point { return }
        coords.append(point)
    }
    for path in paths {
        let base = path.base
        if let geometry = base.geometry, !geometry.isEmpty {
            for span in geometry {
                for coordinate in span.coordinates where coordinate.count == 2 {
                    push(Point(lat: coordinate[1], lng: coordinate[0]))
                }
            }
        } else {
            push(Point(lat: base.from.lat, lng: base.from.lng))
            push(Point(lat: base.to.lat, lng: base.to.lng))
        }
    }
    return coords
}

/// Samples points along an ordered polyline roughly every `everyMeters` of cumulative arc length —
/// the corridor a Places search runs around, since `MKLocalSearch` can't take a polyline directly.
/// Always includes the route's first and last point regardless of spacing, so even a short route
/// gets coverage at both ends. Capped at `maxSamples` (respecting MapKit's undocumented request
/// throttle, the same reasoning `MapKitGeometryProvider`/`MapKitPlacesProvider` already serialize
/// around) by evenly re-spacing across the route's full length rather than truncating to just the
/// start.
public func samplePoints(along route: [Point], everyMeters: Double, maxSamples: Int) -> [Point] {
    guard route.count >= 2, everyMeters > 0, maxSamples >= 1 else { return route.isEmpty ? [] : [route[0]] }

    var cumulative: [Double] = [0]
    for i in 1..<route.count {
        cumulative.append(cumulative[i - 1] + haversineMeters(route[i - 1], route[i]))
    }
    let totalLength = cumulative[cumulative.count - 1]
    guard totalLength > 0 else { return [route[0]] }

    let naiveCount = Int(totalLength / everyMeters) + 1
    let sampleCount = min(max(naiveCount, 2), maxSamples)
    let step = totalLength / Double(sampleCount - 1)

    func point(atDistance distance: Double) -> Point {
        for i in 1..<cumulative.count where cumulative[i] >= distance {
            let segmentStart = cumulative[i - 1]
            let segmentLength = cumulative[i] - segmentStart
            guard segmentLength > 0 else { return route[i] }
            let t = (distance - segmentStart) / segmentLength
            let a = route[i - 1]
            let b = route[i]
            return Point(lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t)
        }
        return route[route.count - 1]
    }

    // The last sample is always the route's own last point, exactly — accumulated floating-point
    // drift in `Double($0) * step` can otherwise land a hair short of `totalLength`, interpolating
    // a point that's equal to the true endpoint only to within an epsilon, not exactly.
    return (0..<sampleCount).map { i in
        i == sampleCount - 1 ? route[route.count - 1] : point(atDistance: Double(i) * step)
    }
}

/// A point's distance to the nearest vertex of a polyline — a deliberate simplification of true
/// point-to-segment distance. Good enough for ranking along-route results: the route is already
/// densely sampled by `samplePoints`, so consecutive vertices sit close together and the
/// nearest-vertex approximation rarely disagrees with the true nearest-segment answer by much.
public func distanceToRoute(_ point: Point, route: [Point]) -> Double {
    route.map { haversineMeters(point, $0) }.min() ?? .infinity
}
