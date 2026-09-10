import SwiftUI
import UIKit

/// Central palette and spacing tokens. Mirrors the web app's "Electric Neon
/// Dark" theme (see artifacts/focusquest/src/index.css): a deep-space navy
/// ground, electric-cyan primary, and neon purple/pink accents. The app runs
/// dark-only to match the web client (forced via `.preferredColorScheme(.dark)`
/// on the root), so these are explicit colors rather than system-adaptive ones.
enum Theme {
    // Electric cyan — the web `--primary`. Named `accent` because the existing
    // components already tint off `Theme.accent`, so this recolors them all.
    static let accent = Color(h: 180, s: 1.00, l: 0.50)
    static let accentSoft = accent.opacity(0.15)

    // Neon purple (`--secondary`) and neon pink (`--accent`) from the web theme.
    static let purple = Color(h: 270, s: 0.80, l: 0.60)
    static let pink = Color(h: 320, s: 0.80, l: 0.60)

    static let gold = Color(h: 45, s: 1.00, l: 0.55)   // web chart-5 yellow
    static let success = Color(h: 150, s: 0.80, l: 0.50) // web chart-4 green
    static let danger = Color(h: 350, s: 0.80, l: 0.55)  // web --destructive

    // Surfaces: deep-space navy ground, slightly lighter elevated cards.
    static let screenBackground = Color(h: 230, s: 0.40, l: 0.06) // web --background
    static let cardBackground = Color(h: 230, s: 0.40, l: 0.08)   // web --card
    static let cardBorder = Color(h: 230, s: 0.30, l: 0.15)       // web --border

    // Text
    static let foreground = Color(h: 210, s: 0.20, l: 0.98)
    static let mutedForeground = Color(h: 215, s: 0.15, l: 0.65)

    // Cyan glow used on elevated surfaces (web `--shadow`).
    static let glow = accent.opacity(0.18)

    enum Space {
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 24
    }

    static let cornerRadius: CGFloat = 12 // web --radius: 0.75rem

    /// Styles the UIKit-backed chrome (nav bars, tab bar) that SwiftUI doesn't
    /// reach through its own modifiers, so they match the neon-dark palette.
    static func configureUIKitAppearance() {
        let ground = UIColor(screenBackground)
        let elevated = UIColor(cardBackground)
        let text = UIColor(foreground)
        let muted = UIColor(mutedForeground)
        let cyan = UIColor(accent)

        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = ground
        nav.shadowColor = UIColor(cardBorder)
        nav.titleTextAttributes = [.foregroundColor: text, .font: AppFont.uiFont(17, weight: .semibold)]
        nav.largeTitleTextAttributes = [.foregroundColor: text, .font: AppFont.uiFont(34, weight: .bold)]
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        UINavigationBar.appearance().compactAppearance = nav
        UINavigationBar.appearance().tintColor = cyan

        // SwiftUI's root `.tint` doesn't always reach controls inside a pushed
        // List/Form on every iOS version, so switches (and other UIKit-backed
        // controls) can fall back to the system blue. Pin them to teal here.
        UISwitch.appearance().onTintColor = cyan

        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = elevated
        tab.shadowColor = UIColor(cardBorder)
        for item in [tab.stackedLayoutAppearance, tab.inlineLayoutAppearance, tab.compactInlineLayoutAppearance] {
            let labelFont = AppFont.uiFont(10, weight: .medium)
            item.normal.iconColor = muted
            item.normal.titleTextAttributes = [.foregroundColor: muted, .font: labelFont]
            item.selected.iconColor = cyan
            item.selected.titleTextAttributes = [.foregroundColor: cyan, .font: labelFont]
        }
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab
    }
}

extension Color {
    /// Builds a color from HSL so tokens can mirror the web app's CSS values
    /// verbatim. `h` is 0–360 degrees; `s` and `l` are 0–1.
    init(h: Double, s: Double, l: Double, opacity: Double = 1) {
        let c = (1 - abs(2 * l - 1)) * s
        let hp = h / 60
        let x = c * (1 - abs(hp.truncatingRemainder(dividingBy: 2) - 1))
        let (r1, g1, b1): (Double, Double, Double)
        switch hp {
        case 0..<1: (r1, g1, b1) = (c, x, 0)
        case 1..<2: (r1, g1, b1) = (x, c, 0)
        case 2..<3: (r1, g1, b1) = (0, c, x)
        case 3..<4: (r1, g1, b1) = (0, x, c)
        case 4..<5: (r1, g1, b1) = (x, 0, c)
        default:    (r1, g1, b1) = (c, 0, x)
        }
        let m = l - c / 2
        self = Color(red: r1 + m, green: g1 + m, blue: b1 + m, opacity: opacity)
    }

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
