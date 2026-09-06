import SwiftUI

@MainActor
final class BrainViewModel: ObservableObject {
    @Published var state: Loadable<BrainState> = .idle
    @Published var momentum: [MomentumSuggestion] = []
    @Published var busy = false

    func load() async {
        state = .loading
        do {
            async let brain = BrainService.state()
            async let mom = try? QuestService.momentum()
            state = .loaded(try await brain)
            momentum = (await mom)?.suggestions ?? []
        } catch { state = .failed(error.userMessage) }
    }

    func checkin(_ mode: BrainMode) async {
        busy = true; defer { busy = false }
        if let updated = try? await BrainService.checkin(mode: mode) {
            state = .loaded(updated)
            momentum = (try? await QuestService.momentum())?.suggestions ?? []
        }
    }

    func pause(minutes: Int) async {
        if let updated = try? await BrainService.pauseHyperfocus(minutes: minutes) { state = .loaded(updated) }
    }
}

struct BrainCheckinView: View {
    @StateObject private var model = BrainViewModel()
    private let modes: [BrainMode] = [.focused, .neutral, .distracted, .frozen, .hyperfocus]

    var body: some View {
        AsyncContentView(state: model.state, retry: { Task { await model.load() } }) { brain in
            ScrollView {
                VStack(spacing: Theme.Space.lg) {
                    Card {
                        VStack(spacing: Theme.Space.sm) {
                            Text("Right now I feel…").font(.outfitHeadline)
                            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: Theme.Space.md) {
                                ForEach(modes, id: \.self) { mode in
                                    Button { Task { await model.checkin(mode) } } label: {
                                        VStack(spacing: 6) {
                                            Image(systemName: mode.symbol).font(.system(size: 26))
                                                .foregroundStyle(Theme.accent)
                                            Text(mode.label).font(.outfitCaption)
                                        }
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, Theme.Space.md)
                                        .background(brain.mode == mode ? Theme.accentSoft : Theme.cardBackground)
                                        .clipShape(RoundedRectangle(cornerRadius: Theme.Space.md))
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }

                    if brain.mode == .hyperfocus {
                        Card {
                            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                                Label("In hyperfocus", systemImage: "flame.fill")
                                    .font(.outfitHeadline).labelStyle(TealIconLabelStyle())
                                Text("Protection nudges are on. Pause them if you're in a good flow.").font(.outfitCaption).foregroundStyle(.secondary)
                                HStack {
                                    ForEach([30, 60, 90], id: \.self) { m in
                                        Button("\(m)m") { Task { await model.pause(minutes: m) } }.buttonStyle(.bordered)
                                    }
                                    if brain.hyperfocusPausedUntil != nil {
                                        Button("Resume") { Task { await model.pause(minutes: 0) } }.buttonStyle(.bordered).tint(Theme.danger)
                                    }
                                }
                            }
                        }
                    }

                    if !model.momentum.isEmpty {
                        Card {
                            VStack(alignment: .leading, spacing: Theme.Space.md) {
                                Text("A gentle next step").font(.outfitHeadline)
                                ForEach(model.momentum) { suggestion in
                                    VStack(alignment: .leading, spacing: 2) {
                                        Label(suggestion.task.title, systemImage: suggestion.task.category.symbol)
                                            .font(.outfitSubheadline).labelStyle(TealIconLabelStyle())
                                        Text(suggestion.reason).font(.outfitCaption).foregroundStyle(.secondary)
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(Theme.Space.sm)
                                    .background(Theme.accentSoft)
                                    .clipShape(RoundedRectangle(cornerRadius: Theme.Space.sm))
                                }
                            }
                        }
                    }
                }
                .padding(Theme.Space.lg)
            }
            .background(Theme.screenBackground)
            .refreshable { await model.load() }
        }
        .navigationTitle("Brain Check-in")
        .task { if model.state.value == nil { await model.load() } }
    }
}
