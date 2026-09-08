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
        .library(name: "TripKrakenRouting", targets: ["TripKrakenRouting"]),
    ],
    targets: [
        .target(name: "TripKrakenKit"),
        .testTarget(name: "TripKrakenKitTests", dependencies: ["TripKrakenKit"]),

        // SwiftData persistence (ADR-0040). Kept out of TripKrakenKit so the pure domain module
        // never links a persistence framework.
        .target(name: "TripKrakenStore", dependencies: ["TripKrakenKit"]),
        .testTarget(name: "TripKrakenStoreTests", dependencies: ["TripKrakenStore", "TripKrakenKit"]),

        // Every PathGeometryProviding implementation (MapKit on-device, HTTP for rail, composite
        // dispatch). Named for what it does, not how — one implementation has no network at all.
        .target(name: "TripKrakenRouting", dependencies: ["TripKrakenKit"]),
        .testTarget(name: "TripKrakenRoutingTests", dependencies: ["TripKrakenRouting", "TripKrakenKit"]),
    ]
)
