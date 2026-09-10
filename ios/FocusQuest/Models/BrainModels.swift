import Foundation

// MARK: - Brain state & check-ins

struct BrainState: Codable {
    let mode: BrainMode
    let since: String?
    let expiresAt: String?
    let checkedInToday: Bool
    let hyperfocusPausedUntil: String?
}

struct BrainCheckinRequest: Encodable {
    let mode: BrainMode
    let source: String?
    let tz: String
}

struct TimezoneInput: Encodable { let tz: String }
struct HyperfocusPauseInput: Encodable { let minutes: Int }

struct RescueEventRequest: Encodable {
    let taskId: Int?
    let blocker: String
    let intervention: String
}

// MARK: - Reflection

struct ReflectionResponse: Codable {
    let reflection: Reflection?
}

struct Reflection: Codable, Identifiable {
    let id: Int
    let localDate: String
    let prompt: String
    let promptSource: String
    let chips: [String]
    let freeText: String?
    let ack: String?
    let answeredAt: String?
    let createdAt: String
}

struct ReflectionAnswerRequest: Encodable {
    let chips: [String]
    let freeText: String?
    let tz: String?
}

struct ReflectionAnswerResponse: Codable {
    let reflection: Reflection
    let xpAwarded: Int
}

/// Chip metadata (labels for the reflection UI).
enum ReflectionChip {
    static let helped: [(key: String, label: String)] = [
        ("timer", "A timer"),
        ("small_steps", "Small steps"),
        ("body_double", "Body double"),
        ("right_time", "Right time of day"),
        ("low_stakes", "Low stakes"),
        ("treat_reward", "A treat / reward"),
    ]
    static let hindered: [(key: String, label: String)] = [
        ("low_energy", "Low energy"),
        ("too_many_switches", "Too many switches"),
        ("too_big", "Too big"),
        ("distractions", "Distractions"),
        ("time_slipped", "Time slipped away"),
        ("pressure", "Pressure"),
    ]
    static func label(for key: String) -> String {
        (helped + hindered).first { $0.key == key }?.label ?? key
    }
}

// MARK: - Insights

struct InsightsResponse: Codable {
    let days: Int
    let xpHistory: [InsightsXpPoint]
    let categoryBreakdown: [InsightsCategoryBreakdown]
    let dayOfWeekStats: [InsightsDowStat]
    let periodStats: [InsightsPeriodStat]
}

struct InsightsXpPoint: Codable, Identifiable {
    var id: String { date }
    let date: String
    let label: String
    let xp: Int
}

struct InsightsCategoryBreakdown: Codable, Identifiable {
    var id: String { category }
    let category: String
    let label: String
    let completed: Int
    let total: Int
    let xpEarned: Int
}

struct InsightsDowStat: Codable, Identifiable {
    var id: Int { day }
    let day: Int
    let label: String
    let completed: Int
    let total: Int
}

struct InsightsPeriodStat: Codable, Identifiable {
    var id: String { key }
    let key: String
    let label: String
    let range: String
    let completed: Int
}

// MARK: - Patterns

struct PatternSummary: Codable {
    let windowDays: Int
    let sampleSize: PatternSampleSize
    let confidence: String
    let powerHours: [PatternPowerHour]
    let bestDay: Int?
    let medianQuestMinutes: Int?
    let categoryMinutes: [PatternCategoryMinutes]
    let modeByBlock: [PatternModeBlock]
    let topHelpers: [String]
    let topBlockers: [String]
}

struct PatternSampleSize: Codable {
    let completions: Int
    let focusMinutes: Int
    let checkins: Int
    let reflections: Int
}

struct PatternPowerHour: Codable, Identifiable {
    var id: Int { hour }
    let hour: Int
    let score: Double
}

struct PatternCategoryMinutes: Codable, Identifiable {
    var id: String { category }
    let category: String
    let medianActual: Int
    let count: Int
}

struct PatternModeBlock: Codable, Identifiable {
    var id: String { block }
    let block: String
    let dominantMode: String?
}
