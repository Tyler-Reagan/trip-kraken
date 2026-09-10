import SwiftUI
import TripKrakenKit
import TripKrakenStore

/// Reorder/delete surface for the trip switcher's "Manage Trips…" entry. `TripStore.reorderTrips`
/// and `.deleteTrip` are the persistence side of both gestures; this view only holds the working
/// copy `List`'s drag gesture needs and re-reads `listTripSummaries()` after every mutation so it
/// never drifts from what's actually stored.
struct TripManagerView: View {
    @Environment(TripStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var trips: [TripSummary] = []
    @State private var pendingDelete: TripSummary?

    var body: some View {
        NavigationStack {
            List {
                ForEach(trips) { trip in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(trip.name)
                            Text("\(trip.locationCount) location\(trip.locationCount == 1 ? "" : "s")")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if trip.id == store.trip?.id {
                            Text("Current").font(.caption).foregroundStyle(.secondary)
                        }
                        Button {
                            pendingDelete = trip
                        } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(.borderless)
                        .help("Delete this trip")
                    }
                }
                .onMove(perform: move)
            }
            .navigationTitle("Manage Trips")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .frame(minWidth: 360, minHeight: 320)
        .onAppear { reload() }
        .alert(item: $pendingDelete) { trip in
            Alert(
                title: Text("Delete \u{201C}\(trip.name)\u{201D}?"),
                message: Text("This permanently removes the trip and everything in it. This can't be undone."),
                primaryButton: .destructive(Text("Delete")) { delete(trip) },
                secondaryButton: .cancel()
            )
        }
    }

    private func reload() {
        trips = (try? store.listTripSummaries()) ?? []
    }

    private func move(from source: IndexSet, to destination: Int) {
        trips.move(fromOffsets: source, toOffset: destination)
        try? store.reorderTrips(orderedIds: trips.map(\.id))
    }

    private func delete(_ trip: TripSummary) {
        try? store.deleteTrip(trip.id)
        reload()
    }
}
