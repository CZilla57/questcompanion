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
    @Published var showAddReward = false

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
}

struct RewardsView: View {
    @StateObject private var model = RewardsViewModel()

    var body: some View {
        AsyncContentView(state: model.state, retry: { Task { await model.load() } }) { bundle in
            List {
                Section {
                    HStack {
                        Text("🪙 Coins").font(.headline)
                        Spacer()
                        Text("\(bundle.coins)").font(.title3.bold()).foregroundStyle(Theme.gold)
                    }
                }

                if let mystery = bundle.mystery {
                    Section("Mystery box") {
                        HStack {
                            VStack(alignment: .leading) {
                                Text("Open for \(mystery.cost) coins").font(.subheadline)
                                Text("\(mystery.rewardCount) rewards in the pool").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("Open 🎁") { Task { await model.openMystery() } }
                                .buttonStyle(.borderedProminent).tint(Theme.gold)
                                .disabled(!mystery.canOpen)
                        }
                    }
                }

                Section {
                    ForEach(bundle.rewards) { reward in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(reward.label).font(.subheadline)
                                Text("\(reward.tier.capitalized) · \(reward.coinCost) coins").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("Redeem") { Task { await model.redeem(reward) } }
                                .buttonStyle(.bordered)
                                .disabled(!reward.affordable)
                        }
                    }
                    .onDelete { indexSet in
                        for i in indexSet { Task { await model.deleteReward(bundle.rewards[i]) } }
                    }
                } header: {
                    HStack {
                        Text("Real-life rewards")
                        Spacer()
                        Button("Add") { model.showAddReward = true }.font(.caption)
                    }
                }

                if !bundle.perks.isEmpty {
                    Section("Stat perks") {
                        ForEach(bundle.perks) { perk in
                            HStack {
                                Text(perk.emoji)
                                VStack(alignment: .leading) {
                                    Text(perk.label).font(.subheadline)
                                    Text(perk.description).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Button("\(perk.coinCost)") { Task { await model.buyPerk(perk) } }
                                    .buttonStyle(.bordered).disabled(!perk.affordable)
                            }
                        }
                    }
                }

                if !bundle.dopamine.isEmpty {
                    Section("Dopamine menu") {
                        ForEach(bundle.dopamine) { item in Text(item.rewardText).font(.subheadline) }
                    }
                }
            }
            .refreshable { await model.load() }
        }
        .navigationTitle("Rewards")
        .sheet(isPresented: $model.showAddReward) {
            AddRewardSheet { label, tier in Task { await model.addReward(label: label, tier: tier) } }
        }
        .alert("Mystery Box", isPresented: .constant(model.mysteryResult != nil)) {
            Button("Nice!") { model.mysteryResult = nil }
        } message: {
            if let r = model.mysteryResult {
                Text(r.opened ? "You won: \(r.reward?.rewardText ?? "a reward")!" + (r.bonus.map { $0 > 0 ? " (+\($0) coins back)" : "" } ?? "") : "Couldn't open the box.")
            }
        }
        .task { if model.state.value == nil { await model.load() } }
    }
}

struct AddRewardSheet: View {
    var onAdd: (String, String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var label = ""
    @State private var tier = "small"

    var body: some View {
        NavigationStack {
            Form {
                TextField("Reward (e.g. 30 min of a show)", text: $label)
                Picker("Tier", selection: $tier) {
                    ForEach(["small", "medium", "large", "treat"], id: \.self) { Text($0.capitalized).tag($0) }
                }
            }
            .navigationTitle("New Reward")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { onAdd(label, tier); dismiss() }
                        .disabled(label.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }
}
