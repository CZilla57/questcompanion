import SwiftUI

@MainActor
final class RewardsViewModel: ObservableObject {
    struct Bundle {
        var coins: Int
        var rewards: [RewardStoreItem]
        var dopamine: [DopamineReward]
        var mystery: MysteryStatus?
        var perks: [StatPerk]
    }
    @Published var state: Loadable<Bundle> = .idle
    @Published var mysteryResult: MysteryResult?

    func load() async {
        state = .loading
        do {
            async let coins = RewardsService.coins()
            async let rewards = RewardsService.rewardStore()
            async let dopamine = try? RewardsService.dopamineRewards()
            async let mystery = try? RewardsService.mysteryStatus()
            async let perks = try? RewardsService.statPerks()
            let bundle = Bundle(
                coins: try await coins.balance,
                rewards: try await rewards,
                dopamine: await dopamine ?? [],
                mystery: await mystery,
                perks: (await perks)?.perks ?? []
            )
            state = .loaded(bundle)
        } catch { state = .failed(error.userMessage) }
    }

    func redeem(_ item: RewardStoreItem) async { _ = try? await RewardsService.redeem(id: item.id); await load() }
    func openMystery() async { mysteryResult = try? await RewardsService.openMystery(); await load() }
    func buyPerk(_ perk: StatPerk) async { _ = try? await RewardsService.buyPerk(id: perk.id); await load() }
    func addReward(label: String, tier: String) async { _ = try? await RewardsService.addReward(label: label, tier: tier); await load() }
    func deleteReward(_ item: RewardStoreItem) async { try? await RewardsService.deleteReward(id: item.id); await load() }
    func addDopamine(_ text: String) async { _ = try? await RewardsService.addDopamineReward(text: text); await load() }
    func deleteDopamine(_ item: DopamineReward) async { try? await RewardsService.deleteDopamineReward(id: item.id); await load() }
}

enum RewardTab: String, CaseIterable, Identifiable {
    case store = "Store", treats = "Treats", powerUps = "Power-Ups"
    var id: String { rawValue }
}

/// Reward tier hints, mirroring the web store's TIERS. The real coin cost is
/// set server-side; these are the display hint + reference cost.
enum RewardTier: String, CaseIterable, Identifiable {
    case small, medium, large, treat
    var id: String { rawValue }
    var label: String { rawValue.capitalized }
    var hint: String {
        switch self {
        case .small: return "quick"
        case .medium: return "episode"
        case .large: return "takeout"
        case .treat: return "splurge"
        }
    }
    /// Teal glyph shown beside the tier hint.
    var symbol: String {
        switch self {
        case .small: return "cup.and.saucer.fill"
        case .medium: return "tv.fill"
        case .large: return "fork.knife"
        case .treat: return "car.fill"
        }
    }
    var cost: Int {
        switch self {
        case .small: return 20
        case .medium: return 60
        case .large: return 150
        case .treat: return 400
        }
    }
}

struct RewardsView: View {
    @StateObject private var model = RewardsViewModel()
    @State private var tab: RewardTab = .store
    @State private var newRewardLabel = ""
    @State private var newRewardTier: RewardTier = .small
    @State private var newTreat = ""

    var body: some View {
        AsyncContentView(state: model.state, retry: { Task { await model.load() } }) { bundle in
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.lg) {
                    coinsPill(bundle.coins)
                    Picker("Rewards section", selection: $tab) {
                        ForEach(RewardTab.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)

                    switch tab {
                    case .store: storeTab(bundle)
                    case .treats: treatsTab(bundle)
                    case .powerUps: powerUpsTab(bundle)
                    }
                }
                .padding(Theme.Space.lg)
            }
            .background(Theme.screenBackground)
            .refreshable { await model.load() }
        }
        .navigationTitle("Rewards")
        .alert("Mystery Box", isPresented: .constant(model.mysteryResult != nil)) {
            Button("Nice!") { model.mysteryResult = nil }
        } message: {
            if let r = model.mysteryResult {
                Text(r.opened ? "You won: \(r.reward?.rewardText ?? "a reward")!" + (r.bonus.map { $0 > 0 ? " (+\($0) coins back)" : "" } ?? "") : "Couldn't open the box.")
            }
        }
        .task { if model.state.value == nil { await model.load() } }
    }

    // MARK: - Coins pill (web header balance)

    private func coinsPill(_ coins: Int) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "dollarsign.circle.fill").foregroundStyle(Theme.accent)
            Text("\(coins)").font(.outfitHeadline).foregroundStyle(Theme.gold)
            Text("coins").font(.outfitSubheadline).foregroundStyle(Theme.gold.opacity(0.8))
        }
        .padding(.horizontal, Theme.Space.md)
        .padding(.vertical, Theme.Space.sm)
        .background(Theme.gold.opacity(0.12))
        .clipShape(Capsule())
        .overlay(Capsule().strokeBorder(Theme.gold.opacity(0.3), lineWidth: 1))
    }

    // MARK: - Store tab

    private func storeTab(_ bundle: RewardsViewModel.Bundle) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.lg) {
            Card {
                VStack(alignment: .leading, spacing: Theme.Space.md) {
                    Label("Add a reward", systemImage: "plus").font(.outfitSubheadlineBold)
                    TextField("e.g. Order takeout", text: $newRewardLabel)
                        .textFieldStyle(.plain)
                        .padding(Theme.Space.md)
                        .background(Theme.screenBackground)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: Theme.Space.sm) {
                        ForEach(RewardTier.allCases) { t in
                            tierCard(t)
                        }
                    }
                    Button {
                        let label = newRewardLabel.trimmingCharacters(in: .whitespaces)
                        guard !label.isEmpty else { return }
                        Task { await model.addReward(label: label, tier: newRewardTier.rawValue) }
                        newRewardLabel = ""
                    } label: {
                        Text("Add reward").frame(maxWidth: .infinity).padding(.vertical, 4)
                    }
                    .buttonStyle(.borderedProminent).tint(Theme.accent)
                    .disabled(newRewardLabel.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }

            Text("Your rewards (\(bundle.rewards.count))").font(.outfitHeadline)
            if bundle.rewards.isEmpty {
                Card { EmptyStateView(symbol: "gift", title: "No rewards yet", message: "Add something worth saving up for.") }
            } else {
                ForEach(bundle.rewards) { reward in rewardRow(reward) }
            }
        }
    }

    private func tierCard(_ t: RewardTier) -> some View {
        let selected = newRewardTier == t
        return Button { newRewardTier = t } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(t.label).font(.outfitSubheadline).foregroundStyle(.primary)
                Label(t.hint, systemImage: t.symbol).font(.outfitCaption).foregroundStyle(.secondary)
                    .labelStyle(TealIconLabelStyle(spacing: 3))
                Label("\(t.cost)", systemImage: "dollarsign.circle.fill").font(.outfitCaption).foregroundStyle(Theme.gold)
                    .labelStyle(TealIconLabelStyle(spacing: 3))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Theme.Space.md)
            .background(selected ? Theme.gold.opacity(0.12) : Theme.screenBackground)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(selected ? Theme.gold.opacity(0.5) : Theme.cardBorder, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func rewardRow(_ reward: RewardStoreItem) -> some View {
        Card {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text(reward.label).font(.outfitSubheadline)
                    Label("\(reward.coinCost)", systemImage: "dollarsign.circle.fill").font(.outfitCaption).foregroundStyle(Theme.gold)
                        .labelStyle(TealIconLabelStyle(spacing: 3))
                }
                Spacer()
                if reward.affordable {
                    Button("Redeem") { Task { await model.redeem(reward) } }
                        .buttonStyle(.borderedProminent).tint(Theme.gold).foregroundStyle(.black)
                } else {
                    Text("\(reward.remaining) more to go").font(.outfitCaption).foregroundStyle(.secondary)
                }
                Button { Task { await model.deleteReward(reward) } } label: {
                    Image(systemName: "trash").font(.outfitCaption)
                }
                .buttonStyle(.plain).foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - Treats tab (mystery box + dopamine menu)

    private func treatsTab(_ bundle: RewardsViewModel.Bundle) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.lg) {
            if let mystery = bundle.mystery {
                Card {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Label("Mystery box", systemImage: "gift.fill").font(.outfitSubheadlineBold)
                                .labelStyle(TealIconLabelStyle())
                            Text("Open for \(mystery.cost) coins · \(mystery.rewardCount) in the pool")
                                .font(.outfitCaption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Open") { Task { await model.openMystery() } }
                            .buttonStyle(.borderedProminent).tint(Theme.gold).foregroundStyle(.black)
                            .disabled(!mystery.canOpen)
                    }
                }
            }

            Card {
                VStack(alignment: .leading, spacing: Theme.Space.md) {
                    Label("Add a treat", systemImage: "plus").font(.outfitSubheadlineBold)
                    HStack(spacing: Theme.Space.sm) {
                        TextField("e.g. 5 minutes of YouTube", text: $newTreat)
                            .textFieldStyle(.plain)
                            .padding(Theme.Space.md)
                            .background(Theme.screenBackground)
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        Button("Add") {
                            let t = newTreat.trimmingCharacters(in: .whitespaces)
                            guard !t.isEmpty else { return }
                            Task { await model.addDopamine(t) }
                            newTreat = ""
                        }
                        .buttonStyle(.borderedProminent).tint(Theme.accent)
                        .disabled(newTreat.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }

            Text("Dopamine menu").font(.outfitHeadline)
            if bundle.dopamine.isEmpty {
                Card { EmptyStateView(symbol: "cup.and.saucer", title: "Nothing here yet", message: "Add something small that makes you smile.") }
            } else {
                ForEach(bundle.dopamine) { item in
                    Card {
                        HStack {
                            Text(item.rewardText).font(.outfitSubheadline)
                            Spacer()
                            Button { Task { await model.deleteDopamine(item) } } label: {
                                Image(systemName: "trash").font(.outfitCaption)
                            }
                            .buttonStyle(.plain).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Power-Ups tab (stat perks)

    private func powerUpsTab(_ bundle: RewardsViewModel.Bundle) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.lg) {
            Text("Spend coins to play stronger. Nothing here costs XP or a streak.")
                .font(.outfitSubheadline).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if bundle.perks.isEmpty {
                Card { EmptyStateView(symbol: "bolt", title: "No power-ups available", message: nil) }
            } else {
                ForEach(bundle.perks) { perk in
                    Card {
                        HStack(spacing: Theme.Space.md) {
                            Image(systemName: "bolt.circle.fill").font(.system(size: 26))
                                .foregroundStyle(Theme.accent)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(perk.label).font(.outfitSubheadline)
                                Text(perk.description).font(.outfitCaption).foregroundStyle(.secondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            Spacer(minLength: Theme.Space.sm)
                            if perk.active == true {
                                Text("Active").font(.outfitCaption).foregroundStyle(Theme.success)
                            } else if perk.atMax == true {
                                Text("Max").font(.outfitCaption).foregroundStyle(.secondary)
                            } else {
                                Button { Task { await model.buyPerk(perk) } } label: {
                                    Label("\(perk.coinCost)", systemImage: "dollarsign.circle.fill")
                                        .labelStyle(TealIconLabelStyle(spacing: 3))
                                }
                                .buttonStyle(.bordered).tint(Theme.gold)
                                .disabled(!perk.affordable)
                            }
                        }
                    }
                }
            }
        }
    }
}
