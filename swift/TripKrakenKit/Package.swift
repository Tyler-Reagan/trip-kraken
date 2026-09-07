// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "TripKrakenKit",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "TripKrakenKit", targets: ["TripKrakenKit"])
    ],
    targets: [
        .target(name: "TripKrakenKit"),
        .testTarget(name: "TripKrakenKitTests", dependencies: ["TripKrakenKit"]),
    ]
)
