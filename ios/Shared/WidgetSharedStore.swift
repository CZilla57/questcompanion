import Foundation
import WidgetKit

/// A single quest surfaced in the widget's snapshot list.
struct SnapshotQuest: Codable, Hashable, Identifiable {
    let id: Int
    let title: String
    let completed: Bool
}

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
    /// Id of the quest the app is nudging next (matches `focusQuestTitle`), for deep
    /// links and completion actions. `nil` when there's no next quest.
    var nextQuestId: Int? = nil
    /// A short list of today's quests for widgets that show more than the single
    /// next-up quest.
    var topQuests: [SnapshotQuest] = []
    /// Coin balance, when available. `nil` when not yet known.
    var coins: Int? = nil
    /// Whether a focus session is currently active.
    var activeFocus: Bool = false

    /// Shown before any real data has been written (widget gallery / first install).
    static let placeholder = WidgetSnapshot(
        focusQuestTitle: "Plan tomorrow's top three",
        streakDays: 5,
        level: 4,
        levelName: "Trailblazer",
        todayCompleted: 2,
        todayTotal: 6,
        updatedAt: .now,
        nextQuestId: 1,
        topQuests: [
            SnapshotQuest(id: 1, title: "Plan tomorrow's top three", completed: false),
            SnapshotQuest(id: 2, title: "Clear the inbox", completed: true),
        ],
        coins: 120,
        activeFocus: false)

    /// Empty state — authenticated but nothing due today.
    static let empty = WidgetSnapshot(
        focusQuestTitle: nil,
        streakDays: 0,
        level: 1,
        levelName: "Novice",
        todayCompleted: 0,
        todayTotal: 0,
        updatedAt: .now,
        nextQuestId: nil,
        topQuests: [],
        coins: 0,
        activeFocus: false)
}

/// The v1 on-disk shape, kept only to migrate an already-stored snapshot into v2.
private struct LegacySnapshotV1: Codable {
    var focusQuestTitle: String?
    var streakDays: Int
    var level: Int
    var levelName: String
    var todayCompleted: Int
    var todayTotal: Int
    var updatedAt: Date
}

/// Reads and writes the shared `WidgetSnapshot` in the App Group container. The
/// app writes on foreground / data refresh; the widget's `TimelineProvider` reads.
enum WidgetSharedStore {
    /// App Group id — must be listed in BOTH targets' entitlements.
    static let appGroupID = "group.app.focusquest"
    private static let snapshotKey = "widget.snapshot.v2"
    private static let legacyKey = "widget.snapshot.v1"

    private static var defaults: UserDefaults? { UserDefaults(suiteName: appGroupID) }

    /// The widget "Start Focus" deep link the app routes to the Focus tab.
    static let startFocusURL = URL(string: "focusquest://focus")!

    /// Persist the latest snapshot and ask WidgetKit to refresh all timelines.
    static func write(_ snapshot: WidgetSnapshot) {
        guard let defaults, let data = try? JSONEncoder().encode(snapshot) else { return }
        defaults.set(data, forKey: snapshotKey)
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Read the last-written snapshot, migrating a v1 payload if that's all that's
    /// stored. Returns `nil` if nothing has been stored yet.
    static func read() -> WidgetSnapshot? {
        if let data = defaults?.data(forKey: snapshotKey),
           let snap = try? JSONDecoder().decode(WidgetSnapshot.self, from: data) {
            return snap
        }
        // Migrate a v1 payload: decode the old shape, map new fields to defaults.
        if let data = defaults?.data(forKey: legacyKey),
           let legacy = try? JSONDecoder().decode(LegacySnapshotV1.self, from: data) {
            return WidgetSnapshot(
                focusQuestTitle: legacy.focusQuestTitle, streakDays: legacy.streakDays,
                level: legacy.level, levelName: legacy.levelName,
                todayCompleted: legacy.todayCompleted, todayTotal: legacy.todayTotal,
                updatedAt: legacy.updatedAt,
                nextQuestId: nil, topQuests: [], coins: nil, activeFocus: false)
        }
        return nil
    }
}
