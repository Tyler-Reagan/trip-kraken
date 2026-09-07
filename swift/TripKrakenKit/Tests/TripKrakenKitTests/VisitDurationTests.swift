import Testing
import TripKrakenKit

@Suite("resolveVisitDuration / formatDuration")
struct VisitDurationBasicsTests {
    @Test func resolvesNilToDefault() {
        #expect(resolveVisitDuration(nil) == defaultVisitMinutes)
        #expect(resolveVisitDuration(90) == 90)
    }

    @Test func formats() {
        #expect(formatDuration(15) == "15m")
        #expect(formatDuration(60) == "1h")
        #expect(formatDuration(90) == "1h 30m")
        #expect(formatDuration(720) == "12h")
    }
}

@Suite("clampVisitDuration")
struct ClampVisitDurationTests {
    @Test func clampsToFloor() {
        #expect(clampVisitDuration(0) == visitDurationStepMinutes)
        #expect(clampVisitDuration(-99) == visitDurationStepMinutes)
    }

    @Test func clampsToCeiling() {
        #expect(clampVisitDuration(9999) == visitDurationMaxMinutes)
    }

    @Test func inRangeUntouched() {
        #expect(clampVisitDuration(45) == 45)
    }
}

@Suite("nextVisitDuration ladder")
struct NextVisitDurationTests {
    @Test("step grows with the value")
    func stepGrows() {
        #expect(nextVisitDuration(30, direction: .up) == 45, "below 1h steps by 15")
        #expect(nextVisitDuration(45, direction: .up) == 60)
        #expect(nextVisitDuration(60, direction: .up) == 90, "at 1h steps by 30")
        #expect(nextVisitDuration(90, direction: .up) == 120)
        #expect(nextVisitDuration(120, direction: .up) == 180, "at 2h steps by 60")
    }

    @Test("30m default reaches 3h in exactly 5 clicks, not 10")
    func headlineClaim() {
        var mins = defaultVisitMinutes
        var seen: [Int] = []
        for _ in 0..<5 {
            mins = nextVisitDuration(mins, direction: .up)
            seen.append(mins)
        }
        #expect(seen == [45, 60, 90, 120, 180])
    }

    @Test("every step up is reversed by a step down")
    func reversibility() {
        for start in visitDurationLadder {
            let up = nextVisitDuration(start, direction: .up)
            if up != start {
                #expect(nextVisitDuration(up, direction: .down) == start)
            }
            let down = nextVisitDuration(start, direction: .down)
            if down != start {
                #expect(nextVisitDuration(down, direction: .up) == start)
            }
        }
    }

    @Test("an off-ladder value snaps onto the ladder rather than drifting further off")
    func offLadderSnaps() {
        #expect(nextVisitDuration(105, direction: .up) == 120)
        #expect(nextVisitDuration(105, direction: .down) == 90)
        #expect(visitDurationLadder.contains(nextVisitDuration(105, direction: .up)))
    }

    @Test("a stored value above the ceiling is pulled into range by either button")
    func aboveCeiling() {
        #expect(nextVisitDuration(900, direction: .up) == visitDurationMaxMinutes)
        #expect(nextVisitDuration(900, direction: .down) == visitDurationMaxMinutes)
    }

    @Test func floorAndCeilingHold() {
        #expect(nextVisitDuration(visitDurationStepMinutes, direction: .down) == visitDurationStepMinutes)
        #expect(nextVisitDuration(visitDurationMaxMinutes, direction: .up) == visitDurationMaxMinutes)
    }
}

@Suite("roller options")
struct VisitDurationOptionsTests {
    @Test func boundsAndGrid() {
        #expect(visitDurationOptions.first == visitDurationStepMinutes)
        #expect(visitDurationOptions.last == visitDurationMaxMinutes)
        #expect(visitDurationOptions.allSatisfy { $0 % visitDurationStepMinutes == 0 })
        #expect(!visitDurationOptions.contains(0), "zero is not representable")
    }
}

@Suite("nearestVisitDurationIndex")
struct NearestVisitDurationIndexTests {
    @Test func snapsToNearestGridValue() {
        #expect(nearestVisitDurationIndex(15) == 0)
        #expect(nearestVisitDurationIndex(30) == 1)
        #expect(nearestVisitDurationIndex(180) == 11)
        #expect(visitDurationOptions[nearestVisitDurationIndex(20)] == 15)
        #expect(visitDurationOptions[nearestVisitDurationIndex(38)] == 45)
        #expect(visitDurationOptions[nearestVisitDurationIndex(1440)] == visitDurationMaxMinutes)
        #expect(nearestVisitDurationIndex(0) == 0, "never a negative index")
    }
}
