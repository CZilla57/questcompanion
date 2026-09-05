import SwiftUI

/// A single quest line with a completion toggle. Completion is optimistic —
/// the parent supplies the async action and owns the source of truth.
struct QuestRow: View {
    let quest: Quest
    var onToggle: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Space.md) {
            Button(action: onToggle) {
                Image(systemName: quest.completed ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundStyle(quest.completed ? Theme.success : .secondary)
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 2) {
                Text(quest.title)
                    .font(.body)
                    .strikethrough(quest.completed, color: .secondary)
                    .foregroundStyle(quest.completed ? .secondary : .primary)

                HStack(spacing: Theme.Space.sm) {
                    Text("\(quest.category.emoji) \(quest.categoryLabel)")
                    if let due = DateUtils.dueLabel(quest.dueDate, time: quest.dueTime) {
                        Text("· \(due)")
                    }
                    if quest.bigSwing {
                        Text("· ⚡️ Big swing").foregroundStyle(Theme.gold)
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)

                if !quest.steps.isEmpty {
                    let done = quest.steps.filter(\.done).count
                    Text("Steps \(done)/\(quest.steps.count)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer(minLength: 0)

            VStack(alignment: .trailing, spacing: 4) {
                Text("+\(quest.points)")
                    .font(.caption.bold())
                    .foregroundStyle(Theme.accent)
                Circle().fill(quest.priority.color).frame(width: 8, height: 8)
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}
