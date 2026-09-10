import SwiftUI
import TripKrakenKit
import TripKrakenRouting
import TripKrakenStore

/// The native equivalent of the web app's `UnassignedCard`/`UnassignedRow` — activities present in
/// the trip but placed into no day, each shown with why the last Optimize run couldn't place it
/// (or "no reason yet" before a first run). Deliberately narrower than the full `Manifest`: no
/// lodging management, no metro grouping — a later slice, not this one. Reached from a standing
/// sidebar row (`ContentView`'s `SidebarSelection.unscheduled`), validated against two other
/// placements (a toolbar sheet, inline in the day list) in a throwaway prototype before landing
/// here.
struct UnscheduledView: View {
    let placesProvider: MapKitPlacesProvider
    @Environment(TripStore.self) private var store
    @State private var nearbySearchLocation: TripKrakenKit.Location?

    var body: some View {
        List(store.unscheduledActivities, id: \.id) { location in
            UnscheduledRow(
                location: location,
                reason: store.lastUnplaced.first { $0.locationId == location.id },
                days: store.days,
                onNearby: { nearbySearchLocation = location }
            )
        }
        .overlay {
            if store.unscheduledActivities.isEmpty {
                ContentUnavailableView("Nothing unscheduled", systemImage: "checkmark.circle")
            }
        }
        .navigationTitle("Unscheduled")
        .sheet(item: $nearbySearchLocation) { location in
            let near = location.base.lat.flatMap { lat in location.base.lng.map { Point(lat: lat, lng: $0) } }
            LocationSearchView(near: near, provider: placesProvider)
        }
    }
}

private struct UnscheduledRow: View {
    let location: TripKrakenKit.Location
    let reason: Unplaced?
    let days: [DerivedDay]
    let onNearby: () -> Void
    @Environment(TripStore.self) private var store

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            statusIndicator
            VStack(alignment: .leading, spacing: 2) {
                Text(location.base.name).font(.body)
                subtitle
            }
            Spacer()
            Menu("Assign") {
                ForEach(days, id: \.dayNumber) { day in
                    Button("Day \(day.dayNumber)") {
                        _ = try? store.placeActivity(locationId: location.base.id, date: day.date)
                    }
                }
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            Button(action: onNearby) {
                Image(systemName: "mappin.and.ellipse")
            }
            .buttonStyle(.borderless)
            .disabled(location.base.lat == nil)
            .help(location.base.lat == nil ? "No coordinates — run Enrich first" : "Find nearby places")
            Button {
                try? store.setExcluded(locationId: location.base.id, excluded: !location.base.excluded)
            } label: {
                Image(systemName: location.base.excluded ? "eye.slash" : "eye")
            }
            .buttonStyle(.borderless)
            .help(location.base.excluded ? "Excluded — click to re-include" : "Click to exclude from planning")
            Button(role: .destructive) {
                try? store.deleteLocation(location.base.id)
            } label: {
                Image(systemName: "trash")
            }
            .buttonStyle(.borderless)
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private var statusIndicator: some View {
        switch location.base.enrichmentStatus {
        case .pending: ProgressView().controlSize(.mini).padding(.top, 3)
        case .failed: Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange).font(.caption).padding(.top, 3)
        case .done: EmptyView()
        }
    }

    /// Three-way branch mirroring `UnassignedRow`'s own: the user's own choice (excluded) reads as
    /// a different problem than the optimizer's own failure (`reason`), never the same generic gap.
    @ViewBuilder
    private var subtitle: some View {
        if location.base.excluded {
            Text("Excluded — won't be scheduled").font(.caption).foregroundStyle(.secondary).italic()
        } else if let reason {
            let category = categoryOf(reason)
            HStack(spacing: 4) {
                Image(systemName: category.icon).font(.caption2)
                if let dayNumber = reason.diagnosis?.dayNumber {
                    Text("\(dayNumber)")
                        .font(.system(size: 9, weight: .bold))
                        .frame(width: 14, height: 14)
                        .background(DayPalette.color(dayNumber), in: Circle())
                        .foregroundStyle(DayPalette.textColor(dayNumber))
                }
                Text(reason.reason)
            }
            .font(.caption)
            .foregroundStyle(.orange)
        } else {
            Text(hoursAndDuration).font(.caption).foregroundStyle(.secondary)
        }
    }

    private var hoursAndDuration: String {
        let hours: String
        if location.base.openTime == nil && location.base.closeTime == nil {
            hours = "No hours"
        } else if location.base.openTime == "00:00" && location.base.closeTime == "23:59" {
            hours = "Always open"
        } else {
            hours = "\(location.base.openTime ?? "?")–\(location.base.closeTime ?? "?")"
        }
        return "\(hours) · \(formatDuration(resolveVisitDuration(location.base.visitDuration)))"
    }
}

/// One human category per `Unplaced` — mirrors `UnassignedCard.tsx`'s `categoryOf`, coarser than
/// `UnplacedCode`/`UnplacedDiagnosis.cause` on purpose: a traveller needs a handful of buckets they
/// recognize, not the solver's fine-grained taxonomy. `ungeocoded*` codes are deliberately folded
/// into the generic fallback — `statusIndicator` already shows those via the pending/failed icon,
/// and a second icon here would say the same thing twice.
private func categoryOf(_ unplaced: Unplaced) -> (icon: String, label: String) {
    switch unplaced.code {
    case .noLodgingCoverage:
        ("mappin.slash", "No nearby lodging")
    case .closedAllDays:
        ("calendar.badge.exclamationmark", "Closed the whole trip")
    case .solver:
        switch unplaced.diagnosis?.cause {
        case .outOfReach: ("mappin.slash", "Too far from every day")
        case .dayFull, .dayTooShort: ("tray.full", "No day has room")
        case .afterClosing, .beforeOpening: ("clock", "Hours don't line up")
        case nil: ("questionmark.circle", "Couldn't fit anywhere")
        }
    case .ungeocodedPending, .ungeocodedFailed:
        ("questionmark.circle", "Couldn't fit anywhere")
    }
}
