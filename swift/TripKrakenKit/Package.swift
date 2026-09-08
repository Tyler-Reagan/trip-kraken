// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "TripKrakenKit",
    // Raised from iOS 17/macOS 14 to 26 for ADR-0044: MKMapItem's `address`/`location` properties
    // (used by MKLocalSearchRequester) are macOS/iOS 26.0+ only — a genuinely new-this-cycle API,
    // not an oversight. No back-compat obligation exists pre-launch (no users, not deployed).
    platforms: [
        .iOS(.v26),
        .macOS(.v26),
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
