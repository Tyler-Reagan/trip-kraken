import Testing
import TripKrakenKit

@Suite("dedupeName")
struct DedupeNameTests {
    @Test func noCollision() {
        #expect(dedupeName("Honeymoon", existingNames: []) == "Honeymoon")
        #expect(dedupeName("Honeymoon", existingNames: ["Osaka"]) == "Honeymoon")
    }

    @Test func firstCollisionSuffixesWithTwo() {
        #expect(dedupeName("Honeymoon", existingNames: ["Honeymoon"]) == "Honeymoon (2)")
    }

    @Test func skipsPastTakenNumbers() {
        #expect(dedupeName("Honeymoon", existingNames: ["Honeymoon", "Honeymoon (2)"]) == "Honeymoon (3)")
    }

    @Test("reuses a gap rather than jumping past it")
    func reusesGap() {
        #expect(dedupeName("Honeymoon", existingNames: ["Honeymoon", "Honeymoon (3)"]) == "Honeymoon (2)")
    }
}
