import SwiftUI

/// Central palette and spacing tokens. The app leans on system colors so it
/// adapts to light/dark automatically, with a purple accent matching the
/// FocusQuest brand.
enum Theme {
    static let accent = Color(red: 0.404, green: 0.451, blue: 0.949) // indigo/purple
    static let accentSoft = Color(red: 0.404, green: 0.451, blue: 0.949).opacity(0.15)
    static let gold = Color(red: 0.98, green: 0.75, blue: 0.18)
    static let success = Color(red: 0.20, green: 0.72, blue: 0.47)
    static let danger = Color(red: 0.90, green: 0.30, blue: 0.36)

    static let cardBackground = Color(.secondarySystemGroupedBackground)
    static let screenBackground = Color(.systemGroupedBackground)

    enum Space {
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 24
    }

    static let cornerRadius: CGFloat = 16
}

extension Color {
    /// Parses `#RRGGBB` / `RRGGBB` hero avatar colors from the API. Falls back to
    /// the app accent on anything unparseable.
    init(hex: String?) {
        guard let hex else { self = Theme.accent; return }
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let value = UInt64(s, radix: 16) else { self = Theme.accent; return }
        self = Color(
            red: Double((value & 0xFF0000) >> 16) / 255,
            green: Double((value & 0x00FF00) >> 8) / 255,
            blue: Double(value & 0x0000FF) / 255
        )
    }
}

/// Priority → color mapping used across quest rows.
extension Priority {
    var color: Color {
        switch self {
        case .high: return Theme.danger
        case .medium: return Theme.gold
        case .low: return Theme.success
        }
    }
    var label: String { rawValue.capitalized }
}
