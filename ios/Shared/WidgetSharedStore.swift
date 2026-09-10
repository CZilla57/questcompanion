import Foundation
import WidgetKit

/// Small at-a-glance snapshot the app writes and the widgets read. Shared through
/// the App Group container so the extension (a separate process) can render it
/// without a network call. Compiled into BOTH the app and widget targets.
struct WidgetSnapshot: Codable, Hashable {
    /// Title of the quest the app is nudging next — the momentum focus pick, or the
    /// first pending quest. `nil` when today's list is clear.
    var focusQuestTitle: String?
    var streakDays: Int
    var level: Int
    var levelName: String
    var todayCompleted: Int
    var todayTotal: Int
    /// When the snapshot was written — lets a widget show "as of" freshness if needed.
    var updatedAt: Date

    /// Shown before any real data has been written (widget gallery / first install).
    static let placeholder = WidgetSnapshot(
        focusQuestTitle: "Plan tomorrow's top three",
        streakDays: 5,
        level: 4,
        levelName: "Trailblazer",
        todayCompleted: 2,
        todayTotal: 6,
        updatedAt: .now)

    /// Empty state — authenticated but nothing due today.
    static let empty = WidgetSnapshot(
        focusQuestTitle: nil,
        streakDays: 0,
        level: 1,
        levelName: "Novice",
        todayCompleted: 0,
        todayTotal: 0,
        updatedAt: .now)
}

/// Reads and writes the shared `WidgetSnapshot` in the App Group container. The
/// app writes on foreground / data refresh; the widget's `TimelineProvider` reads.
enum WidgetSharedStore {
    /// App Group id — must be listed in BOTH targets' entitlements.
    static let appGroupID = "group.app.focusquest"
    private static let snapshotKey = "widget.snapshot.v1"

    private static var defaults: UserDefaults? { UserDefaults(suiteName: appGroupID) }

    /// The widget "Start Focus" deep link the app routes to the Focus tab.
    static let startFocusURL = URL(string: "focusquest://focus")!

    /// Persist the latest snapshot and ask WidgetKit to refresh all timelines.
    static func write(_ snapshot: WidgetSnapshot) {
        guard let defaults, let data = try? JSONEncoder().encode(snapshot) else { return }
        defaults.set(data, forKey: snapshotKey)
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Read the last-written snapshot, or `nil` if nothing has been stored yet.
    static func read() -> WidgetSnapshot? {
        guard let data = defaults?.data(forKey: snapshotKey) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }
}
