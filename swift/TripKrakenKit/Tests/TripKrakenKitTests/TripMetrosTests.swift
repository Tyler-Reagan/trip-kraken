import Testing
import TripKrakenKit

// Ported from `tripMetros.test.ts`. Fixtures are real `formattedAddress` values off a real trip,
// kept verbatim — including the chōme long-o and the two different Japanese orderings — because
// every bug this parsing has had came from an ordering or a glyph a hand-written fixture would have
// tidied away.

private struct Addressed: NamedAddress {
    var name: String
    var address: String?
}

private func at(_ name: String, _ address: String) -> Addressed {
    Addressed(name: name, address: address)
}

@Suite("metroLabel: the region, not the ward")
struct MetroLabelTests {
    @Test func osakaAddress() {
        #expect(
            metroLabel(activities: [at("MOMOTARO JEANS OSAKA", "1-chōme-12-10 Kitahorie, Nishi Ward, Osaka, 550-0014, Japan")])
                == "Osaka"
        )
    }

    @Test func tokyoAddress() {
        #expect(
            metroLabel(activities: [at("Sensō-ji", "2-chōme-3-1 Asakusa, Taito City, Tokyo 111-0032, Japan")]) == "Tokyo"
        )
    }
}

@Suite("localityOf: the unit below whatever metroLabel said")
struct LocalityOfTests {
    private func locality(_ address: String) -> String? {
        localityOf(address, metro: metroLabel(activities: [at("x", address)]))
    }

    @Test func wardsAndCities() {
        #expect(locality("1-chōme-12-10 Kitahorie, Nishi Ward, Osaka, 550-0014, Japan") == "Nishi Ward")
        #expect(locality("2-chōme-5-5 Nakatsu, Kita Ward, Osaka, 531-0071, Japan") == "Kita Ward")
        #expect(locality("Dotonbori, Chuo Ward, Osaka, 542-0071, Japan") == "Chuo Ward")
        #expect(locality("1-chōme-1-10 Kaigandōri, Minato Ward, Osaka, 552-0022, Japan") == "Minato Ward")
        #expect(locality("2-chōme-3-1 Asakusa, Taito City, Tokyo 111-0032, Japan") == "Taito City")
    }

    @Test("postal code riding with the region strips per-segment, not just per-token")
    func postalRidesWithRegion() {
        #expect(
            locality("2 Chome Kita 1 Jonishi, Chuo Ward, Sapporo, Hokkaido 060-0001, Japan") == "Sapporo",
            "a metro of Hokkaido leaves Sapporo as the locality, not Chuo Ward"
        )
    }

    @Test("nothing worth printing")
    func nothingToPrint() {
        #expect(localityOf(nil, metro: "Osaka") == nil, "no address, no locality")
        #expect(localityOf("Osaka, Japan", metro: "Osaka") == nil, "nothing survives but the metro itself")
        #expect(
            localityOf("1-chōme-12-10 Kitahorie, Japan", metro: "Osaka") == nil,
            "a lone street segment is an address, not a locality"
        )
    }
}
