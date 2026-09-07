import SwiftUI
import TripKrakenKit

struct DayDetailView: View {
    let day: DerivedDay

    var body: some View {
        List(dayChainEntries(day), id: \.self) { entry in
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
        .navigationTitle("Day \(day.dayNumber) · \(formatted(day.date))")
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
