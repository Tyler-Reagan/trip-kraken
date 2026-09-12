import SwiftUI
import TripKrakenKit
import TripKrakenRouting
import TripKrakenStore

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
            HStack(alignment: .top, spacing: 6) {
                Image(systemName: iconName(for: path))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .frame(width: 14)
                    .padding(.top, 1)
                VStack(alignment: .leading, spacing: 1) {
                    Text(label(for: path))
                        .font(.caption)
                        .lineLimit(2)
                    HStack(spacing: 4) {
                        if needsSupplementMarker(path) {
                            Image(systemName: "exclamationmark.circle")
                                .foregroundStyle(.orange)
                                .help("Nozomi/Mizuho aren't covered by a JR Pass outright — ridable with a separate supplement ticket")
                        }
                        Text(formatDuration(max(1, Int(path.base.travelCost.costAsMinutes.rounded()))))
                        if path.base.travelCost.basisOfCost == .straightLine {
                            Text("· straight-line")
                        }
                    }
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                }
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

/// Renders in `ShiftRowsView`'s place when a gap has no held geometry at all — `held[key] == nil`
/// (never resolved, or fell out after `PathGeometryCache`'s own retry rounds exhausted) draws as
/// "not resolved yet"; `held[key] == []` (a real answer: no walking, driving, or rail path exists)
/// draws as a plain "no route" statement instead, so a genuine dead end doesn't read as a stuck
/// loading state. Same indent and row height as a real shift row on purpose — this is still one
/// leg's detail, not a separate callout.
struct GeometryGapRow: View {
    let pair: PathPair
    let key: String
    @Environment(TripStore.self) private var store
    @Environment(PathGeometryCache.self) private var geometryCache
    @State private var isRetrying = false

    private var isConfirmedNoRoute: Bool {
        geometryCache.held[key] != nil
    }

    var body: some View {
        HStack(spacing: 6) {
            if isRetrying {
                ProgressView().controlSize(.small).frame(width: 14)
            } else {
                Image(systemName: isConfirmedNoRoute ? "exclamationmark.triangle.fill" : "questionmark.circle")
                    .font(.caption2)
                    .foregroundStyle(tint)
                    .frame(width: 14)
            }
            Text(isRetrying ? "Retrying…" : text)
                .font(.caption)
                .foregroundStyle(isRetrying ? AnyShapeStyle(.secondary) : AnyShapeStyle(tint))
                .lineLimit(1)
            Spacer(minLength: 4)
            if !isRetrying {
                Button(action: retry) {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                .help(isConfirmedNoRoute ? "Check again — no route was found last time" : "Retry finding a route")
            }
        }
        .padding(.leading, 28)
    }

    private var text: String {
        isConfirmedNoRoute ? "No route found for this leg" : "Route not resolved yet"
    }

    /// Pending draws attention (orange, matching the map's dashed line); a confirmed no-route is a
    /// real answer, not a problem to flag as loudly — muted like any other secondary-text row.
    private var tint: Color {
        isConfirmedNoRoute ? .secondary : .orange
    }

    private func retry() {
        guard let trip = store.trip, !isRetrying else { return }
        isRetrying = true
        Task {
            await geometryCache.retry(pair: pair, profile: trip.roadProfile, journeyRoadKinds: trip.journeyRoadKinds)
            isRetrying = false
        }
    }
}
