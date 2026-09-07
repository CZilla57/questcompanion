import SwiftUI

// The Campaign — second wave (Inventory & Salvage). Owned-gear inventory grouped
// by slot, with a loadout summary, inline equip/unequip, and salvage-for-coins.
@MainActor
final class InventoryViewModel: ObservableObject {
    @Published var state: Loadable<InventoryResponse> = .idle
    @Published var busyId: Int?

    func load() async {
        state = .loading
        do { state = .loaded(try await HeroService.inventory()) }
        catch { state = .failed(error.userMessage) }
    }

    func toggleEquip(_ item: InventoryItem) async {
        busyId = item.id
        if item.equipped { _ = try? await HeroService.unequipGear(id: item.id) }
        else { _ = try? await HeroService.equipGear(id: item.id) }
        busyId = nil
        await load()
    }

    /// Returns the coins gained on success, so the view can surface a toast.
    func salvage(_ item: InventoryItem) async -> Int? {
        busyId = item.id
        let result = try? await HeroService.salvageGear(id: item.id)
        busyId = nil
        await load()
        return result?.coinsGained
    }
}

struct InventoryView: View {
    @StateObject private var model = InventoryViewModel()
    @State private var toSalvage: InventoryItem?
    @State private var lastSalvage: String?

    var body: some View {
        AsyncContentView(state: model.state, retry: { Task { await model.load() } }) { inv in
            NeonList {
                Section {
                    HStack {
                        Label("\(inv.equippedPower) gear power", systemImage: "bolt.fill")
                            .labelStyle(TealIconLabelStyle(spacing: 3))
                        Spacer()
                        Text("\(inv.equippedCount)/\(inv.loadout.count) equipped")
                            .foregroundStyle(.secondary)
                    }.font(.outfitSubheadline)
                    HStack {
                        Label("\(inv.coinBalance) coins", systemImage: "dollarsign.circle.fill")
                            .labelStyle(TealIconLabelStyle(spacing: 3))
                        Spacer()
                        Text("\(inv.ownedCount) owned").foregroundStyle(.secondary)
                    }.font(.outfitCaption)
                    if let lastSalvage {
                        Text(lastSalvage).font(.outfitCaption).foregroundStyle(Theme.gold)
                    }
                }

                if inv.items.isEmpty {
                    Section {
                        Text("No gear yet — buy from the store or win it from encounters.")
                            .font(.outfitCallout).foregroundStyle(.secondary)
                    }
                } else {
                    ForEach(slotSections(inv.items), id: \.slot) { section in
                        Section(section.slot.capitalized) {
                            ForEach(section.items) { item in row(item) }
                        }
                    }
                }
            }
            .refreshable { await model.load() }
        }
        .navigationTitle("Inventory")
        .task { if model.state.value == nil { await model.load() } }
        .confirmationDialog(
            "Salvage \(toSalvage?.name ?? "")?",
            isPresented: Binding(get: { toSalvage != nil }, set: { if !$0 { toSalvage = nil } }),
            presenting: toSalvage
        ) { item in
            Button("Salvage for \(item.salvageValue) coins", role: .destructive) {
                Task {
                    if let gained = await model.salvage(item) {
                        lastSalvage = "Salvaged \(item.name) · +\(gained) coins"
                    }
                }
            }
            Button("Keep it", role: .cancel) {}
        } message: { item in
            Text("Permanently gives up \(item.name) to recover \(item.salvageValue) coins. You can buy it again later.")
        }
    }

    @ViewBuilder
    private func row(_ item: InventoryItem) -> some View {
        HStack(spacing: Theme.Space.md) {
            Image(systemName: gearSlotSymbol(item.slot)).font(.outfitTitle2)
                .foregroundStyle(rarityColor(item.rarity)).frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 5) {
                    Text(item.name).font(.outfitSubheadline)
                    if item.equipped {
                        Text("Equipped").font(.outfitCaption2).foregroundStyle(Theme.accent)
                    }
                }
                Text("\(item.rarity.capitalized) · +\(item.statPower)")
                    .font(.outfitCaption).foregroundStyle(.secondary)
            }
            Spacer()
            Button(item.equipped ? "Unequip" : "Equip") { Task { await model.toggleEquip(item) } }
                .buttonStyle(.bordered).disabled(model.busyId != nil)
            Button {
                toSalvage = item
            } label: {
                Label("\(item.salvageValue)", systemImage: "arrow.3.trianglepath")
            }
            .buttonStyle(.borderless).tint(Theme.gold)
            .disabled(item.equipped || model.busyId != nil)
        }
    }

    /// Owned items grouped by slot, in the canonical slot order, equipped first
    /// then by descending power.
    private func slotSections(_ items: [InventoryItem]) -> [(slot: String, items: [InventoryItem])] {
        let order = ["weapon", "helmet", "armor", "boots", "accessory"]
        return order.compactMap { slot in
            let group = items
                .filter { $0.slot == slot }
                .sorted { ($0.equipped ? 1 : 0, $0.statPower) > ($1.equipped ? 1 : 0, $1.statPower) }
            return group.isEmpty ? nil : (slot, group)
        }
    }
}

/// Rarity → color for a raw rarity string, matching the web RARITY_COLORS.
func rarityColor(_ rarity: String) -> Color {
    switch rarity.lowercased() {
    case "rare": return Color(h: 217, s: 0.91, l: 0.60)      // #3b82f6
    case "epic": return Color(h: 271, s: 0.91, l: 0.65)      // #a855f7
    case "legendary": return Color(h: 38, s: 0.92, l: 0.50)  // #f59e0b
    default: return Color(h: 220, s: 0.09, l: 0.65)          // #9ca3af common
    }
}
