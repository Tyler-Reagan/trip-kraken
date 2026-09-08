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
        )
    ]
)
