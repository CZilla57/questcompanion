import WidgetKit
import SwiftUI

/// A medium/large widget listing today's quests with a per-row Complete button.
/// Reuses `FocusProvider` (reads the shared v2 snapshot); each row's button runs
/// `CompleteQuestIntent` in the extension process and reloads the timeline.
struct QuestListWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FocusQuestList", provider: FocusProvider()) { entry in
            QuestListView(snapshot: entry.snapshot)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Today's Quests")
        .description("Your quests for today with a tap to complete each one.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

private let listAccent = Color.cyan

struct QuestListView: View {
    @Environment(\.widgetFamily) private var family
    let snapshot: WidgetSnapshot

    /// Medium shows 2 rows, large up to 4.
    private var rows: [SnapshotQuest] {
        Array(snapshot.topQuests.prefix(family == .systemLarge ? 4 : 2))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("TODAY'S QUESTS")
                .font(.caption2.bold()).foregroundStyle(.secondary)
            if rows.isEmpty {
                Spacer(minLength: 0)
                Text("All clear today")
                    .font(.subheadline.bold()).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                Spacer(minLength: 0)
            } else {
                ForEach(rows) { quest in
                    QuestRow(quest: quest)
                    if quest.id != rows.last?.id { Divider().opacity(0.4) }
                }
                Spacer(minLength: 0)
            }
        }
    }
}

private struct QuestRow: View {
    let quest: SnapshotQuest

    var body: some View {
        HStack(spacing: 8) {
            Text(quest.title)
                .font(.subheadline)
                .strikethrough(quest.completed, color: .secondary)
                .foregroundStyle(quest.completed ? .secondary : .primary)
                .lineLimit(1)
            Spacer(minLength: 4)
            if quest.completed {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
            } else {
                Button(intent: CompleteQuestIntent(quest: QuestEntity(id: quest.id, title: quest.title))) {
                    Image(systemName: "circle")
                        .foregroundStyle(listAccent)
                }
                .buttonStyle(.plain)
            }
        }
    }
}
