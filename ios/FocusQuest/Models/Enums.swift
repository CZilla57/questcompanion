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

    /// SF Symbol used in place of the emoji where we want a tintable vector icon
    /// (rendered in the app's electric teal). Mirrors `emoji` one-to-one.
    var symbol: String {
        switch self {
        case .health: return "heart.fill"
        case .deepWork: return "brain.head.profile"
        case .learning: return "book.fill"
        case .finance: return "dollarsign.circle.fill"
        case .admin: return "folder.fill"
        case .household: return "house.fill"
        case .social: return "person.2.fill"
        case .creative: return "paintpalette.fill"
        case .selfCare: return "figure.mind.and.body"
        case .errands: return "checklist"
        case .travel: return "airplane"
        case .default: return "star.fill"
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

    /// SF Symbol counterpart, rendered in electric teal (see `TaskCategory.symbol`).
    var symbol: String {
        switch self {
        case .focused: return "target"
        case .distracted: return "tornado"
        case .frozen: return "snowflake"
        case .hyperfocus: return "flame.fill"
        case .neutral: return "face.smiling"
        }
    }

    /// Line under the momentum board heading (web MODE_META.flavor); nil renders nothing.
    var flavor: String? {
        switch self {
        case .focused: return "Focused? Good — here's one that moves the needle."
        case .distracted: return "Distracted? Tiny wins below."
        case .frozen: return "Frozen is a state, not a verdict. One small step below."
        case .hyperfocus: return "Flow protected — ride the thread you're on."
        case .neutral: return nil
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
