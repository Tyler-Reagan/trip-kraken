import SwiftUI
import TripKrakenKit

/// The pre-optimize signals surfaced above the itinerary — mirrors the web app's
/// `TransitEstimateCaveat`/`DistantMetroWarning`/`EnrichmentFailureNotice`, ported to a single
/// neutral-card treatment (a colored icon carries severity, no tinted backgrounds) rather than
/// three separately-styled always-tinted components — this app's own "readability first" theming
/// direction. Validated against three variants in a throwaway prototype before landing here.
struct NoticeData {
    let showTransitCaveat: Bool
    let uncoveredMetros: [UncoveredMetro]?
    let failedLocations: [TripKrakenKit.Location]
}

func noticeData(_ trip: TripWithDetails) -> NoticeData {
    NoticeData(
        showTransitCaveat: !trip.placements.isEmpty && !trip.transitCaveatDismissed,
        uncoveredMetros: detectUncoveredSplit(trip),
        failedLocations: trip.locations.filter { $0.base.enrichmentStatus == .failed }
    )
}

private func uncoveredMetroText(_ uncovered: [UncoveredMetro]) -> String {
    let count = uncovered.reduce(0) { $0 + $1.activityCount }
    let names = uncovered.map(\.label).joined(separator: ", ")
    return "\(count) location\(count == 1 ? "" : "s") near \(names) have no nearby lodging."
}

private func metroSignature(_ uncovered: [UncoveredMetro]) -> String {
    uncovered.map(\.label).sorted().joined(separator: "|")
}

/// `TransitEstimateCaveat`'s dismissal is the one persisted field (`Trip.transitCaveatDismissed`);
/// the other two are session-local, matching the web app's own split between a DB-backed flag and
/// plain component state. `ContentView` owns `dismissedMetroSignature`/`enrichmentDismissed` (not
/// this view) so both can be reset together on a trip switch — see its own doc comment on why.
struct NoticeStack: View {
    let data: NoticeData
    let onDismissTransitCaveat: () -> Void
    let onRetryEnrichment: () -> Void
    let isRetrying: Bool
    @Binding var dismissedMetroSignature: String?
    @Binding var enrichmentDismissed: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if data.showTransitCaveat {
                row(icon: "info.circle.fill", tint: .blue) {
                    Text("Transit timing is estimated, not schedule-exact.").font(.callout)
                } dismiss: { onDismissTransitCaveat() }
            }
            if let uncovered = data.uncoveredMetros, metroSignature(uncovered) != dismissedMetroSignature {
                row(icon: "exclamationmark.triangle.fill", tint: .orange) {
                    Text(uncoveredMetroText(uncovered)).font(.callout).fixedSize(horizontal: false, vertical: true)
                } dismiss: { dismissedMetroSignature = metroSignature(uncovered) }
            }
            if !data.failedLocations.isEmpty, !enrichmentDismissed {
                row(icon: "exclamationmark.triangle.fill", tint: .red) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(data.failedLocations.count) place\(data.failedLocations.count == 1 ? "" : "s") couldn't be looked up.").font(.callout)
                        Text(data.failedLocations.map(\.base.name).joined(separator: ", ")).font(.caption).foregroundStyle(.secondary)
                    }
                    Button(isRetrying ? "Retrying…" : "Retry", action: onRetryEnrichment).disabled(isRetrying)
                } dismiss: { enrichmentDismissed = true }
            }
        }
    }

    private func row(icon: String, tint: Color, @ViewBuilder content: () -> some View, dismiss: @escaping () -> Void) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon).foregroundStyle(tint)
            content()
            Spacer(minLength: 8)
            Button(action: dismiss) { Image(systemName: "xmark") }.buttonStyle(.borderless).foregroundStyle(.secondary)
        }
        .padding(10)
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(.separator))
    }
}
