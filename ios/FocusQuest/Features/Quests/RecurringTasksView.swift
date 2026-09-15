import SwiftUI

@MainActor
final class RecurringViewModel: ObservableObject {
    @Published var state: Loadable<[RecurringTask]> = .idle
    func load() async {
        state = .loading
        do { state = .loaded(try await QuestService.recurringList()) }
        catch { state = .failed(error.userMessage) }
    }
    func toggle(_ task: RecurringTask) async {
        _ = try? await QuestService.recurringToggle(id: task.id)
        await load()
    }

    /// Replace a template in place after an edit — the PATCH returns the full
    /// formatted row, so there's no need to re-fetch the whole list.
    func update(_ task: RecurringTask) {
        guard case .loaded(var tasks) = state,
              let idx = tasks.firstIndex(where: { $0.id == task.id }) else { return }
        tasks[idx] = task
        state = .loaded(tasks)
    }
}

struct RecurringTasksView: View {
    @StateObject private var model = RecurringViewModel()
    @State private var editing: RecurringTask?

    var body: some View {
        AsyncContentView(state: model.state, retry: { Task { await model.load() } }) { tasks in
            NeonList {
                if tasks.isEmpty {
                    EmptyStateView(symbol: "repeat", title: "No recurring quests", message: "Habits and routines show up here.")
                }
                ForEach(tasks) { task in
                    HStack {
                        // Tap the info area to edit; the pause/resume button stays
                        // a separate tap target.
                        Button { editing = task } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    HStack(spacing: 4) {
                                        Image(systemName: task.category.symbol).foregroundStyle(Theme.accent)
                                        Text(task.title)
                                    }
                                    .font(.outfitSubheadline)
                                    Text(task.scheduleLabel).font(.outfitCaption).foregroundStyle(.secondary)
                                    if task.currentStreak > 0 {
                                        Label("\(task.currentStreak) \(task.streakUnit) streak", systemImage: "flame.fill")
                                            .font(.outfitCaption2).foregroundStyle(Theme.gold)
                                            .labelStyle(TealIconLabelStyle(spacing: 3))
                                    }
                                }
                                Spacer()
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)

                        Button { Task { await model.toggle(task) } } label: {
                            Image(systemName: task.isActive ? "pause.circle.fill" : "play.circle")
                                .font(.outfitTitle2)
                                .foregroundStyle(task.isActive ? Theme.accent : .secondary)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .refreshable { await model.load() }
        }
        .navigationTitle("Recurring")
        .task { if model.state.value == nil { await model.load() } }
        .sheet(item: $editing) { task in
            EditRecurringSheet(task: task) { model.update($0) }
        }
    }
}
