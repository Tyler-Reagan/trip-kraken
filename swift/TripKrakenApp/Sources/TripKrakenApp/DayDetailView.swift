import SwiftUI
import TripKrakenKit
import TripKrakenRouting
import TripKrakenStore

struct DayDetailView: View {
    let day: DerivedDay
    @Environment(TripStore.self) private var store
    @Environment(PathGeometryCache.self) private var geometryCache
    @State private var detailLocation: TripKrakenKit.Location?

    /// Only stops are placed into the plan (ADR-0015 §2) — anchors and the check-in waypoint are
    /// derived, so they render but never move.
    private var leadingEntries: [ChainEntry] {
        dayChainEntries(day).filter { $0.role == .start || $0.role == .checkin }
    }
    private var trailingEntries: [ChainEntry] {
        dayChainEntries(day).filter { $0.role == .end }
    }
    private var chain: [ChainEntry] { dayChainEntries(day) }

    var body: some View {
        List {
            ForEach(leadingEntries, id: \.self) { row(for: $0) }
            ForEach(Array(day.stops.enumerated()), id: \.element.placement.id) { index, stop in
                row(for: ChainEntry(role: .stop, location: .activity(stop.location), stop: stop, index: index), toggle: journeyToggle(beforeStopAt: index))
            }
            .onMove(perform: moveStops)
            ForEach(trailingEntries, id: \.self) { row(for: $0) }
        }
        .navigationTitle("Day \(day.dayNumber) · \(formatted(day.date))")
        .sheet(item: $detailLocation) { location in
            NavigationStack { LocationDetailView(location: location) }
        }
        .onAppear { loadGeometry() }
        .onChange(of: day.date) { loadGeometry() }
    }

    private func row(for entry: ChainEntry, toggle: JourneyKindToggle? = nil) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Image(systemName: symbolName(for: entry))
                    .foregroundStyle(.secondary)
                    .frame(width: 20)

                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.location.base.name).font(.body)
                    Text(subtext(for: entry)).font(.caption).foregroundStyle(.secondary)
                }

                Spacer()

                if let toggle {
                    Picker("", selection: Binding(get: { toggle.kind }, set: { toggle.onKindChange($0) })) {
                        Image(systemName: "figure.walk").tag(RoadProfile.walking)
                        Image(systemName: "car.fill").tag(RoadProfile.driving)
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .frame(width: 76)
                }

                if entry.role == .stop, let minutes = entry.location.base.visitDuration {
                    Text(formatDuration(minutes)).font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 4)
            .contentShape(Rectangle())
            .onTapGesture { detailLocation = entry.location }

            if let shifts = shiftChain(after: entry), !shifts.isEmpty {
                ShiftRowsView(chain: shifts, hasJrPass: store.trip?.hasJrPass ?? false)
                    .padding(.bottom, 4)
            }
        }
    }

    /// The held Path chain for the gap from `entry` to whichever entry follows it in the Day's
    /// chain — `nil` when either end isn't geocoded, or when nothing's been asked/answered yet
    /// (`PathGeometryCache` fills this in asynchronously; an absent key just renders no shift rows,
    /// the same way the map draws that gap as a plain dashed line until it resolves).
    private func shiftChain(after entry: ChainEntry) -> [TripKrakenKit.Path]? {
        guard let index = chain.firstIndex(where: { $0.role == entry.role && $0.location.base.id == entry.location.base.id && $0.index == entry.index }),
            index + 1 < chain.count
        else { return nil }
        let next = chain[index + 1]
        guard let fromLat = entry.location.base.lat, let fromLng = entry.location.base.lng,
            let toLat = next.location.base.lat, let toLng = next.location.base.lng,
            let trip = store.trip
        else { return nil }
        let pair = PathPair(
            from: PathEndpoint(lat: fromLat, lng: fromLng, locationId: entry.location.base.id),
            to: PathEndpoint(lat: toLat, lng: toLng, locationId: next.location.base.id)
        )
        let key = pairKey(profile: trip.roadProfile, pair: pair, journeyRoadKinds: trip.journeyRoadKinds)
        return geometryCache.held[key]
    }

    private func loadGeometry() {
        guard let trip = store.trip else { return }
        geometryCache.ensure(pairs: pairsOfDay(day), profile: trip.roadProfile, journeyRoadKinds: trip.journeyRoadKinds)
    }

    /// The walk/drive control for the gap immediately before one stop — governs the Journey from
    /// whichever chain entry precedes it (the prior stop, or the check-in waypoint/start Anchor for
    /// the first stop). Anchors themselves don't get a toggle; only stop-to-stop and
    /// anchor(or-waypoint)-to-first-stop gaps are shown, which covers every real gap a Day's plan
    /// can have a choice about.
    private func journeyToggle(beforeStopAt index: Int) -> JourneyKindToggle? {
        guard let trip = store.trip else { return nil }
        let previousId: String?
        if index == 0 {
            previousId = day.checkInWaypoint?.base.id ?? day.startAnchor?.base.id
        } else {
            previousId = day.stops[index - 1].location.base.id
        }
        guard let previousId else { return nil }
        let toId = day.stops[index].location.base.id
        return resolveJourneyKindToggle(
            journeyRoadKinds: trip.journeyRoadKinds, roadProfile: trip.roadProfile, fromId: previousId, toId: toId
        ) { newKind in
            try? store.setJourneyRoadKind(from: previousId, to: toId, kind: newKind)
        }
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
