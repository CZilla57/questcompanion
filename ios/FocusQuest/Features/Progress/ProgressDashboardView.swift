import SwiftUI
import Charts

@MainActor
final class ProgressViewModel: ObservableObject {
    struct Bundle { let insights: InsightsResponse; let patterns: PatternSummary?; let heatmap: HeatmapResponse? }
    @Published var state: Loadable<Bundle> = .idle

    func load() async {
        state = .loading
        do {
            async let insights = ProgressService.insights(days: 30)
            async let patterns = try? ProgressService.patterns()
            async let heatmap = try? ProgressService.heatmap(days: 84)
            let bundle = Bundle(insights: try await insights, patterns: await patterns, heatmap: await heatmap)
            state = .loaded(bundle)
        } catch { state = .failed(error.userMessage) }
    }
}

struct ProgressDashboardView: View {
    @StateObject private var model = ProgressViewModel()

    var body: some View {
        AsyncContentView(state: model.state, retry: { Task { await model.load() } }) { bundle in
            ScrollView {
                VStack(spacing: Theme.Space.lg) {
                    xpChart(bundle.insights)
                    categoryCard(bundle.insights)
                    if let patterns = bundle.patterns { patternsCard(patterns) }
                    if let heatmap = bundle.heatmap { HeatmapCard(days: heatmap.days) }
                }
                .padding(Theme.Space.lg)
            }
            .background(Theme.screenBackground)
            .refreshable { await model.load() }
        }
        .navigationTitle("Progress")
        .task { if model.state.value == nil { await model.load() } }
    }

    private func xpChart(_ insights: InsightsResponse) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                Text("XP over \(insights.days) days").font(.headline)
                Chart(insights.xpHistory) { point in
                    BarMark(x: .value("Day", point.date), y: .value("XP", point.xp))
                        .foregroundStyle(Theme.accent)
                }
                .chartXAxis(.hidden)
                .frame(height: 160)
            }
        }
    }

    private func categoryCard(_ insights: InsightsResponse) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                Text("By category").font(.headline)
                ForEach(insights.categoryBreakdown) { cat in
                    HStack {
                        Text(cat.label).font(.subheadline)
                        Spacer()
                        Text("\(cat.completed)/\(cat.total)").font(.caption).foregroundStyle(.secondary)
                        Text("\(cat.xpEarned) XP").font(.caption).foregroundStyle(Theme.accent)
                    }
                }
            }
        }
    }

    private func patternsCard(_ patterns: PatternSummary) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                SectionHeader("Your rhythms") {
                    Text(patterns.confidence.capitalized).font(.caption).foregroundStyle(.secondary)
                }
                if let best = patterns.bestDay {
                    let days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]
                    Label("Best day: \(days[safe: best] ?? "?")", systemImage: "calendar")
                }
                if !patterns.powerHours.isEmpty {
                    let hours = patterns.powerHours.prefix(3).map { "\($0.hour):00" }.joined(separator: ", ")
                    Label("Power hours: \(hours)", systemImage: "bolt.fill")
                }
                if let median = patterns.medianQuestMinutes {
                    Label("Typical quest: ~\(median) min", systemImage: "clock")
                }
                if !patterns.topHelpers.isEmpty {
                    Label("Helps: " + patterns.topHelpers.map(ReflectionChip.label(for:)).joined(separator: ", "),
                          systemImage: "hand.thumbsup")
                }
            }
            .font(.subheadline)
        }
    }
}

/// A compact GitHub-style completion heatmap.
struct HeatmapCard: View {
    let days: [HeatmapDay]
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 3), count: 7)

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                Text("Activity").font(.headline)
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
