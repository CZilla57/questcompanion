import WidgetKit
import SwiftUI
import AppIntents

/// User-selectable filter for the configurable widget. Kept within what the v2
/// snapshot carries: a single next-up quest, or today's list.
enum QuestFilterOption: String, AppEnum {
    case nextUp
    case allToday

    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Show" }
    static var caseDisplayRepresentations: [QuestFilterOption: DisplayRepresentation] {
        [.nextUp: "Next Up", .allToday: "Today's List"]
    }
}

/// Widget configuration intent surfaced in the widget's long-press → Edit sheet.
struct FocusConfigIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Focus Widget"
    static var description = IntentDescription("Choose what the widget shows.")

    @Parameter(title: "Show", default: .nextUp)
    var filter: QuestFilterOption
}

/// Carries the chosen filter alongside the snapshot so the view can honor the
/// user's Edit-sheet selection.
struct FocusConfigEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
    let filter: QuestFilterOption
}

/// Mirrors `FocusProvider` but typed to `FocusConfigIntent` so the selected
/// filter reaches the view.
struct FocusConfigProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> FocusConfigEntry {
        FocusConfigEntry(date: .now, snapshot: .placeholder, filter: .nextUp)
    }

    func snapshot(for configuration: FocusConfigIntent, in context: Context) async -> FocusConfigEntry {
        let snap = context.isPreview ? .placeholder : (WidgetSharedStore.read() ?? .empty)
        return FocusConfigEntry(date: .now, snapshot: snap, filter: configuration.filter)
    }

    func timeline(for configuration: FocusConfigIntent, in context: Context) async -> Timeline<FocusConfigEntry> {
        let snap = WidgetSharedStore.read() ?? .empty
        let next = Calendar.current.date(byAdding: .minute, value: 30, to: .now) ?? .now.addingTimeInterval(1800)
        let entry = FocusConfigEntry(date: .now, snapshot: snap, filter: configuration.filter)
        return Timeline(entries: [entry], policy: .after(next))
    }
}

struct ConfigurableFocusWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: "FocusQuestConfigurable",
            intent: FocusConfigIntent.self,
            provider: FocusConfigProvider()
        ) { entry in
            ConfigurableFocusView(snapshot: entry.snapshot, filter: entry.filter)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Focus (Configurable)")
        .description("Next-up quest or today's list — your choice.")
        .supportedFamilies([.systemMedium])
    }
}

struct ConfigurableFocusView: View {
    let snapshot: WidgetSnapshot
    let filter: QuestFilterOption

    var body: some View {
        switch filter {
        case .nextUp:
            nextUp
        case .allToday:
            QuestListView(snapshot: snapshot)
        }
    }

    private var nextUp: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("NEXT UP").font(.caption2.bold()).foregroundStyle(.secondary)
            if let id = snapshot.nextQuestId, let title = snapshot.focusQuestTitle {
                Text(title).font(.headline).lineLimit(3)
                Spacer(minLength: 4)
                Button(intent: CompleteQuestIntent(quest: QuestEntity(id: id, title: title))) {
                    Label("Complete", systemImage: "checkmark.circle")
                        .font(.caption2.bold())
                        .padding(.vertical, 5).padding(.horizontal, 10)
                        .background(Color.cyan.opacity(0.22), in: Capsule())
                        .foregroundStyle(Color.cyan)
                }
                .buttonStyle(.plain)
            } else {
                Text(snapshot.focusQuestTitle ?? "All clear today")
                    .font(.headline).foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
