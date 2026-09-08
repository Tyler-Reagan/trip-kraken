// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "TripKrakenKit",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "TripKrakenKit", targets: ["TripKrakenKit"]),
        .library(name: "TripKrakenStore", targets: ["TripKrakenStore"]),
    ],
    targets: [
        .target(name: "TripKrakenKit"),
        .testTarget(name: "TripKrakenKitTests", dependencies: ["TripKrakenKit"]),

        // SwiftData persistence (ADR-0040). Kept out of TripKrakenKit so the pure domain module
        // never links a persistence framework.
        .target(name: "TripKrakenStore", dependencies: ["TripKrakenKit"]),
        .testTarget(name: "TripKrakenStoreTests", dependencies: ["TripKrakenStore", "TripKrakenKit"]),
    ]
)
