/// Filesystem-style disambiguation: "Trip" → "Trip (2)" → "Trip (3)" … skipping whichever numbers
/// are already taken, exactly like Finder/Explorer resolving a same-named file. Used to default the
/// rename option when a re-import collides with an existing trip name.
public func dedupeName(_ base: String, existingNames: [String]) -> String {
    guard existingNames.contains(base) else { return base }
    var n = 2
    while existingNames.contains("\(base) (\(n))") { n += 1 }
    return "\(base) (\(n))"
}
