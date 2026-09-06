import Foundation

/// Timezone helper — the API anchors "today" logic on the client's IANA zone.
enum TZ {
    static var identifier: String { TimeZone.current.identifier }
    static var today: String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }

    /// A `yyyy-MM-dd` string for `days` from today in the current tz (days may be 0).
    static func dateString(daysFromToday days: Int) -> String {
        let base = Calendar.current.date(byAdding: .day, value: days, to: Date()) ?? Date()
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: base)
    }
}

enum UserService {
    static func stats() async throws -> UserStats {
        try await APIClient.shared.get("users/me/stats", query: ["tz": TZ.identifier])
    }

    static func heroStatus() async throws -> HeroStatus {
        try await APIClient.shared.get("users/me/hero-status")
    }

    static func kingdoms() async throws -> KingdomsResponse {
        try await APIClient.shared.get("users/me/kingdoms")
    }

    // The Campaign — Phase 0 / Phase 2.
    static func characterSheet() async throws -> CharacterSheet {
        try await APIClient.shared.get("users/me/character-sheet")
    }

    static func currentEncounter() async throws -> PersonalEncounterStatus {
        try await APIClient.shared.get("encounter/current")
    }

    // The Campaign — Phase 3: the Dungeon Master's beat for today. Returns nil
    // when there is nothing to narrate (or the endpoint isn't deployed yet); the
    // caller hides the card rather than surfacing an error.
    static func dmBeat(kind: DmBeatKind) async -> DmBeat? {
        let response: DmBeatResponse? = try? await APIClient.shared.get(
            "dm/beat", query: ["kind": kind.rawValue, "tz": TZ.identifier])
        return response?.beat
    }

    static func me() async throws -> User {
        try await APIClient.shared.get("users/me")
    }

    static func notificationPrefs() async throws -> NotificationPrefs {
        try await APIClient.shared.get("users/me/notification-prefs")
    }

    @discardableResult
    static func updateNotificationPrefs(_ prefs: NotificationPrefs) async throws -> NotificationPrefs {
        try await APIClient.shared.patch("users/me/notification-prefs", body: prefs)
    }

    static func setTimezone() async throws {
        let _: Empty = try await APIClient.shared.request(
            "users/me/timezone", method: .post, body: TimezoneInput(tz: TZ.identifier)
        )
    }
}
