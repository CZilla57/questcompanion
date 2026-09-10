import Foundation

// MARK: - Weekly recaps

struct RecapsResponse: Codable {
    let emailEnabled: Bool
    let emailKnown: Bool
    let recaps: [WeeklyRecapItem]
}

struct WeeklyRecapItem: Codable, Identifiable {
    var id: String { weekKey }
    let weekKey: String
    let stats: WeeklyRecapStats
    let narrative: String
    let sentAt: String?
}

struct WeeklyRecapStats: Codable {
    let weekKey: String
    let questsCompleted: Int
    let sampleQuestTitles: [String]
    let focusSessions: Int
    let focusMinutes: Int
    let xpEarned: Int
    let coinsEarned: Int
    let initiations: Int
    let levelUps: Int
    let badges: [String]
    let questlinesCompleted: [String]
}

struct RecapEmailSettingsRequest: Encodable { let enabled: Bool }
struct RecapEmailSettingsResponse: Codable { let emailEnabled: Bool }

// MARK: - Notification preferences

struct NotificationPrefs: Codable {
    var protection: Bool
    var reminders: Bool
    var reflection: Bool
    var hero: Bool
    var quietHoursStart: Int
    var quietHoursEnd: Int
}

// MARK: - Shortcut tokens (Apple Shortcuts integration)

struct ShortcutTokenSummary: Codable, Identifiable {
    let id: Int
    let label: String?
    let createdAt: String
    let lastUsedAt: String?
}

struct MintShortcutTokenRequest: Encodable { let label: String? }

struct ShortcutTokenMinted: Codable {
    let id: Int
    let label: String?
    let createdAt: String
    let token: String
}

// MARK: - Generic envelopes

struct SuccessEnvelope: Codable { let success: Bool }
