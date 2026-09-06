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
    @EnvironmentObject private var router: AppRouter

    private var pending: [Quest] { model.quests.filter { !$0.completed } }
    private var completed: [Quest] { model.quests.filter(\.completed) }

    var body: some View {
        NavigationStack {
            AsyncContentView(state: model.stats, retry: { Task { await model.load() } }) { stats in
                ScrollView {
                    // Web "Now" order: prompt chips → quick add → quests →
                    // quiet status line. Stats are demoted from a big card to a
                    // single line (StatusLine), matching artifacts/focusquest.
                    VStack(alignment: .leading, spacing: Theme.Space.lg) {
                        promptChips
                        quickAddBar
                        todaysQuests
                        StatusLine(stats: stats).padding(.top, Theme.Space.xs)
                    }
                    .padding(Theme.Space.lg)
                }
                .background(Theme.screenBackground)
                .refreshable { await model.load() }
            }
            .navigationTitle("Today")
            .sheet(isPresented: $model.showQuickAdd) {
                QuickAddSheet { quest in model.quests.insert(quest, at: 0); Task { await model.load() } }
            }
            .sheet(item: $model.completion) { result in CompletionSheet(result: result) }
            .task { await model.load() }
        }
    }

    @ViewBuilder private var promptChips: some View {
        let showBrain = model.brain.map { !$0.checkedInToday } ?? false
        if showBrain {
            HStack(spacing: Theme.Space.sm) {
                PromptChip(icon: "brain.head.profile", label: "Brain check-in") { BrainCheckinView() }
                PromptChip(icon: "moon.stars.fill", label: "Reflect") { ReflectionView() }
                Spacer(minLength: 0)
            }
        }
    }

    private var quickAddBar: some View {
        Button { model.showQuickAdd = true } label: {
            HStack(spacing: Theme.Space.sm) {
                Image(systemName: "plus.circle.fill").foregroundStyle(Theme.accent)
                Text("Add a quest…").foregroundStyle(.secondary)
                Spacer()
            }
            .font(.outfitBody)
            .padding(Theme.Space.md)
            .background(Theme.cardBackground)
            .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous)
                    .strokeBorder(Theme.cardBorder, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private var todaysQuests: some View {
        VStack(alignment: .leading, spacing: Theme.Space.md) {
            HStack {
                Label {
                    Text("Today's Quests").font(.outfitTitle3Bold)
                } icon: {
                    Image(systemName: "target").foregroundStyle(Theme.accent)
                }
                Spacer()
                Button { router.tab = .quests } label: {
                    Text("View All")
                        .font(.outfitSubheadline)
                        .foregroundStyle(Theme.accent)
                        .padding(.vertical, Theme.Space.xs)
                        .padding(.leading, Theme.Space.md)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }

            if model.quests.isEmpty {
                Card { EmptyStateView(symbol: "target", title: "Nothing queued today", message: "Capture one above — text or voice.") }
            } else {
                VStack(spacing: Theme.Space.sm) {
                    ForEach(pending) { quest in questItem(quest) }
                }
                if !completed.isEmpty {
                    HStack(spacing: 6) {
                        Image(systemName: "checkmark").font(.outfitCaption2)
                        Text("COMPLETED (\(completed.count))")
                            .font(.outfitCaption2).textCase(.uppercase).kerning(0.8)
                    }
                    .foregroundStyle(.secondary)
                    .padding(.top, Theme.Space.sm)

                    VStack(spacing: Theme.Space.sm) {
                        ForEach(completed) { quest in questItem(quest) }
                    }
                    .opacity(0.6)
                }
            }
        }
    }

    /// A single quest as its own bordered surface (web renders separated cards).
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
    }
}

/// One quiet line where the big stats card used to be — tap through to
/// Progress. Mirrors the web `StatusRow`: streak (omitted at 0), level, XP today.
private struct StatusLine: View {
    let stats: UserStats
    var body: some View {
        NavigationLink { ProgressDashboardView() } label: {
            HStack(spacing: 6) {
                if stats.streakDays > 0 { Image(systemName: "flame.fill").foregroundStyle(Theme.accent) }
                Text(parts.joined(separator: " · "))
                Image(systemName: "chevron.right").font(.outfitCaption2)
            }
            .font(.outfitSubheadline)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
    }
    private var parts: [String] {
        var p: [String] = []
        if stats.streakDays > 0 { p.append("\(stats.streakDays)-day streak") }
        p.append("Lv \(stats.currentLevel)")
        p.append("\(stats.todayPoints) XP today")
        return p
    }
}

/// A compact tappable pill for the brain/reflection prompts.
private struct PromptChip<Destination: View>: View {
    let icon: String
    let label: String
    @ViewBuilder var destination: Destination
    var body: some View {
        NavigationLink { destination } label: {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.outfitCaption)
                Text(label).font(.outfitSubheadline)
            }
            .padding(.horizontal, Theme.Space.md)
            .padding(.vertical, Theme.Space.sm)
            .foregroundStyle(Theme.accent)
            .background(Theme.accentSoft)
            .clipShape(Capsule())
            .overlay(Capsule().strokeBorder(Theme.accent.opacity(0.35), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}
