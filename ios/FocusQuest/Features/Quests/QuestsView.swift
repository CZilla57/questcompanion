import SwiftUI

@MainActor
final class QuestsViewModel: ObservableObject {
    enum Filter: String, CaseIterable, Identifiable {
        case today = "Today", all = "All", done = "Done"
        var id: String { rawValue }
    }

    @Published var filter: Filter = .today { didSet { Task { await load() } } }
    @Published var state: Loadable<[Quest]> = .idle
    @Published var showQuickAdd = false
    @Published var completion: TaskCompletionResult?

    func load() async {
        state = .loading
        do {
            let quests: [Quest]
            switch filter {
            case .today: quests = try await QuestService.list(date: TZ.today)
            case .all: quests = try await QuestService.list()
            case .done: quests = try await QuestService.list(completed: true)
            }
            state = .loaded(quests)
        } catch {
            state = .failed(error.userMessage)
        }
    }

    func toggle(_ quest: Quest) async {
        do {
            if quest.completed { _ = try await QuestService.uncomplete(id: quest.id) }
            else {
                let result = try await QuestService.complete(id: quest.id)
                if result.leveledUp || !result.newBadges.isEmpty { completion = result }
            }
            await load()
        } catch { await load() }
    }

    func delete(_ quest: Quest) async {
        try? await QuestService.delete(id: quest.id)
        await load()
    }
}

struct QuestsView: View {
    @StateObject private var model = QuestsViewModel()

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Filter", selection: $model.filter) {
                    ForEach(QuestsViewModel.Filter.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding(Theme.Space.md)

                AsyncContentView(state: model.state, retry: { Task { await model.load() } }) { quests in
                    if quests.isEmpty {
                        EmptyStateView(symbol: "checklist", title: "Nothing here", message: "Add a quest to get started.")
                    } else {
                        List {
                            ForEach(quests) { quest in
                                QuestRow(quest: quest) { Task { await model.toggle(quest) } }
                                    .swipeActions(edge: .trailing) {
                                        Button(role: .destructive) { Task { await model.delete(quest) } } label: {
                                            Label("Delete", systemImage: "trash")
                                        }
                                    }
                            }
                        }
                        .listStyle(.plain)
                        .refreshable { await model.load() }
                    }
                }
            }
            .background(Theme.screenBackground)
            .navigationTitle("Quests")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        NavigationLink { QuestlinesView() } label: { Label("Questlines", systemImage: "list.bullet.rectangle") }
                        NavigationLink { CampaignsView() } label: { Label("Campaigns", systemImage: "books.vertical") }
                        NavigationLink { RecurringTasksView() } label: { Label("Recurring", systemImage: "repeat") }
                    } label: { Image(systemName: "line.3.horizontal.decrease.circle") }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button { model.showQuickAdd = true } label: { Image(systemName: "plus.circle.fill") }
                }
            }
            .sheet(isPresented: $model.showQuickAdd) {
                QuickAddSheet { _ in Task { await model.load() } }
            }
            .sheet(item: $model.completion) { CompletionSheet(result: $0) }
            .task { if model.state.value == nil { await model.load() } }
        }
    }
}
