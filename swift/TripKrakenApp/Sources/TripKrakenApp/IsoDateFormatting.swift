import Foundation
import TripKrakenKit

/// Presentation-only date formatting — deliberately not in `TripKrakenKit`, which stays free of
/// display concerns. `IsoDate` stays a plain "YYYY-MM-DD" string at the domain layer (see
/// `Trip.swift`'s own reasoning); this is where it becomes something a person reads.
///
/// A free function rather than `extension IsoDate`: `IsoDate` is a typealias for `String`, so
/// extending it would silently extend every `String` in the app target instead of scoping to dates.

/// "Thursday, October 1" — falls back to the raw ISO string if it somehow doesn't parse, rather
/// than crashing on a display path. Builds a fresh `DateFormatter` per call rather than caching one
/// in a global: `DateFormatter` is a mutable, non-`Sendable` class, and this only ever formats one
/// date at a time, so there's nothing worth the concurrency-safety ceremony a cached instance would
/// need.
func formatted(_ date: IsoDate) -> String {
    let parser = DateFormatter()
    parser.calendar = Calendar(identifier: .gregorian)
    parser.timeZone = TimeZone(identifier: "UTC")
    parser.dateFormat = "yyyy-MM-dd"
    guard let parsed = parser.date(from: date) else { return date }
    return parsed.formatted(.dateTime.weekday(.wide).month(.wide).day())
}
