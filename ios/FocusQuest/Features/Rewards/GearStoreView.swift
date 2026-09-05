import SwiftUI

@MainActor
final class GearStoreViewModel: ObservableObject {
    @Published var state: Loadable<GearStoreResponse> = .idle
    func load() async {
        state = .loading
        do { state = .loaded(try await HeroService.gearStore()) }
        catch { state = .failed(error.userMessage) }
    }
    func buy(_ item: GearStoreItem) async { _ = try? await HeroService.buyGear(id: item.id); await load() }
    func equip(_ item: GearStoreItem) async {
        if item.equipped { _ = try? await HeroService.unequipGear(id: item.id) }
        else { _ = try? await HeroService.equipGear(id: item.id) }
        await load()
    }
}

struct GearStoreView: View {
    @StateObject private var model = GearStoreViewModel()

    var body: some View {
        AsyncContentView(state: model.state, retry: { Task { await model.load() } }) { store in
            NeonList {
                Section {
                    HStack {
                        Text("🪙 \(store.coinBalance) coins")
                        Spacer()
                        Text("Level \(store.userLevel)").foregroundStyle(.secondary)
                    }.font(.outfitSubheadline)
                }
                ForEach(store.items) { item in
                    HStack(spacing: Theme.Space.md) {
                        Text(item.icon).font(.outfitTitle2)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.name).font(.outfitSubheadline)
                            Text("\(item.slot.capitalized) · \(item.rarity.capitalized) · +\(item.statPower)")
                                .font(.outfitCaption).foregroundStyle(.secondary)
                            if !item.meetsLevel { Text("Needs level \(item.levelRequired)").font(.outfitCaption2).foregroundStyle(Theme.danger) }
                        }
                        Spacer()
                        if item.owned {
                            Button(item.equipped ? "Unequip" : "Equip") { Task { await model.equip(item) } }
                                .buttonStyle(.bordered)
                        } else {
                            Button("\(item.costCoins) 🪙") { Task { await model.buy(item) } }
                                .buttonStyle(.borderedProminent).tint(Theme.gold)
                                .disabled(!item.canAfford || !item.meetsLevel)
                        }
                    }
                }
            }
            .refreshable { await model.load() }
        }
        .navigationTitle("Gear Store")
        .task { if model.state.value == nil { await model.load() } }
    }
}
