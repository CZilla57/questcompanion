import SwiftUI

enum FellowshipView: String, CaseIterable, Identifiable {
    case myWeek = "My Week", everyone = "Everyone"
    var id: String { rawValue }
}

enum LeaderPeriod: String, CaseIterable, Identifiable {
    case week = "This Week", allTime = "All Time"
    var id: String { rawValue }
    var apiValue: String { self == .week ? "week" : "alltime" }
}

@MainActor
final class LeaderboardViewModel: ObservableObject {
    @Published var period: LeaderPeriod = .week { didSet { Task { await loadBoard() } } }
    @Published var state: Loadable<[LeaderboardEntry]> = .idle
    @Published var myWeek: MyWeekComparison?
    @Published var myId: Int?

    func load() async {
        state = .loading
        async let me = try? UserService.me()
        async let week = try? ProgressService.myWeek()
        myId = (await me)?.id
        myWeek = await week
        await loadBoard()
    }

    func loadBoard() async {
        do { state = .loaded(try await ProgressService.leaderboard(period: period.apiValue)) }
        catch { state = .failed(error.userMessage) }
    }
}

struct LeaderboardView: View {
    @StateObject private var model = LeaderboardViewModel()
    @State private var view: FellowshipView = .myWeek

    private var freshStart: Bool {
        guard let w = model.myWeek else { return false }
        return [w.quests, w.xp, w.focusMinutes].allSatisfy { $0.current == 0 && $0.lastWeekTotal == 0 }
    }

    var body: some View {
        VStack(spacing: 0) {
            NeonTabs(items: FellowshipView.allCases, selection: $view) { $0.rawValue }
                .padding(.horizontal, Theme.Space.md)
                .padding(.vertical, Theme.Space.sm)

            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.lg) {
                    switch view {
                    case .myWeek: myWeekPanel
                    case .everyone: everyonePanel
                    }
                }
                .padding(Theme.Space.lg)
            }
            .refreshable { await model.load() }
        }
        .background(Theme.screenBackground)
        .navigationTitle("Fellowship")
        .task { if model.state.value == nil { await model.load() } }
    }

    // MARK: - My Week

    @ViewBuilder private var myWeekPanel: some View {
        if let week = model.myWeek {
            if freshStart {
                Card {
                    VStack(spacing: Theme.Space.sm) {
                        Image(systemName: "sparkles").font(.system(size: 32)).foregroundStyle(Theme.accent)
                        Text("Fresh start").font(.outfitHeadline)
                        Text("This page fills in as you quest — next week it becomes your favorite rivalry.")
                            .font(.outfitSubheadline).foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Theme.Space.lg)
                }
            } else {
                metricCard(icon: "flag.checkered", label: "Quests cleared", metric: week.quests)
                metricCard(icon: "star.fill", label: "XP earned", metric: week.xp)
                metricCard(icon: "timer", label: "Focus minutes", metric: week.focusMinutes)
                Text("Weeks start Monday in your timezone. Pace compares the same stretch of each week.")
                    .font(.outfitCaption).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
        } else {
            Card { LoadingView().frame(height: 100) }
        }
    }

    private func metricCard(icon: String, label: String, metric: MyWeekMetric) -> some View {
        let delta = metric.current - metric.samePointLastWeek
        return Card {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                Label(label, systemImage: icon)
                    .font(.outfitSubheadline).foregroundStyle(.secondary)
                    .labelStyle(TealIconLabelStyle())
                HStack(alignment: .center, spacing: Theme.Space.sm) {
                    Text("\(metric.current)").font(.outfitLargeTitleBold)
                    if delta > 0 {
                        Label("+\(delta) ahead of pace", systemImage: "sparkles")
                            .font(.outfitCaption2).foregroundStyle(Theme.accent)
                            .labelStyle(TealIconLabelStyle(spacing: 3))
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Theme.accentSoft).clipShape(Capsule())
                    }
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text("By this time last week: \(metric.samePointLastWeek)")
                    Text("Last week total: \(metric.lastWeekTotal)")
                }
                .font(.outfitCaption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: - Everyone

    @ViewBuilder private var everyonePanel: some View {
        VStack(alignment: .leading, spacing: Theme.Space.sm) {
            Text("The whole fellowship").font(.outfitHeadline)
            Text("Everyone in the game, ranked by XP.").font(.outfitCaption).foregroundStyle(.secondary)
        }

        NeonTabs(items: LeaderPeriod.allCases, selection: $model.period) { $0.rawValue }

        AsyncContentView(state: model.state, retry: { Task { await model.loadBoard() } }) { entries in
            if entries.isEmpty {
                Card { EmptyStateView(symbol: "trophy", title: "No one's on the board yet", message: "Complete quests to claim the top spot.") }
            } else {
                VStack(spacing: Theme.Space.sm) {
                    ForEach(entries) { entry in entryRow(entry) }
                }
                Label("Weekly XP resets every Monday. Complete quests to climb the ranks.", systemImage: "bolt.fill")
                    .font(.outfitCaption).foregroundStyle(.secondary)
                    .labelStyle(TealIconLabelStyle(spacing: 3))
                    .frame(maxWidth: .infinity, alignment: .center)
                    .multilineTextAlignment(.center)
            }
        }
    }

    private func entryRow(_ entry: LeaderboardEntry) -> some View {
        let isMe = model.myId == entry.user.id
        return HStack(spacing: Theme.Space.md) {
            rankBadge(entry.rank).frame(width: 30)
            AvatarBadge(name: entry.user.name, colorHex: entry.user.avatarColor, size: 34)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(entry.user.name).font(.outfitSubheadlineBold)
                    if isMe {
                        Text("YOU").font(.outfitCaption2).fontWeight(.bold).kerning(0.5)
                            .foregroundStyle(.black)
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .background(Theme.accent).clipShape(RoundedRectangle(cornerRadius: 4))
                    }
                }
                Text("Lv. \(entry.user.currentLevel)\(entry.user.levelName.map { " · \($0)" } ?? "")")
                    .font(.outfitCaption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 1) {
                Label("\(entry.points)", systemImage: "star.fill")
                    .font(.outfitSubheadlineBold).foregroundStyle(isMe ? Theme.accent : .primary)
                    .labelStyle(TealIconLabelStyle(spacing: 3))
                if let done = entry.tasksCompleted {
                    Text("\(done) quests").font(.outfitCaption2).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.horizontal, Theme.Space.md)
        .padding(.vertical, Theme.Space.sm)
        .background(isMe ? Theme.accentSoft : Theme.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous)
                .strokeBorder(isMe ? Theme.accent.opacity(0.5) : Theme.cardBorder, lineWidth: 1)
        )
    }

    @ViewBuilder private func rankBadge(_ rank: Int) -> some View {
        switch rank {
        case 1: Image(systemName: "trophy.fill").foregroundStyle(Theme.gold)
        case 2: Image(systemName: "medal.fill").foregroundStyle(Color(h: 0, s: 0, l: 0.75))
        case 3: Image(systemName: "medal.fill").foregroundStyle(Color(h: 30, s: 0.7, l: 0.5))
        default: Text("\(rank)").font(.outfitSubheadlineBold).foregroundStyle(.secondary)
        }
    }
}
