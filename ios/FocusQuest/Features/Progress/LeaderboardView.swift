import SwiftUI

@MainActor
final class LeaderboardViewModel: ObservableObject {
    @Published var period = "week" { didSet { Task { await load() } } }
    @Published var state: Loadable<[LeaderboardEntry]> = .idle
    @Published var myWeek: MyWeekComparison?

    func load() async {
        state = .loading
        do {
            async let board = ProgressService.leaderboard(period: period)
            async let week = try? ProgressService.myWeek()
            state = .loaded(try await board)
            myWeek = await week
        } catch { state = .failed(error.userMessage) }
    }
}

struct LeaderboardView: View {
    @StateObject private var model = LeaderboardViewModel()

    var body: some View {
        VStack(spacing: 0) {
            Picker("Period", selection: $model.period) {
                Text("This week").tag("week")
                Text("All time").tag("alltime")
            }
            .pickerStyle(.segmented)
            .padding(Theme.Space.md)

            AsyncContentView(state: model.state, retry: { Task { await model.load() } }) { entries in
                NeonList {
                    if let week = model.myWeek {
                        Section("My week vs last week") {
                            MyWeekRow(label: "Quests", metric: week.quests)
                            MyWeekRow(label: "XP", metric: week.xp)
                            MyWeekRow(label: "Focus min", metric: week.focusMinutes)
                        }
                    }
                    Section {
                        ForEach(entries) { entry in
                            HStack(spacing: Theme.Space.md) {
                                Text("\(entry.rank)").font(.outfitHeadline).frame(width: 28)
                                AvatarBadge(name: entry.user.name, colorHex: entry.user.avatarColor, size: 32)
                                VStack(alignment: .leading) {
                                    Text(entry.user.name).font(.outfitSubheadline)
                                    Text("Lvl \(entry.user.currentLevel)").font(.outfitCaption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text("\(entry.points) XP").font(.outfitSubheadlineBold).foregroundStyle(Theme.accent)
                            }
                        }
                    }
                }
                .refreshable { await model.load() }
            }
        }
        .background(Theme.screenBackground)
        .navigationTitle("Leaderboard")
        .task { if model.state.value == nil { await model.load() } }
    }
}

private struct MyWeekRow: View {
    let label: String
    let metric: MyWeekMetric
    var body: some View {
        HStack {
            Text(label)
            Spacer()
            Text("\(metric.current)").font(.outfitHeadline)
            let delta = metric.current - metric.samePointLastWeek
            Text(delta >= 0 ? "▲ \(delta)" : "▼ \(-delta)")
                .font(.outfitCaption)
                .foregroundStyle(delta >= 0 ? Theme.success : Theme.danger)
        }
    }
}
