import Foundation

/// Task/quest category. Decodes unknown server values to `.default` so a new
/// backend category never breaks the client.
enum TaskCategory: String, Codable, CaseIterable {
    case health, deepWork = "deep_work", learning, finance, admin
    case household, social, creative, selfCare = "self_care", errands, travel
    case `default`

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = TaskCategory(rawValue: raw) ?? .default
    }

    var emoji: String {
        switch self {
        case .health: return "❤️"
        case .deepWork: return "🧠"
        case .learning: return "📚"
        case .finance: return "💰"
        case .admin: return "🗂️"
        case .household: return "🏠"
        case .social: return "👥"
        case .creative: return "🎨"
        case .selfCare: return "🧘"
        case .errands: return "🧾"
        case .travel: return "✈️"
        case .default: return "⭐️"
        }
    }
}

enum Priority: String, Codable, CaseIterable {
    case low, medium, high

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Priority(rawValue: raw) ?? .medium
    }
}

enum Difficulty: String, Codable, CaseIterable {
    case easy, medium, hard

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Difficulty(rawValue: raw) ?? .medium
    }
}

/// Progressive-unlock feature groups (Gentle Door). Unknown values decode to nil
/// via `[FeatureKey?]` handling at call sites.
enum FeatureKey: String, Codable {
    case focus, hero, progress, allies, rewards, campaigns

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        guard let value = FeatureKey(rawValue: raw) else {
            throw DecodingError.dataCorrupted(
                .init(codingPath: decoder.codingPath, debugDescription: "Unknown feature \(raw)")
            )
        }
        self = value
    }
}

enum BrainMode: String, Codable {
    case focused, distracted, frozen, hyperfocus, neutral

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = BrainMode(rawValue: raw) ?? .neutral
    }

    var label: String {
        switch self {
        case .focused: return "Focused"
        case .distracted: return "Distracted"
        case .frozen: return "Frozen"
        case .hyperfocus: return "Hyperfocus"
        case .neutral: return "Neutral"
        }
    }

    var emoji: String {
        switch self {
        case .focused: return "🎯"
        case .distracted: return "🌀"
        case .frozen: return "🧊"
        case .hyperfocus: return "🔥"
        case .neutral: return "😌"
        }
    }
}

enum FocusPresetKey: String, Codable {
    case classic, deep, short

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = FocusPresetKey(rawValue: raw) ?? .classic
    }
}
