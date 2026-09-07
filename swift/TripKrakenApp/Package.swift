// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "TripKrakenApp",
    platforms: [
        .macOS(.v14)
    ],
    dependencies: [
        .package(path: "../TripKrakenKit")
    ],
    targets: [
        .executableTarget(
            name: "TripKrakenApp",
            dependencies: ["TripKrakenKit"]
        )
    ]
)
