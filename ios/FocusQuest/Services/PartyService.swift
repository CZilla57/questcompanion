import Foundation

// The Campaign — Phase 2 (Party): the co-op shared-encounter endpoints.
enum PartyService {
    /// The user's parties (accepted partnerships) and their shared foes. The
    /// server lazily spawns a tier-1 foe on first view, so this returns one entry
    /// per accepted ally.
    static func encounters() async throws -> [PartyEncounter] {
        try await APIClient.shared.get("party/encounters")
    }
}
