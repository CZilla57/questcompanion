import SwiftUI

/// The Campaign: the running campaign's current chapter, for the quiet context
/// line on Today (web parity: CampaignNowLine). `chapterIndex` is 0-based.
struct CampaignNow: Equatable {
    let campaignId: Int
    let chapterIndex: Int
    let chapterCount: Int
    let chapterTitle: String
}

@MainActor
final class TodayViewModel: ObservableObject {
    @Published var stats: Loadable<UserStats> = .idle
    @Published var quests: [Quest] = []
    @Published var brain: BrainState?
    @Published var completion: TaskCompletionResult?
    @Published var showQuickAdd = false
    @Published var momentum: MomentumResponse?
    /// The Campaign — Phase 3: the Dungeon Master's beat for today, or nil when
    /// there's nothing to narrate (or the endpoint isn't live yet).
    @Published var dmBeat: DmBeat?
    /// The Campaign: which chapter of a running campaign the hero is on, or nil
    /// when campaigns are locked, none is running, or every chapter is done.
    /// A quiet line of context under the focus suggestion — never a nag.
    @Published var campaignNow: CampaignNow?
    /// Whether today's evening reflection is still unanswered. nil until known
    /// (or outside the evening window), so the CTA stays hidden until we're sure.
    @Published var reflectionUnanswered: Bool?
    /// Suggestions the user waved off this session ("Not this one").
    @Published var skippedFocusIds: Set<Int> = []

    /// Morning shows the quest board; from late afternoon the DM calls make-camp.
    static var beatKind: DmBeatKind {
        Calendar.current.component(.hour, from: Date()) < 17 ? .morning : .camp
    }

    /// The evening reflection window opens at 17:00 local and runs to midnight —
    /// an unanswered day simply disappears at midnight (anti-shame, web parity:
    /// REFLECTION_CARD_START_HOUR).
    static var inEveningWindow: Bool {
        Calendar.current.component(.hour, from: Date()) >= 17
    }

    /// Show the evening reflection chip only in the evening window while today's
    /// reflection is unanswered — independent of the brain check-in.
    var showReflect: Bool { Self.inEveningWindow && reflectionUnanswered == true }

    /// The single quest the momentum board is nudging next — the first suggestion
    /// that's still pending and hasn't been skipped.
    var focusSuggestion: MomentumSuggestion? {
        momentum?.suggestions.first {
            !skippedFocusIds.contains($0.task.id) && !$0.task.completed
        }
    }

    func load() async {
        if stats.value == nil { stats = .loading }
        async let statsResult = UserService.stats()
        async let questResult = QuestService.list(date: TZ.today)
        async let brainResult = try? BrainService.state()
        async let momentumResult = try? QuestService.momentum()
        async let dmResult = UserService.dmBeat(kind: Self.beatKind)
        do {
            let (s, q) = try await (statsResult, questResult)
            stats = .loaded(s)
            quests = q
            brain = await brainResult
            momentum = await momentumResult
            // Campaign feature gate (parity with web's DmBeatCard): the DM beat
            // belongs to the campaign layer, so it stays invisible until the
            // `campaigns` feature is unlocked, per the anti-shame law.
            dmBeat = s.features.contains(.campaigns) ? await dmResult : nil
            // Same gate for the quiet campaign chapter line (web's CampaignNowLine).
            campaignNow = s.features.contains(.campaigns) ? await Self.loadCampaignNow() : nil
            // Evening reflection CTA (web's EveningReflectionCard): only fetch in
            // the evening window, and without draft=true so viewing Today never
            // spends an LLM call — only opening the reflection drafts a question.
            // On a failed fetch we leave it hidden rather than nag (web hides on
            // an undefined response).
            if Self.inEveningWindow, let resp = try? await ReflectionService.today() {
                reflectionUnanswered = resp.reflection?.answeredAt == nil
            } else {
                reflectionUnanswered = nil
            }
            publishWidgetSnapshot()
        } catch {
            if stats.value == nil { stats = .failed(error.userMessage) }
        }
    }

    /// Resolve the running campaign's current chapter for the quiet Today line.
    /// Mirrors web's CampaignNowLine: the one running campaign, then the chapter
    /// matching `currentChapterId`. Returns nil (renders nothing) when none is
    /// running or every chapter is done. Best-effort — a failure just hides it.
    static func loadCampaignNow() async -> CampaignNow? {
        guard let running = try? await CampaignService.list()
            .first(where: { $0.status == "running" }) else { return nil }
        guard let detail = try? await CampaignService.detail(id: running.id),
              let currentId = detail.currentChapterId,
              let index = detail.chapters.firstIndex(where: { $0.questlineId == currentId })
        else { return nil }
        return CampaignNow(
            campaignId: running.id,
            chapterIndex: index,
            chapterCount: detail.chapters.count,
            chapterTitle: detail.chapters[index].title)
    }

    /// Mirror today's headline data into the App Group so the Home / Lock Screen
    /// widgets render it without a network call.
    private func publishWidgetSnapshot() {
        guard let s = stats.value else { return }
        let title = focusSuggestion?.task.title ?? quests.first { !$0.completed }?.title
        WidgetSharedStore.write(WidgetSnapshot(
            focusQuestTitle: title,
            streakDays: s.streakDays,
            level: s.currentLevel,
            levelName: s.levelName,
            todayCompleted: s.todayTasksCompleted,
            todayTotal: s.todayTasksTotal,
            updatedAt: .now))
    }

    func skipFocus(_ suggestion: MomentumSuggestion) async {
        skippedFocusIds.insert(suggestion.task.id)
        // Exhausted the batch — pull a fresh set and start over.
        if focusSuggestion == nil {
            momentum = try? await QuestService.momentum()
            skippedFocusIds = []
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
                if result.shouldCelebrate { completion = result }
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
            // ScrollView is the STABLE title host — the large "Today" title fails
            // to render intermittently when navigationTitle sits on AsyncContentView,
            // whose root view swaps (LoadingView ↔ ScrollView) as state loads.
            ScrollView {
                // Web "Now" order: prompt chips → quick add → quests →
                // quiet status line. Stats are demoted from a big card to a
                // single line (StatusLine), matching artifacts/focusquest.
                AsyncContentView(state: model.stats, retry: { Task { await model.load() } }) { stats in
                    VStack(alignment: .leading, spacing: Theme.Space.lg) {
                        // Rendered as content, not a system large title: a
                        // NavigationStack-in-TabView drops the large title on tab
                        // re-selection, so "Today" would vanish intermittently.
                        Text("Today").font(.outfitLargeTitleBold)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if let beat = model.dmBeat { dmBeatCard(beat) }
                        promptChips
                        todaysFocus
                        if let now = model.campaignNow { campaignNowLine(now) }
                        quickAddBar
                        todaysQuests
                        StatusLine(stats: stats).padding(.top, Theme.Space.xs)
                    }
                    .padding(Theme.Space.lg)
                }
                .frame(maxWidth: .infinity, minHeight: 300)
            }
            .background(Theme.screenBackground)
            .refreshable { await model.load() }
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $model.showQuickAdd) {
                QuickAddSheet { quest in model.quests.insert(quest, at: 0); Task { await model.load() } }
            }
            .sheet(item: $model.completion) { result in CompletionSheet(result: result) }
            .task { await model.load() }
        }
    }

    /// The Campaign — Phase 3: the Dungeon Master's beat. A quiet, story-voiced
    /// card at the head of the day — the morning quest board or the evening
    /// make-camp. Grounded server-side in real quests; never shames, never invents.
    private func dmBeatCard(_ beat: DmBeat) -> some View {
        let isCamp = beat.kind == DmBeatKind.camp.rawValue
        return Card {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                HStack {
                    Label("Dungeon Master", systemImage: "hexagon.fill")
                        .font(.outfitSubheadlineBold).labelStyle(TealIconLabelStyle())
                    Spacer()
                    Label(isCamp ? "Make camp" : "Quest board",
                          systemImage: isCamp ? "moon.stars.fill" : "sun.max.fill")
                        .font(.outfitCaption2).foregroundStyle(.secondary)
                        .labelStyle(TealIconLabelStyle(spacing: 3))
                }
                Text(beat.narrative)
                    .font(.outfitCallout).italic()
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Dungeon Master, \(isCamp ? "make camp" : "quest board"). \(beat.narrative)")
    }

    /// The Campaign: one quiet line of context under the focus suggestion —
    /// which chapter you're on — tapping through to the campaign. Never a call
    /// to action; it only appears when a campaign is actively running (web
    /// parity: CampaignNowLine).
    private func campaignNowLine(_ now: CampaignNow) -> some View {
        NavigationLink {
            CampaignDetailView(campaignId: now.campaignId)
        } label: {
            HStack(spacing: Theme.Space.xs) {
                Image(systemName: "map")
                    .font(.outfitCaption2).foregroundStyle(Theme.accent.opacity(0.7))
                Text("Chapter \(now.chapterIndex + 1) of \(now.chapterCount) — \(now.chapterTitle)")
                    .font(.outfitCaption).foregroundStyle(.secondary)
                    .lineLimit(1).truncationMode(.tail)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Chapter \(now.chapterIndex + 1) of \(now.chapterCount), \(now.chapterTitle)")
    }

    @ViewBuilder private var promptChips: some View {
        // Brain check-in follows its own daily cadence; the evening reflection
        // is gated on the 17:00→midnight window while unanswered (web parity).
        let showBrain = model.brain.map { !$0.checkedInToday } ?? false
        let showReflect = model.showReflect
        if showBrain || showReflect {
            HStack(spacing: Theme.Space.sm) {
                if showBrain {
                    PromptChip(icon: "brain.head.profile", label: "Brain check-in") { BrainCheckinView() }
                }
                if showReflect {
                    PromptChip(icon: "moon.stars.fill", label: "Reflect") { ReflectionView() }
                }
                Spacer(minLength: 0)
            }
        }
    }

    /// Web "Today's Focus" momentum block — the top suggestion the board is
    /// nudging next, with the brain-mode flavor line. Fills the head of the
    /// screen with the single most useful next action.
    @ViewBuilder private var todaysFocus: some View {
        if let suggestion = model.focusSuggestion {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                Label {
                    Text("Today's Focus").font(.outfitCaptionBold).textCase(.uppercase).kerning(1)
                } icon: {
                    Image(systemName: "target").foregroundStyle(Theme.accent)
                }
                .foregroundStyle(Theme.accent)

                if let flavor = model.momentum?.mode.flavor {
                    Text(flavor).font(.outfitCaption).foregroundStyle(.secondary)
                }

                momentumCard(suggestion)
            }
        }
    }

    private func momentumCard(_ suggestion: MomentumSuggestion) -> some View {
        let task = suggestion.task
        return VStack(alignment: .leading, spacing: Theme.Space.sm) {
            Label {
                Text("Next tiny win").font(.outfitCaption2).textCase(.uppercase).kerning(1.2)
            } icon: {
                Image(systemName: "sparkles").font(.outfitCaption2).foregroundStyle(Theme.accent)
            }
            .foregroundStyle(Theme.accent)

            Text(task.title).font(.outfitTitle3Bold)

            HStack(spacing: Theme.Space.sm) {
                Label(task.categoryLabel, systemImage: task.category.symbol)
                    .labelStyle(TealIconLabelStyle(spacing: 4))
                if let est = task.estimatedMinutes, est > 0 {
                    Label("\(est)m", systemImage: "clock").labelStyle(TealIconLabelStyle(spacing: 3))
                }
            }
            .font(.outfitCaption).foregroundStyle(.secondary)

            Text("“\(suggestion.reason)”")
                .font(.outfitCaption).italic().foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: Theme.Space.sm) {
                Button { Task { await model.toggle(task) } } label: {
                    Label("Did it", systemImage: "checkmark").font(.outfitSubheadline)
                }
                .buttonStyle(.borderedProminent).tint(Theme.accent)

                Button { Task { await model.skipFocus(suggestion) } } label: {
                    Label("Not this one", systemImage: "arrow.triangle.2.circlepath")
                        .font(.outfitSubheadline).labelStyle(TealIconLabelStyle(spacing: 4))
                }
                .buttonStyle(.plain).foregroundStyle(.secondary)
            }
            .padding(.top, 2)
        }
        .padding(Theme.Space.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.accentSoft)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous)
                .strokeBorder(Theme.accent.opacity(0.5), lineWidth: 1)
        )
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
