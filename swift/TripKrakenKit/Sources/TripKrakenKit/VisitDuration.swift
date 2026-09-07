/// A single source for how an Activity's `visitDuration` (minutes, nullable) resolves to what the
/// optimizer actually uses, and how any duration is displayed (ADR-0023 §9, amended 2026-08-18).
///
/// `nil` keeps meaning "the user hasn't said" — there is no DB default and no backfill. Every
/// caller that needs to know whether a value is a default rather than a choice already holds the
/// raw `LocationBase.visitDuration` and checks it directly; this module only resolves the effective
/// minutes, not a compound "value + provenance" shape, since no caller ever needed both from one
/// place.

/// The flat default (ADR-0023 §9, amended 2026-08-18) — retires category-seeded duration rather
/// than deferring it. Visible and editable in the UI, unlike the invisible default this reverses.
public let defaultVisitMinutes = 30

/// The inline editor's step, and its floor — reverting to "unset" is a distinct action that writes
/// `nil`, never a value this step can reach.
public let visitDurationStepMinutes = 15

/// The editor's practical ceiling. Deliberately below the API's own 1440-minute bound: 1440 is the
/// outer limit of what's *storable*, 720 is the longest single visit worth offering in a picker. A
/// stored value above this still displays fine — it's only the roller's range that stops here.
public let visitDurationMaxMinutes = 720

public func clampVisitDuration(_ mins: Int) -> Int {
    max(visitDurationStepMinutes, min(visitDurationMaxMinutes, mins))
}

/// Which direction a roller step moves.
public enum StepDirection: Sendable {
    case up, down
}

/// The ± buttons' stops: 15m below 1h, 30m to 2h, 1h above — the step grows with the value, so the
/// buttons stay useful across the whole range instead of pretending 15 minutes is a meaningful unit
/// at the four-hour mark. That halves the clicks from the 30m default to a 3h visit (10 → 5).
///
/// A coarse *sequence* rather than a step added to whatever value is current, because the two
/// aren't equivalent: the roller can land on 105m, and adding a band-sized step there gives
/// 105 → 135 → 75, which can't be undone. Moving between fixed stops means every + is reversed by a
/// −, and an off-ladder value snaps onto the ladder rather than wandering further off it.
public let visitDurationLadder: [Int] = {
    var out: [Int] = []
    var m = visitDurationStepMinutes
    while m <= visitDurationMaxMinutes {
        out.append(m)
        m += m < 60 ? 15 : (m < 120 ? 30 : 60)
    }
    return out
}()

public func nextVisitDuration(_ mins: Int, direction: StepDirection) -> Int {
    let stop: Int? =
        direction == .up
        ? visitDurationLadder.first { $0 > mins }
        : visitDurationLadder.reversed().first { $0 < mins }
    return stop ?? clampVisitDuration(mins)
}

/// Every value the roller offers — one flat list, because a duration is one scalar. A two-column
/// hours × minutes picker can express `0h 00m`, which isn't a legal duration; this shape makes the
/// invalid state unrepresentable instead of guarding against it.
public let visitDurationOptions: [Int] =
    (1...(visitDurationMaxMinutes / visitDurationStepMinutes)).map { $0 * visitDurationStepMinutes }

/// The roller index to open on. Nearest rather than exact: the API accepts any integer from 15 to
/// 1440, so a stored value off the 15-minute grid (or above the ceiling) is reachable and must
/// still open the picker somewhere sensible rather than falling back to the first row.
public func nearestVisitDurationIndex(_ mins: Int) -> Int {
    let i = Int((Double(mins) / Double(visitDurationStepMinutes)).rounded()) - 1
    return max(0, min(visitDurationOptions.count - 1, i))
}

/// What the optimizer and the UI both use in place of an unset `visitDuration`.
public func resolveVisitDuration(_ visitDuration: Int?) -> Int {
    visitDuration ?? defaultVisitMinutes
}

/// `0` minutes is unreachable through the editor (see `visitDurationStepMinutes`), so this only
/// ever renders a positive duration.
public func formatDuration(_ mins: Int) -> String {
    let h = mins / 60
    let m = mins % 60
    if h == 0 { return "\(m)m" }
    if m == 0 { return "\(h)h" }
    return "\(h)h \(m)m"
}
