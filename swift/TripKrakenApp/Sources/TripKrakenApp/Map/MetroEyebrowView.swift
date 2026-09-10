import SwiftUI
import TripKrakenKit

/// Colored dot(s) + uppercase metro name(s) — the trip's shared "which metro" visual language.
/// Used by `DayHeaderView` (clickable, drives `browsedMetroId`) and the sidebar's day rows in
/// `ContentView` (informational only — a `List(selection:)` row's job is day selection, and a
/// second interactive target nested inside it isn't worth it just to make metros visible there,
/// which was the actual ask). One component instead of two near-copies, so the two places can't
/// visually drift apart.
struct MetroEyebrowView: View {
    let metros: [TripMetro]
    /// The full trip-wide list, for `MetroPalette`'s index — never a per-day-filtered one, or the
    /// same metro would get different colors depending on which day is showing it.
    let allMetros: [TripMetro]
    /// Non-nil makes every chip tappable; `nil` renders plain text with no `Button` wrapper at
    /// all, not just a disabled one — a control that looks interactive but rarely does anything
    /// (the header chips' own history) invites clicking more than plain text does.
    var onTap: ((TripMetro) -> Void)? = nil

    var body: some View {
        if !metros.isEmpty {
            HStack(spacing: 10) {
                ForEach(metros, id: \.id) { metro in
                    chip(for: metro)
                }
            }
        }
    }

    @ViewBuilder
    private func chip(for metro: TripMetro) -> some View {
        let dotAndLabel = HStack(spacing: 5) {
            Circle()
                .fill(MetroPalette.color(allMetros.firstIndex(of: metro) ?? 0))
                .frame(width: 7, height: 7)
            Text(metro.label.uppercased())
                .font(.caption).fontWeight(.semibold)
                .tracking(0.8)
                .lineLimit(1)
        }
        if let onTap {
            Button { onTap(metro) } label: { dotAndLabel }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help("Show \(metro.label) on the map")
        } else {
            dotAndLabel.foregroundStyle(.secondary)
        }
    }
}
