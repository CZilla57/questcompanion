import SwiftUI

@MainActor
final class TodayViewModel: ObservableObject {
    @Published var stats: Loadable<UserStats> = .idle
    @Published var quests: [Quest] = []
    @Published var brain: BrainState?
    @Published var completion: TaskCompletionResult?
    @Published var showQuickAdd = false

    func load() async {
        if stats.value == nil { stats = .loading }
        async let statsResult = UserService.stats()
        async let questResult = QuestService.list(date: TZ.today)
        async let brainResult = try? BrainService.state()
        do {
            let (s, q) = try await (statsResult, questResult)
            stats = .loaded(s)
            quests = q
            brain = await brainResult
        } catch {
            if stats.value == nil { stats = .failed(error.userMessage) }
        }
    }

    func toggle(_ quest: Quest) async {
        do {
            if quest.completed {
                let updated = try await QuestService.uncomplete(id: quest.id)
                replace(updated)
            } else {
                let result = try await QuestService.complete(id: quest.id)
                replace(result.task)
                if result.leveledUp || !result.newBadges.isEmpty || result.pointsAwarded > 0 {
                    completion = result
                }
                await load()
            }
        } catch {
            // Reload to resync on failure.
            await load()
        }
    }

    private func replace(_ quest: Quest) {
        if let idx = quests.firstIndex(where: { $0.id == quest.id }) { quests[idx] = quest }
    }
}

struct TodayView: View {
    @StateObject private var model = TodayViewModel()

    var body: some View {
        NavigationStack {
            AsyncContentView(state: model.stats, retry: { Task { await model.load() } }) { stats in
                ScrollView {
                    VStack(spacing: Theme.Space.lg) {
                        StatsHeader(stats: stats)
                        if let brain = model.brain, !brain.checkedInToday {
                            BrainCheckinPrompt()
                        }
                        todaysQuests
                    }
                    .padding(Theme.Space.lg)
                }
                .background(Theme.screenBackground)
                .refreshable { await model.load() }
            }
            .navigationTitle("Today")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { model.showQuickAdd = true } label: { Image(systemName: "plus.circle.fill") }
                }
            }
            .sheet(isPresented: $model.showQuickAdd) {
                QuickAddSheet { quest in model.quests.insert(quest, at: 0); Task { await model.load() } }
            }
            .sheet(item: $model.completion) { result in CompletionSheet(result: result) }
            .task { await model.load() }
        }
    }

    private var todaysQuests: some View {
        VStack(alignment: .leading, spacing: Theme.Space.md) {
            SectionHeader("Today's Quests") {
                Text("\(model.quests.filter(\.completed).count)/\(model.quests.count)")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            if model.quests.isEmpty {
                Card { EmptyStateView(symbol: "sparkles", title: "No quests yet", message: "Tap + to add your first quest for today.") }
            } else {
                Card {
                    VStack(spacing: 0) {
                        ForEach(model.quests) { quest in
                            QuestRow(quest: quest) { Task { await model.toggle(quest) } }
                            if quest.id != model.quests.last?.id { Divider().padding(.vertical, 2) }
                        }
                    }
                }
            }
        }
    }
}

/// The level/streak/today summary card.
private struct StatsHeader: View {
    let stats: UserStats
    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                HStack {
                    VStack(alignment: .leading) {
                        Text("Level \(stats.currentLevel)").font(.title2.bold())
                        Text(stats.levelName).font(.subheadline).foregroundStyle(.secondary)
                    }
                    Spacer()
                    VStack(alignment: .trailing) {
                        Text("🔥 \(stats.streakDays)").font(.title3.bold())
                        Text("day streak").font(.caption).foregroundStyle(.secondary)
                    }
                }
                VStack(alignment: .leading, spacing: 4) {
                    ProgressBar(value: stats.levelProgress)
                    Text("\(stats.pointsToNextLevel) XP to next level").font(.caption).foregroundStyle(.secondary)
                }
                HStack(spacing: Theme.Space.md) {
                    StatPill(value: "\(stats.todayPoints)", label: "Today XP")
                    StatPill(value: "\(stats.todayTasksCompleted)/\(stats.todayTasksTotal)", label: "Quests", tint: Theme.success)
                    StatPill(value: "\(stats.weeklyPoints)", label: "This week", tint: Theme.gold)
                }
            }
        }
    }
}

private struct BrainCheckinPrompt: View {
    var body: some View {
        NavigationLink { BrainCheckinView() } label: {
            Card {
                HStack {
                    Image(systemName: "brain.head.profile").font(.title2).foregroundStyle(Theme.accent)
                    VStack(alignment: .leading) {
                        Text("How's your brain today?").font(.subheadline.bold())
                        Text("A quick check-in tunes your suggestions.").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "chevron.right").foregroundStyle(.secondary)
                }
            }
        }
        .buttonStyle(.plain)
    }
}
