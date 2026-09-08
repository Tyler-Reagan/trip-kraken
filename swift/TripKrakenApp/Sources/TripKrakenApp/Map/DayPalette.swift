import SwiftUI

/// The per-day wayfinding palette, ported verbatim from `src/lib/dayColors.ts`: a 14-hue wheel at a
/// fixed HSL(_, 62%, 58%) with two ~30°-wide gaps carved out around the brand accent (teal, ~178°)
/// and danger (brick-red, ~8°) so no day color is ever confused with either. Loops for trips longer
/// than 14 days. Kept as code, not an asset catalog — a bundle-less `swift run` executable has none.
enum DayPalette {
    private static let rgb: [(UInt8, UInt8, UInt8)] = [
        (214, 148, 81), (214, 203, 81), (170, 214, 81), (115, 214, 81),
        (81, 214, 104), (81, 214, 159), (81, 181, 214), (81, 132, 214),
        (81, 84, 214), (128, 81, 214), (177, 81, 214), (214, 81, 203),
        (214, 81, 155), (214, 81, 106),
    ]

    static func color(_ dayNumber: Int) -> Color {
        let (r, g, b) = rgb[(dayNumber - 1) % rgb.count]
        return Color(.sRGB, red: Double(r) / 255, green: Double(g) / 255, blue: Double(b) / 255)
    }

    /// Ink or paper, whichever actually contrasts better on the day color — used for a filled
    /// numbered badge so the number stays legible across all 14 hues. A fixed luminance threshold
    /// mis-fires on mid-bright hues (white on orange is only 2.3:1); comparing real WCAG contrast
    /// picks the winner every time.
    static func textColor(_ dayNumber: Int) -> Color {
        let (r, g, b) = rgb[(dayNumber - 1) % rgb.count]
        let bg = relativeLuminance(r, g, b)
        let contrast: (Double) -> Double = { textLum in
            (max(bg, textLum) + 0.05) / (min(bg, textLum) + 0.05)
        }
        return contrast(relativeLuminance(10, 10, 10)) >= contrast(1) ? .black : .white
    }

    private static func relativeLuminance(_ r: UInt8, _ g: UInt8, _ b: UInt8) -> Double {
        func linearize(_ channel: UInt8) -> Double {
            let s = Double(channel) / 255
            return s <= 0.03928 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
    }
}
