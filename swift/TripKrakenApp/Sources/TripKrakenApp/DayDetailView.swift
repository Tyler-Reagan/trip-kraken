import SwiftUI
import TripKrakenKit
import TripKrakenStore

struct DayDetailView: View {
    let day: DerivedDay
    @Environment(TripStore.self) private var store

    /// Only stops are placed into the plan (ADR-0015 §2) — anchors and the check-in waypoint are
    /// derived, so they render but never move.
    private var leadingEntries: [ChainEntry] {
        dayChainEntries(day).filter { $0.role == .start || $0.role == .checkin }
    }
    private var trailingEntries: [ChainEntry] {
        dayChainEntries(day).filter { $0.role == .end }
    }

    var body: some View {
        List {
            ForEach(leadingEntries, id: \.self) { row(for: $0) }
            ForEach(Array(day.stops.enumerated()), id: \.element.placement.id) { index, stop in
                row(for: ChainEntry(role: .stop, location: .activity(stop.location), stop: stop, index: index))
            }
            .onMove(perform: moveStops)
            ForEach(trailingEntries, id: \.self) { row(for: $0) }
        }
        .navigationTitle("Day \(day.dayNumber) · \(formatted(day.date))")
    }

    private func row(for entry: ChainEntry) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbolName(for: entry))
                .foregroundStyle(.secondary)
                .frame(width: 20)

            VStack(alignment: .leading, spacing: 2) {
                Text(entry.location.base.name).font(.body)
                Text(subtext(for: entry)).font(.caption).foregroundStyle(.secondary)
            }

            Spacer()

            if entry.role == .stop, let minutes = entry.location.base.visitDuration {
                Text(formatDuration(minutes)).font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    /// `List`'s move semantics (`Array.move(fromOffsets:toOffset:)`) already account for the
    /// removal shift, so the moved placement's new index in the post-move id list is exactly the
    /// `order` to persist — `reorderPlacements` (already tested on its own) handles shifting every
    /// sibling around it.
    private func moveStops(from indices: IndexSet, to newOffset: Int) {
        guard let sourceIndex = indices.first else { return }
        let placementId = day.stops[sourceIndex].placement.id
        var ids = day.stops.map(\.placement.id)
        ids.move(fromOffsets: indices, toOffset: newOffset)
        guard let newIndex = ids.firstIndex(of: placementId) else { return }
        try? store.movePlacement(placementId: placementId, date: day.date, order: newIndex)
    }

    /// System iconography per role rather than custom badge chrome — free, theme-aware, and reads
    /// the way the rest of macOS already does (a numbered stop echoes Maps' own numbered pins).
    private func symbolName(for entry: ChainEntry) -> String {
        let isEdge = entry.location.asTransit != nil
        switch entry.role {
        case .start: return isEdge ? "airplane.arrival" : "sunrise"
        case .checkin: return "bag"
        case .end: return isEdge ? "airplane.departure" : "moon.stars"
        case .stop:
            let n = (entry.index ?? 0) + 1
            return n <= 50 ? "\(n).circle.fill" : "mappin.circle.fill"
        }
    }

    private func subtext(for entry: ChainEntry) -> String {
        switch entry.role {
        case .start: anchorSubtext(role: .start, location: entry.location)
        case .checkin: anchorSubtext(role: .checkin, location: entry.location)
        case .end: anchorSubtext(role: .end, location: entry.location)
        case .stop: entry.location.base.address ?? "Stop \((entry.index ?? 0) + 1)"
        }
    }
}
