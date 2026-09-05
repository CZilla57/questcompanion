import SwiftUI

@MainActor
final class BadgesViewModel: ObservableObject {
    struct Bundle { let all: [Badge]; let earned: Set<Int>; let earnedList: [UserBadge] }
    @Published var state: Loadable<Bundle> = .idle

    func load() async {
        state = .loading
        do {
            async let all = BadgeService.all()
            async let mine = BadgeService.mine()
            let (a, m) = try await (all, mine)
            state = .loaded(Bundle(all: a, earned: Set(m.map(\.badge.id)), earnedList: m))
        } catch { state = .failed(error.userMessage) }
    }
}

struct BadgesView: View {
    @StateObject private var model = BadgesViewModel()
    private let columns = Array(repeating: GridItem(.flexible(), spacing: Theme.Space.md), count: 3)

    var body: some View {
        AsyncContentView(state: model.state, retry: { Task { await model.load() } }) { bundle in
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.lg) {
                    Text("\(bundle.earned.count) of \(bundle.all.count) earned")
                        .font(.subheadline).foregroundStyle(.secondary)
                    LazyVGrid(columns: columns, spacing: Theme.Space.lg) {
                        ForEach(bundle.all) { badge in
                            let earned = bundle.earned.contains(badge.id)
                            VStack(spacing: 4) {
                                Text(badge.icon).font(.system(size: 36)).grayscale(earned ? 0 : 1).opacity(earned ? 1 : 0.4)
                                Text(badge.name).font(.caption2).multilineTextAlignment(.center).lineLimit(2)
                            }
                        }
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
}
