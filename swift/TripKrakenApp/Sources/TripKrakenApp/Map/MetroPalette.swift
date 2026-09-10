import SwiftUI

/// Per-metro wayfinding color — the same 14-hue wheel `DayPalette` uses, keyed by a metro's
/// position in `metrosOf(trip)` (already ordered by first appearance, `TripMetros.swift`'s own doc
/// comment) rather than a day number, since a metro spans potentially many days and has no day
/// number of its own to key off. Callers pass the metro's index in the full trip-wide `metros`
/// array — never a per-day-filtered subset — so a given metro's color stays the same everywhere it
/// appears, not just within one day's header.
enum MetroPalette {
    private static let rgb: [(UInt8, UInt8, UInt8)] = [
        (214, 148, 81), (214, 203, 81), (170, 214, 81), (115, 214, 81),
        (81, 214, 104), (81, 214, 159), (81, 181, 214), (81, 132, 214),
        (81, 84, 214), (128, 81, 214), (177, 81, 214), (214, 81, 203),
        (214, 81, 155), (214, 81, 106),
    ]

    static func color(_ index: Int) -> Color {
        let (r, g, b) = rgb[((index % rgb.count) + rgb.count) % rgb.count]
        return Color(.sRGB, red: Double(r) / 255, green: Double(g) / 255, blue: Double(b) / 255)
    }
}
