import WidgetKit
import SwiftUI

/// Timeline entry backed by the shared `WidgetSnapshot` the app writes into the
/// App Group container.
struct FocusEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
}

/// Reads the latest snapshot the app persisted. Widgets are static at-a-glance
/// surfaces, so a single-entry timeline refreshed by `reloadAllTimelines()` (called
/// on each app write) is enough — no network in the extension.
struct FocusProvider: TimelineProvider {
    func placeholder(in context: Context) -> FocusEntry {
        FocusEntry(date: .now, snapshot: .placeholder)
    }

    func getSnapshot(in context: Context, completion: @escaping (FocusEntry) -> Void) {
        let snap = context.isPreview ? .placeholder : (WidgetSharedStore.read() ?? .empty)
        completion(FocusEntry(date: .now, snapshot: snap))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<FocusEntry>) -> Void) {
        let snap = WidgetSharedStore.read() ?? .empty
        // Ask the system to refresh in ~30 min even if the app never foregrounds,
        // so streak/level don't look stale after a day away.
        let next = Calendar.current.date(byAdding: .minute, value: 30, to: .now) ?? .now.addingTimeInterval(1800)
        completion(Timeline(entries: [FocusEntry(date: .now, snapshot: snap)], policy: .after(next)))
    }
}

private let accent = Color.cyan

// MARK: - Home Screen widget (small + medium)

struct FocusQuestHomeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FocusQuestHome", provider: FocusProvider()) { entry in
            FocusHomeView(snapshot: entry.snapshot)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(WidgetSharedStore.startFocusURL)
        }
        .configurationDisplayName("Focus & Streak")
        .description("Today's focus quest, your streak, and a tap to start a focus session.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct FocusHomeView: View {
    @Environment(\.widgetFamily) private var family
    let snapshot: WidgetSnapshot

    var body: some View {
        switch family {
        case .systemMedium: medium
        default: small
        }
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 8) {
            streakLine
            Spacer(minLength: 4)
            questBlock
            Spacer(minLength: 4)
            startFocusPill
        }
    }

    private var medium: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                streakLine
                Spacer(minLength: 4)
                questBlock
            }
            VStack(alignment: .trailing, spacing: 8) {
                levelBadge
                Spacer(minLength: 4)
                todayProgress
                startFocusPill
            }
            .frame(maxWidth: 130, alignment: .trailing)
        }
    }

    // MARK: Pieces

    private var streakLine: some View {
        Label {
            Text("\(snapshot.streakDays)-day streak")
                .font(.caption.bold())
                .lineLimit(1)
        } icon: {
            Image(systemName: "flame.fill").foregroundStyle(.orange)
        }
        .foregroundStyle(.primary)
    }

    private var levelBadge: some View {
        VStack(alignment: .trailing, spacing: 1) {
            Text("LVL \(snapshot.level)").font(.caption2.bold()).foregroundStyle(accent)
            Text(snapshot.levelName).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
        }
    }

    @ViewBuilder private var questBlock: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("NEXT UP").font(.caption2.bold()).foregroundStyle(.secondary)
            if let title = snapshot.focusQuestTitle {
                Text(title).font(.subheadline.bold()).lineLimit(2)
            } else {
                Text("All clear today").font(.subheadline.bold()).foregroundStyle(.secondary)
            }
        }
    }

    private var todayProgress: some View {
        Text("\(snapshot.todayCompleted)/\(snapshot.todayTotal) done")
            .font(.caption2).foregroundStyle(.secondary)
    }

    private var startFocusPill: some View {
        Label("Start Focus", systemImage: "timer")
            .font(.caption2.bold())
            .padding(.vertical, 5).padding(.horizontal, 10)
            .frame(maxWidth: .infinity)
            .background(accent.opacity(0.22), in: Capsule())
            .foregroundStyle(accent)
    }
}

// MARK: - Lock Screen accessory widgets

struct FocusQuestAccessoryWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FocusQuestAccessory", provider: FocusProvider()) { entry in
            FocusAccessoryView(snapshot: entry.snapshot)
                .widgetURL(WidgetSharedStore.startFocusURL)
        }
        .configurationDisplayName("FocusQuest")
        .description("Streak and next quest on the Lock Screen.")
        .supportedFamilies([.accessoryRectangular, .accessoryCircular, .accessoryInline])
    }
}

struct FocusAccessoryView: View {
    @Environment(\.widgetFamily) private var family
    let snapshot: WidgetSnapshot

    var body: some View {
        switch family {
        case .accessoryInline:
            Label("\(snapshot.streakDays)-day streak · \(shortQuest)", systemImage: "flame.fill")
        case .accessoryCircular:
            Gauge(value: progress) {
                Image(systemName: "flame.fill")
            } currentValueLabel: {
                Text("\(snapshot.streakDays)")
            }
            .gaugeStyle(.accessoryCircular)
        default: // accessoryRectangular
            VStack(alignment: .leading, spacing: 2) {
                Label("\(snapshot.streakDays)-day streak", systemImage: "flame.fill")
                    .font(.headline)
                Text(snapshot.focusQuestTitle ?? "All clear today")
                    .font(.caption).lineLimit(2)
            }
            .widgetAccentable()
        }
    }

    private var shortQuest: String { snapshot.focusQuestTitle ?? "all clear" }

    /// Fraction of today's quests completed, for the circular gauge fill.
    private var progress: Double {
        guard snapshot.todayTotal > 0 else { return 0 }
        return min(1, Double(snapshot.todayCompleted) / Double(snapshot.todayTotal))
    }
}
