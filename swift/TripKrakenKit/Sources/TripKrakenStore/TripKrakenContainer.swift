import Foundation
import SwiftData

public enum TripKrakenContainer {
    public static let schema = Schema([
        TripRecord.self, LocationRecord.self, PlacementRecord.self, JourneyRoadKindRecord.self,
    ])

    /// An *explicit* store URL, never the default. `ModelContainer`'s default location derives from
    /// the process's bundle identity, and `swift run` produces a bundle-less executable whose
    /// `Bundle.main.bundleIdentifier` is nil — naming the URL removes that dependency entirely, and
    /// survives the eventual move to an `.xcodeproj` unchanged. `TRIPKRAKEN_STORE_PATH` lets a dev
    /// relocate or wipe the store without hunting for Application Support.
    private static func storeDirectory() -> URL {
        if let override = ProcessInfo.processInfo.environment["TRIPKRAKEN_STORE_PATH"] {
            return URL(fileURLWithPath: override, isDirectory: true)
        }
        return URL.applicationSupportDirectory.appending(path: "TripKraken", directoryHint: .isDirectory)
    }

    public static func live() throws -> ModelContainer {
        let dir = storeDirectory()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let config = ModelConfiguration(
            schema: schema,
            url: dir.appending(path: "TripKraken.store"),
            cloudKitDatabase: .none  // ADR-0040 §4: local-only, deliberately — sync isn't scheduled.
        )
        return try ModelContainer(for: schema, configurations: config)
    }

    public static func inMemory() throws -> ModelContainer {
        let config = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)
        return try ModelContainer(for: schema, configurations: config)
    }
}
