// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "TripKrakenApp",
    // Matches TripKrakenKit's floor (ADR-0044: MKMapItem.address/.location need macOS 26.0+).
    platforms: [
        .macOS(.v26)
    ],
    dependencies: [
        .package(path: "../TripKrakenKit")
    ],
    targets: [
        .executableTarget(
            name: "TripKrakenApp",
            dependencies: [
                "TripKrakenKit",
                .product(name: "TripKrakenStore", package: "TripKrakenKit"),
                .product(name: "TripKrakenRouting", package: "TripKrakenKit"),
            ]
        ),
        // THROWAWAY — see the /prototype skill's own doc comment at the top of its one source file.
        // Answered the day-header metro/date/day visual-hierarchy question for issue #235; the
        // validated decision landed on swift-native at 7602907. Kept here only as a primary source.
        .executableTarget(
            name: "DayHeaderPrototype",
            dependencies: ["TripKrakenKit"]
        ),
    ]
)
