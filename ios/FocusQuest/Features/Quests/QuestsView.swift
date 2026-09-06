import SwiftUI

@MainActor
final class QuestsViewModel: ObservableObject {
    /// Status sub-filter inside the Today tab (mirrors the web log's status select).
    enum Status: String, CaseIterable, Identifiable {
        case today = "Today", all = "All", done = "Done"
        var id: String { rawValue }
    }

    @Published var status: Status = .today { didSet { Task { await load() } } }
    @Published var state: Loadable<[Quest]> = .idle
    @Published var showQuickAdd = false
    @Published var completion: TaskCompletionResult?
    /// Campaigns is a progressive-unlock feature (Gentle Door). Fails OPEN: the
    /// tab stays visible until stats tell us it's locked, matching the web.
    @Published var campaignsUnlocked = true

    func load() async {
        state = .loading
        do {
            let quests: [Quest]
            switch status {
            case .today: quests = try await QuestService.list(date: TZ.today)
            case .all: quests = Self.collapseRecurring(try await QuestService.list())
            case .done: quests = try await QuestService.list(completed: true)
            }
            state = .loaded(quests)
        } catch {
            state = .failed(error.userMessage)
        }
    }

    /// The unfiltered "All" list contains every spawned iteration of a recurring
    /// ritual, so a daily habit stacks up dozens of near-identical rows. Collapse
    /// each recurring template to just its latest occurrence (by dueDate), keeping
    /// one-off quests (no recurringTaskId / no dueDate) untouched. Server order is
    /// preserved for the survivors.
    static func collapseRecurring(_ quests: [Quest]) -> [Quest] {
        var latestDueByTemplate: [Int: String] = [:]
        for q in quests {
            guard let template = q.recurringTaskId, let due = q.dueDate else { continue }
            if let seen = latestDueByTemplate[template], seen >= due { continue }
            latestDueByTemplate[template] = due
        }
        var keptTemplates = Set<Int>()
        return quests.filter { q in
            guard let template = q.recurringTaskId, let due = q.dueDate,
                  let latest = latestDueByTemplate[template] else { return true }
            // Keep the first row matching the winning dueDate; drop the rest.
            guard due == latest, !keptTemplates.contains(template) else { return false }
            keptTemplates.insert(template)
            return true
        }
    }

    func loadGates() async {
        if let stats = try? await UserService.stats() {
            campaignsUnlocked = stats.features.contains(.campaigns)
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

/// Top-level sections of the Quests hub — everything the web splits across the
/// Quests tab group (Today, Questlines, Campaigns, Recurring) on one screen.
enum QuestTab: String, CaseIterable, Identifiable {
    case today = "Today", questlines = "Questlines", campaigns = "Campaigns", recurring = "Recurring"
    var id: String { rawValue }
}

struct QuestsView: View {
    @StateObject private var model = QuestsViewModel()
    @State private var tab: QuestTab = .today

    private var visibleTabs: [QuestTab] {
        QuestTab.allCases.filter { $0 != .campaigns || model.campaignsUnlocked }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                NeonTabs(items: visibleTabs, selection: $tab) { $0.rawValue }
                    .padding(.horizontal, Theme.Space.md)
                    .padding(.top, Theme.Space.sm)
                    .padding(.bottom, Theme.Space.xs)

                switch tab {
                case .today: todayTab
                case .questlines: QuestlinesView()
                case .campaigns: CampaignsView()
                case .recurring: RecurringTasksView()
                }
            }
            .background(Theme.screenBackground)
            .navigationTitle("Quests")
            .toolbar {
                if tab == .today {
                    ToolbarItem(placement: .primaryAction) {
                        Button { model.showQuickAdd = true } label: { Image(systemName: "plus.circle.fill") }
                    }
                }
            }
            .sheet(isPresented: $model.showQuickAdd) {
                QuickAddSheet { _ in Task { await model.load() } }
            }
            .sheet(item: $model.completion) { CompletionSheet(result: $0) }
            .task {
                await model.loadGates()
                if model.state.value == nil { await model.load() }
            }
        }
    }

    // MARK: - Today tab (the quest log)

    private var todayTab: some View {
        AsyncContentView(state: model.state, retry: { Task { await model.load() } }) { quests in
            ScrollView {
                // Same architecture as the Today page: carded rows on the navy
                // ground, split into pending and a dimmed "COMPLETED (n)" group.
                VStack(alignment: .leading, spacing: Theme.Space.lg) {
                    NeonTabs(items: QuestsViewModel.Status.allCases, selection: $model.status) { $0.rawValue }

                    let pending = quests.filter { !$0.completed }
                    let completed = quests.filter(\.completed)

                    if quests.isEmpty {
                        Card { EmptyStateView(symbol: "checklist", title: "Nothing here", message: "Add a quest to get started.") }
                    } else {
                        if !pending.isEmpty {
                            VStack(spacing: Theme.Space.sm) {
                                ForEach(pending) { quest in questItem(quest) }
                            }
                        }
                        if !completed.isEmpty {
                            HStack(spacing: 6) {
                                Image(systemName: "checkmark").font(.outfitCaption2)
                                Text("COMPLETED (\(completed.count))")
                                    .font(.outfitCaption2).textCase(.uppercase).kerning(0.8)
                            }
                            .foregroundStyle(.secondary)
                            .padding(.top, Theme.Space.xs)

                            VStack(spacing: Theme.Space.sm) {
                                ForEach(completed) { quest in questItem(quest) }
                            }
                            .opacity(0.6)
                        }
                    }
                }
                .padding(Theme.Space.lg)
            }
            .background(Theme.screenBackground)
            .refreshable { await model.load() }
        }
    }

    /// A single quest as its own bordered surface, matching the Today page.
    /// Delete lives in a context menu since carded rows aren't in a List.
    private func questItem(_ quest: Quest) -> some View {
        QuestRow(quest: quest) { Task { await model.toggle(quest) } }
            .padding(.horizontal, Theme.Space.md)
            .padding(.vertical, Theme.Space.sm)
            .background(Theme.cardBackground)
            .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous)
                    .strokeBorder(Theme.cardBorder, lineWidth: 1)
            )
            .contextMenu {
                Button(role: .destructive) { Task { await model.delete(quest) } } label: {
                    Label("Delete", systemImage: "trash")
                }
            }
    }
}
