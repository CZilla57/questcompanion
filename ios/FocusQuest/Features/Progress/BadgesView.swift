import SwiftUI

@MainActor
final class BadgesViewModel: ObservableObject {
    struct Bundle { let all: [Badge]; let earned: Set<Int>; let earnedAt: [Int: String] }
    @Published var state: Loadable<Bundle> = .idle

    func load() async {
        state = .loading
        do {
            async let all = BadgeService.all()
            async let mine = BadgeService.mine()
            let (a, m) = try await (all, mine)
            let earnedAt = Dictionary(m.map { ($0.badge.id, $0.earnedAt) }, uniquingKeysWith: { a, _ in a })
            state = .loaded(Bundle(all: a, earned: Set(m.map(\.badge.id)), earnedAt: earnedAt))
        } catch { state = .failed(error.userMessage) }
    }
}

/// Category display order + label, mirroring the web BADGE_CATEGORY_STYLE.
private let badgeCategoryOrder: [(key: String, label: String, color: Color)] = [
    ("tasks", "Task Mastery", Theme.accent),
    ("points", "XP Milestones", Theme.gold),
    ("streak", "Daily Streaks", Color(h: 25, s: 0.9, l: 0.55)),
    ("level", "Rank Ups", Theme.purple),
    ("social", "Social", Theme.success),
    ("habit_streak", "Habit Streaks", Theme.gold),
]

/// Maps a badge's stored `icon` name (lucide on web) to an SF Symbol.
func badgeSymbol(_ icon: String) -> String {
    switch icon {
    case "CheckCircle": return "checkmark.circle.fill"
    case "Zap": return "bolt.fill"
    case "Trophy": return "trophy.fill"
    case "Medal": return "medal.fill"
    case "Flame": return "flame.fill"
    case "Star": return "star.fill"
    case "Crown": return "crown.fill"
    case "Calendar": return "calendar"
    case "Target": return "target"
    case "Rocket": return "arrow.up.circle.fill"
    case "TrendingUp": return "chart.line.uptrend.xyaxis"
    case "Shield": return "shield.fill"
    case "Users": return "person.2.fill"
    default: return "rosette"
    }
}

struct BadgesView: View {
    @StateObject private var model = BadgesViewModel()
    private let columns = Array(repeating: GridItem(.flexible(), spacing: Theme.Space.md), count: 3)

    var body: some View {
        AsyncContentView(state: model.state, retry: { Task { await model.load() } }) { bundle in
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.xl) {
                    Text("\(bundle.earned.count) of \(bundle.all.count) earned")
                        .font(.outfitSubheadline).foregroundStyle(.secondary)

                    ForEach(badgeCategoryOrder, id: \.key) { cat in
                        let items = bundle.all.filter { $0.category == cat.key }
                        if !items.isEmpty {
                            categorySection(cat.label, color: cat.color, items: items, bundle: bundle)
                        }
                    }

                    // Any categories the server sends that we don't style explicitly.
                    let known = Set(badgeCategoryOrder.map(\.key))
                    let others = bundle.all.filter { !known.contains($0.category) }
                    if !others.isEmpty {
                        categorySection("More", color: Theme.accent, items: others, bundle: bundle)
                    }
                }
                .padding(Theme.Space.lg)
            }
            .background(Theme.screenBackground)
            .refreshable { await model.load() }
        }
        .navigationTitle("Badges")
        .task { if model.state.value == nil { await model.load() } }
    }

    private func categorySection(_ label: String, color: Color, items: [Badge], bundle: BadgesViewModel.Bundle) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.md) {
            HStack(spacing: 6) {
                Circle().fill(color).frame(width: 8, height: 8)
                Text(label.uppercased()).font(.outfitCaption2).kerning(1).foregroundStyle(color)
                let earnedHere = items.filter { bundle.earned.contains($0.id) }.count
                Text("(\(earnedHere)/\(items.count))").font(.outfitCaption2).foregroundStyle(.secondary)
            }
            LazyVGrid(columns: columns, spacing: Theme.Space.md) {
                ForEach(items) { badge in
                    badgeTile(badge, earned: bundle.earned.contains(badge.id),
                              earnedAt: bundle.earnedAt[badge.id], color: color)
                }
            }
        }
    }

    private func badgeTile(_ badge: Badge, earned: Bool, earnedAt: String?, color: Color) -> some View {
        VStack(spacing: 6) {
            ZStack {
                Circle()
                    .fill(earned ? color.opacity(0.15) : Theme.cardBackground)
                    .frame(width: 54, height: 54)
                    .overlay(Circle().strokeBorder(earned ? color.opacity(0.5) : Theme.cardBorder, lineWidth: 1))
                Image(systemName: badgeSymbol(badge.icon))
                    .font(.system(size: 24))
                    .foregroundStyle(earned ? color : Color.secondary.opacity(0.5))
            }
            Text(badge.name).font(.outfitCaption2).fontWeight(.semibold)
                .multilineTextAlignment(.center).lineLimit(2)
                .foregroundStyle(earned ? .primary : .secondary)
            if earned, let at = earnedAt {
                Text(DateUtils.relative(at)).font(.outfitCaption2).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
        .opacity(earned ? 1 : 0.55)
    }
}
