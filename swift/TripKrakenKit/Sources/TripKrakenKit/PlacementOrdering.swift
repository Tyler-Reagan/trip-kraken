/// Pure placement-ordering algorithm (ADR-0015 §2), shared by the persistence layer and any
/// optimistic client-side patch so both apply the exact same reordering semantics — no risk of a
/// client's optimistic guess drifting from what actually gets persisted.

public enum PlacementOrderingError: Error, Sendable {
    case placementNotFound
}

/// Shift siblings on `date` at/after `order` up by one, opening a slot.
private func shiftInto(_ placements: [Placement], date: IsoDate, order: Int) -> [Placement] {
    placements.map { p in
        guard p.date == date, p.order >= order else { return p }
        var shifted = p
        shifted.order += 1
        return shifted
    }
}

/// Re-densify `date`'s placements to a gap-free 0..n-1 order sequence.
private func densify(_ placements: [Placement], date: IsoDate) -> [Placement] {
    let onDate = placements.filter { $0.date == date }.sorted { $0.order < $1.order }
    let orderById = Dictionary(uniqueKeysWithValues: onDate.enumerated().map { ($1.id, $0) })
    return placements.map { p in
        guard let order = orderById[p.id] else { return p }
        var densified = p
        densified.order = order
        return densified
    }
}

/// Move an existing placement to `date`/`order`. Siblings at/after the target order shift down; if
/// the placement left another date, that date's remaining placements are re-densified.
public func reorderPlacements(
    _ placements: [Placement], placementId: String, date: IsoDate, order: Int
) throws(PlacementOrderingError) -> [Placement] {
    guard let current = placements.first(where: { $0.id == placementId }) else {
        throw .placementNotFound
    }
    let sourceDate = current.date

    var next = shiftInto(placements, date: date, order: order)
    next = next.map { p in
        guard p.id == placementId else { return p }
        var moved = p
        moved.date = date
        moved.order = order
        return moved
    }
    if sourceDate != date { next = densify(next, date: sourceDate) }
    return next
}

/// Insert a new placement for `locationId` on `date`. Appends to the end of the date unless `order`
/// is given, in which case siblings at/after it shift down to make room.
public func insertPlacement(
    _ placements: [Placement], id: String, tripId: String, locationId: String, date: IsoDate,
    order: Int? = nil
) -> [Placement] {
    var next = placements
    let resolvedOrder: Int
    if let order {
        resolvedOrder = order
        next = shiftInto(placements, date: date, order: order)
    } else {
        resolvedOrder = placements.filter { $0.date == date }.reduce(-1) { max($0, $1.order) } + 1
    }
    return next + [Placement(id: id, tripId: tripId, locationId: locationId, date: date, order: resolvedOrder)]
}
