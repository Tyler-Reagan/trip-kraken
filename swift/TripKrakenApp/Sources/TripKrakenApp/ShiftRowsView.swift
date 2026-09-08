import SwiftUI
import TripKrakenKit

/// The native equivalent of the web app's `PathShiftRows` (ADR-0036) — every Location-to-Location
/// gap's held Path chain renders one row per shift: a plain walk/drive is a chain of length one
/// (unchanged), a decomposed rail Journey (ADR-0032) shows access walk → rail leg(s) → transfer
/// walk(s) → egress walk as separate rows. Deliberately simpler than the web version: no
/// collapse/expand behind a chevron for long chains (every shift always shows), and no
/// click-to-focus on a transfer station — real simplifications, not the whole feature.
struct ShiftRowsView: View {
    let chain: [TripKrakenKit.Path]
    let hasJrPass: Bool

    var body: some View {
        ForEach(Array(chain.enumerated()), id: \.offset) { _, path in
            HStack(spacing: 6) {
                Image(systemName: iconName(for: path))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .frame(width: 14)
                Text(label(for: path))
                    .font(.caption)
                    .lineLimit(1)
                Spacer(minLength: 4)
                if needsSupplementMarker(path) {
                    Image(systemName: "exclamationmark.circle")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                        .help("Nozomi/Mizuho aren't covered by a JR Pass outright — ridable with a separate supplement ticket")
                }
                if path.base.travelCost.basisOfCost == .straightLine {
                    Text("straight-line").font(.caption2).foregroundStyle(.secondary)
                }
                Text(formatDuration(max(1, Int(path.base.travelCost.costAsMinutes.rounded()))))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .padding(.leading, 28)
        }
    }

    private func iconName(for path: TripKrakenKit.Path) -> String {
        switch path.kind {
        case .rail: "tram.fill"
        case .walking: "figure.walk"
        case .driving: "car.fill"
        case .bicycle: "bicycle"
        case .bus: "bus.fill"
        case .other, nil: "arrow.triangle.turn.up.right.diamond"
        }
    }

    private func label(for path: TripKrakenKit.Path) -> String {
        if let rail = path.asRail { return rail.lineName }
        if let bus = path.asBus { return bus.lineName }
        if isTransferWalk(path) { return "Change at \(path.base.from.stationName ?? "transfer")" }
        if path.kind == .walking, let station = path.base.to.stationName { return "Walk to \(station)" }
        if path.kind == .walking, let station = path.base.from.stationName { return "Walk from \(station)" }
        return path.kind?.rawValue.capitalized ?? "Unknown"
    }

    /// Objective fact about the service (Nozomi/Mizuho aren't covered by a JR Pass outright), but
    /// only worth showing to a traveler who actually declared a Pass.
    private func needsSupplementMarker(_ path: TripKrakenKit.Path) -> Bool {
        hasJrPass && path.asRail?.jrPassSupplementRequired == true
    }
}
