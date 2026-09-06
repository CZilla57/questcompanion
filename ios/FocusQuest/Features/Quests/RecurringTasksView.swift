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
}

struct RecurringTasksView: View {
    @StateObject private var model = RecurringViewModel()

    var body: some View {
        AsyncContentView(state: model.state, retry: { Task { await model.load() } }) { tasks in
            NeonList {
                if tasks.isEmpty {
                    EmptyStateView(symbol: "repeat", title: "No recurring quests", message: "Habits and routines show up here.")
                }
                ForEach(tasks) { task in
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
    }
}
