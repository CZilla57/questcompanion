import SwiftUI
import Charts

@MainActor
final class ProgressViewModel: ObservableObject {
    /// Everything the Progress tab needs, loaded once. Insights (range-selectable)
    /// is kept separate so changing the range doesn't reload the whole screen.
    struct Core {
        let me: User
        let stats: UserStats
        let earnedBadges: [UserBadge]
        let badgeTotal: Int
        let patterns: PatternSummary?
        let heatmap: HeatmapResponse?
    }
    @Published var core: Loadable<Core> = .idle
    @Published var insights: InsightsResponse?
    @Published var insightDays: Int = 30
    @Published var insightsLoading = false

    func load() async {
        core = .loading
        do {
            async let me = UserService.me()
            async let stats = UserService.stats()
            async let earned = try? BadgeService.mine()
            async let all = try? BadgeService.all()
            async let patterns = try? ProgressService.patterns()
            async let heatmap = try? ProgressService.heatmap(days: 84)
            async let ins = try? ProgressService.insights(days: insightDays)
            let c = Core(
                me: try await me,
                stats: try await stats,
                earnedBadges: await earned ?? [],
                badgeTotal: (await all)?.count ?? 0,
                patterns: await patterns,
                heatmap: await heatmap
            )
            insights = await ins
            core = .loaded(c)
        } catch { core = .failed(error.userMessage) }
    }

    func setDays(_ d: Int) async {
        guard d != insightDays else { return }
        insightDays = d
        insightsLoading = true
        insights = try? await ProgressService.insights(days: d)
        insightsLoading = false
    }
}

enum ProgressTab: String, CaseIterable, Identifiable {
    case progress = "Progress", insights = "Insights"
    var id: String { rawValue }
}

struct ProgressDashboardView: View {
    @StateObject private var model = ProgressViewModel()
    @State private var tab: ProgressTab = .progress

    var body: some View {
        AsyncContentView(state: model.core, retry: { Task { await model.load() } }) { core in
            VStack(spacing: 0) {
                NeonTabs(items: ProgressTab.allCases, selection: $tab) { $0.rawValue }
                    .padding(.horizontal, Theme.Space.md)
                    .padding(.vertical, Theme.Space.sm)

                ScrollView {
                    VStack(spacing: Theme.Space.lg) {
                        switch tab {
                        case .progress: progressTab(core)
                        case .insights: insightsTab(core)
                        }
                    }
                    .padding(Theme.Space.lg)
                }
                .refreshable { await model.load() }
            }
            .background(Theme.screenBackground)
        }
        .navigationTitle(tab == .progress ? "Progress" : "Insights")
        .task { if model.core.value == nil { await model.load() } }
    }

    // MARK: - Progress tab (web "Commander Profile")

    @ViewBuilder private func progressTab(_ core: ProgressViewModel.Core) -> some View {
        profileHeader(core.me)

        HStack(spacing: Theme.Space.md) {
            statCard(icon: "flame.fill", title: "Daily Streak",
                     value: "\(core.me.streakDays)",
                     detail: "Best: \(core.me.longestStreak ?? core.stats.streakDays) days")
            statCard(icon: "rosette", title: "Badges Earned",
                     value: "\(core.earnedBadges.count)",
                     detail: "Keep collecting")
        }

        if let insights = model.insights, !insights.xpHistory.isEmpty {
            xpBarChart(Array(insights.xpHistory.suffix(14)), today: core.stats.todayPoints)
        }

        levelProgressCard(core.stats)

        if !core.earnedBadges.isEmpty { badgesCard(core) }

        if let heatmap = core.heatmap { HeatmapCard(days: heatmap.days) }

        activityCard(core.stats)
    }

    private func profileHeader(_ me: User) -> some View {
        Card {
            VStack(spacing: Theme.Space.sm) {
                ZStack {
                    Circle().fill(Theme.accent.opacity(0.18))
                        .frame(width: 84, height: 84)
                        .overlay(Circle().strokeBorder(Theme.accent.opacity(0.5), lineWidth: 2))
                    Image(systemName: "trophy.fill").font(.system(size: 36)).foregroundStyle(Theme.accent)
                }
                Text(me.name).font(.outfitTitle2Bold)
                if let level = me.levelName {
                    Text(level.uppercased()).font(.outfitCaptionBold).kerning(1.5).foregroundStyle(Theme.accent)
                }
                HStack(spacing: 8) {
                    Text("Lv. \(me.currentLevel)").font(.outfitSubheadlineBold)
                    Text("·").foregroundStyle(.secondary)
                    Text("\(me.totalPoints) XP total").foregroundStyle(.secondary)
                }
                .font(.outfitSubheadline)
            }
            .frame(maxWidth: .infinity)
        }
    }

    private func statCard(icon: String, title: String, value: String, detail: String) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 4) {
                Label(title, systemImage: icon)
                    .font(.outfitCaption).foregroundStyle(.secondary)
                    .labelStyle(TealIconLabelStyle(spacing: 4))
                Text(value).font(.outfitLargeTitleBold)
                Text(detail).font(.outfitCaption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func xpBarChart(_ points: [InsightsXpPoint], today: Int) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                HStack {
                    Text("XP — last \(points.count) days").font(.outfitSubheadlineBold)
                    Spacer()
                    Text("Today: \(today) XP").font(.outfitCaption).foregroundStyle(Theme.accent)
                }
                Chart(points) { point in
                    BarMark(x: .value("Day", point.label), y: .value("XP", point.xp))
                        .foregroundStyle(Theme.accent.gradient)
                        .cornerRadius(3)
                }
                .chartXAxis {
                    AxisMarks { _ in AxisValueLabel().font(.outfitCaption2) }
                }
                .frame(height: 170)
            }
        }
    }

    private func levelProgressCard(_ stats: UserStats) -> some View {
        let span = stats.pointsIntoLevel + stats.pointsToNextLevel
        let pct = span > 0 ? Double(stats.pointsIntoLevel) / Double(span) : 1
        return Card {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                HStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("PROGRESS TO NEXT LEVEL").font(.outfitCaption2).kerning(1).foregroundStyle(.secondary)
                        Text("\(stats.pointsToNextLevel) XP remaining").font(.outfitSubheadlineBold).foregroundStyle(Theme.accent)
                    }
                    Spacer()
                    Text("\(Int((pct * 100).rounded()))%").font(.outfitTitle2Bold)
                }
                ProgressBar(value: pct, tint: Theme.accent)
            }
        }
    }

    private func badgesCard(_ core: ProgressViewModel.Core) -> some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: Theme.Space.sm), count: 3)
        return Card {
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                SectionHeader("Badges (\(core.earnedBadges.count)/\(core.badgeTotal))") {
                    NavigationLink { BadgesView() } label: {
                        Text("View all").font(.outfitCaption).foregroundStyle(Theme.accent)
                    }
                }
                LazyVGrid(columns: columns, spacing: Theme.Space.md) {
                    ForEach(core.earnedBadges.prefix(9)) { ub in
                        VStack(spacing: 4) {
                            Image(systemName: "rosette").font(.system(size: 26)).foregroundStyle(Theme.gold)
                            Text(ub.badge.name).font(.outfitCaption2)
                                .multilineTextAlignment(.center).lineLimit(2)
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
            }
        }
    }

    private func activityCard(_ stats: UserStats) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                Text("Activity log").font(.outfitHeadline)
                if stats.recentActivity.isEmpty {
                    Text("No activity yet. Complete a quest to get started!")
                        .font(.outfitCaption).foregroundStyle(.secondary)
                } else {
                    ForEach(stats.recentActivity.prefix(8)) { item in
                        HStack(alignment: .top, spacing: Theme.Space.sm) {
                            Image(systemName: activityIcon(item.type)).font(.outfitCaption)
                                .foregroundStyle(Theme.accent).frame(width: 18)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(item.description).font(.outfitSubheadline)
                                HStack(spacing: 6) {
                                    Text(DateUtils.relative(item.createdAt)).font(.outfitCaption2).foregroundStyle(.secondary)
                                    if item.points != 0 {
                                        Text("\(item.points > 0 ? "+" : "")\(item.points) XP")
                                            .font(.outfitCaption2).fontWeight(.bold)
                                            .foregroundStyle(item.points < 0 ? Theme.danger : Theme.accent)
                                    }
                                }
                            }
                            Spacer(minLength: 0)
                        }
                    }
                }
            }
        }
    }

    private func activityIcon(_ type: String) -> String {
        switch type {
        case "task_completed": return "checkmark.circle.fill"
        case "badge_earned": return "rosette"
        case "level_up": return "trophy.fill"
        case "streak_milestone": return "flame.fill"
        case "all_day_bonus": return "bolt.fill"
        case "streak_freeze_bought": return "shield.fill"
        case "streak_freeze_used": return "shield.lefthalf.filled"
        case "gear_bought", "gear_earned": return "bag.fill"
        case "focus_session", "focus_complete": return "timer"
        case "body_double": return "person.2.fill"
        case "initiation": return "play.fill"
        case "reflection": return "moon.stars.fill"
        case "questline_complete": return "list.bullet.rectangle.fill"
        case "campaign_complete": return "map.fill"
        default: return "sparkles"
        }
    }

    // MARK: - Insights tab

    @ViewBuilder private func insightsTab(_ core: ProgressViewModel.Core) -> some View {
        rangePicker

        if let insights = model.insights, !insights.categoryBreakdown.isEmpty {
            insightSummary(insights)
            xpTimelineCard(insights)
            categoryRateCard(insights)
            dowCard(insights)
            periodCard(insights)
        } else if model.insightsLoading {
            Card { LoadingView().frame(height: 120) }
        } else {
            Card { EmptyStateView(symbol: "chart.bar", title: "No data yet", message: "Complete some quests to see your patterns here.") }
        }

        if let patterns = core.patterns { patternsCard(patterns) }
    }

    private var rangePicker: some View {
        HStack(spacing: Theme.Space.sm) {
            ForEach([30, 60, 90], id: \.self) { d in
                let selected = model.insightDays == d
                Button { Task { await model.setDays(d) } } label: {
                    Text("\(d)d")
                        .font(.outfitSubheadline).fontWeight(selected ? .semibold : .regular)
                        .foregroundStyle(selected ? Color.black : Theme.foreground)
                        .padding(.horizontal, Theme.Space.md).padding(.vertical, 6)
                        .background(selected ? Theme.accent : Theme.cardBackground)
                        .clipShape(Capsule())
                        .overlay(Capsule().strokeBorder(selected ? .clear : Theme.cardBorder, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
    }

    private func insightSummary(_ insights: InsightsResponse) -> some View {
        let totalCompleted = insights.categoryBreakdown.reduce(0) { $0 + $1.completed }
        let totalTasks = insights.categoryBreakdown.reduce(0) { $0 + $1.total }
        let overall = totalTasks > 0 ? Int((Double(totalCompleted) / Double(totalTasks) * 100).rounded()) : 0
        let activeDays = insights.xpHistory.filter { $0.xp > 0 }.count
        let avgXp = activeDays > 0 ? insights.xpHistory.reduce(0) { $0 + $1.xp } / activeDays : 0
        let bestDow = insights.dayOfWeekStats.filter { $0.total >= 2 }
            .max { rate($0) < rate($1) }
        let bestPeriod = insights.periodStats.max { $0.completed < $1.completed }
        let topCat = insights.categoryBreakdown.first

        let columns = Array(repeating: GridItem(.flexible(), spacing: Theme.Space.md), count: 2)
        return LazyVGrid(columns: columns, spacing: Theme.Space.md) {
            insightTile("target", "Overall", "\(overall)%", "\(totalCompleted)/\(totalTasks) quests · \(model.insightDays)d")
            if let d = bestDow {
                insightTile("calendar", "Best Day", d.label, "\(rate(d))% completion")
            }
            if let p = bestPeriod, p.completed > 0 {
                insightTile("clock", "Peak Time", p.label, "\(p.completed) in \(p.range)")
            }
            if let c = topCat {
                insightTile("trophy.fill", "Top Category", c.label, "\(c.completed) done · \(c.xpEarned) XP")
            }
            insightTile("bolt.fill", "Avg XP / active day", "\(avgXp)", "Active \(activeDays) of \(model.insightDays) days")
        }
    }

    private func insightTile(_ icon: String, _ title: String, _ value: String, _ detail: String) -> some View {
        Card {
            HStack(alignment: .top, spacing: Theme.Space.sm) {
                Image(systemName: icon).font(.outfitSubheadline).foregroundStyle(Theme.accent)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title.uppercased()).font(.outfitCaption2).kerning(0.5).foregroundStyle(.secondary)
                    Text(value).font(.outfitTitle3Bold).foregroundStyle(Theme.accent)
                    Text(detail).font(.outfitCaption2).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
        }
    }

    private func xpTimelineCard(_ insights: InsightsResponse) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                Label("XP earned — last \(model.insightDays) days", systemImage: "chart.line.uptrend.xyaxis")
                    .font(.outfitSubheadlineBold).labelStyle(TealIconLabelStyle())
                Chart(insights.xpHistory) { point in
                    AreaMark(x: .value("Day", point.date), y: .value("XP", point.xp))
                        .foregroundStyle(Theme.accent.opacity(0.18).gradient)
                    LineMark(x: .value("Day", point.date), y: .value("XP", point.xp))
                        .foregroundStyle(Theme.accent)
                        .interpolationMethod(.monotone)
                }
                .chartXAxis(.hidden)
                .frame(height: 190)
            }
        }
    }

    private func categoryRateCard(_ insights: InsightsResponse) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                Label("Completion rate by category", systemImage: "target")
                    .font(.outfitSubheadlineBold).labelStyle(TealIconLabelStyle())
                Chart(insights.categoryBreakdown) { cat in
                    BarMark(
                        x: .value("Rate", cat.total > 0 ? Int(Double(cat.completed) / Double(cat.total) * 100) : 0),
                        y: .value("Category", cat.label)
                    )
                    .foregroundStyle(Theme.accent.gradient)
                    .cornerRadius(3)
                }
                .chartXScale(domain: 0...100)
                .frame(height: CGFloat(max(120, insights.categoryBreakdown.count * 34)))
            }
        }
    }

    private func dowCard(_ insights: InsightsResponse) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                Label("Completion rate by day", systemImage: "calendar")
                    .font(.outfitSubheadlineBold).labelStyle(TealIconLabelStyle())
                Chart(insights.dayOfWeekStats) { d in
                    BarMark(x: .value("Day", d.label), y: .value("Rate", rate(d)))
                        .foregroundStyle(Theme.accent.gradient)
                        .cornerRadius(3)
                }
                .chartYScale(domain: 0...100)
                .frame(height: 170)
            }
        }
    }

    private func periodCard(_ insights: InsightsResponse) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                Label("Best time of day", systemImage: "clock")
                    .font(.outfitSubheadlineBold).labelStyle(TealIconLabelStyle())
                Chart(insights.periodStats) { p in
                    BarMark(x: .value("Period", p.label), y: .value("Completed", p.completed))
                        .foregroundStyle(Theme.accent.gradient)
                        .cornerRadius(3)
                }
                .frame(height: 170)
            }
        }
    }

    private func patternsCard(_ patterns: PatternSummary) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                SectionHeader("Your rhythms") {
                    Text(patterns.confidence.capitalized).font(.outfitCaption).foregroundStyle(.secondary)
                }
                if let best = patterns.bestDay {
                    let days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
                    Label("Best day: \(days[safe: best] ?? "?")", systemImage: "calendar")
                        .labelStyle(TealIconLabelStyle())
                }
                if !patterns.powerHours.isEmpty {
                    let hours = patterns.powerHours.prefix(3).map { "\($0.hour):00" }.joined(separator: ", ")
                    Label("Power hours: \(hours)", systemImage: "bolt.fill").labelStyle(TealIconLabelStyle())
                }
                if let median = patterns.medianQuestMinutes {
                    Label("Typical quest: ~\(median) min", systemImage: "clock").labelStyle(TealIconLabelStyle())
                }
                if !patterns.topHelpers.isEmpty {
                    Label("Helps: " + patterns.topHelpers.map(ReflectionChip.label(for:)).joined(separator: ", "),
                          systemImage: "hand.thumbsup").labelStyle(TealIconLabelStyle())
                }
            }
            .font(.outfitSubheadline)
        }
    }

    private func rate(_ d: InsightsDowStat) -> Int {
        d.total > 0 ? Int((Double(d.completed) / Double(d.total) * 100).rounded()) : 0
    }
}

/// A compact GitHub-style completion heatmap.
struct HeatmapCard: View {
    let days: [HeatmapDay]
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 3), count: 7)

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                Text("Activity").font(.outfitHeadline)
                LazyVGrid(columns: columns, spacing: 3) {
                    ForEach(days) { day in
                        RoundedRectangle(cornerRadius: 3)
                            .fill(color(for: day))
                            .aspectRatio(1, contentMode: .fit)
                    }
                }
            }
        }
    }

    private func color(for day: HeatmapDay) -> Color {
        guard day.completedTasks > 0 else { return Theme.accent.opacity(0.08) }
        let intensity = min(1.0, 0.25 + Double(day.completedTasks) * 0.2)
        return Theme.accent.opacity(intensity)
    }
}

extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
