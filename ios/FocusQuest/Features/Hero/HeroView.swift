import SwiftUI

@MainActor
final class HeroViewModel: ObservableObject {
    struct Bundle { let hero: HeroStatus; let avatar: AvatarProfile?; let kingdoms: KingdomsResponse?; let me: User? }
    @Published var state: Loadable<Bundle> = .idle

    func load() async {
        state = .loading
        do {
            async let hero = UserService.heroStatus()
            async let avatar = try? HeroService.avatar()
            async let kingdoms = try? UserService.kingdoms()
            async let me = try? UserService.me()
            let bundle = Bundle(hero: try await hero, avatar: await avatar, kingdoms: await kingdoms, me: await me)
            state = .loaded(bundle)
        } catch {
            state = .failed(error.userMessage)
        }
    }
}

struct HeroView: View {
    @StateObject private var model = HeroViewModel()

    var body: some View {
        NavigationStack {
            AsyncContentView(state: model.state, retry: { Task { await model.load() } }) { bundle in
                ScrollView {
                    VStack(alignment: .leading, spacing: Theme.Space.lg) {
                        if let name = bundle.me?.username { heroName(name, avatar: bundle.avatar) }
                        characterCard(bundle.hero, avatar: bundle.avatar)
                        if let avatar = bundle.avatar { equipmentCard(avatar) }
                        companionCard(bundle.hero.companion)
                        if let kingdoms = bundle.kingdoms { kingdomsCard(kingdoms) }
                    }
                    .padding(Theme.Space.lg)
                }
                .background(Theme.screenBackground)
                .refreshable { await model.load() }
            }
            .navigationTitle("Hero")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    NavigationLink { GearStoreView() } label: { Image(systemName: "shield.lefthalf.filled") }
                }
            }
            .task { if model.state.value == nil { await model.load() } }
        }
    }

    // MARK: - Header (web HeroIdentity)

    private func heroName(_ name: String, avatar: AvatarProfile?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(name).font(.outfitTitle2Bold)
            if let avatar {
                Text("\(avatar.avatarClass.capitalized) · Level \(avatar.level)")
                    .font(.outfitSubheadline).foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - Character panel (web PixelHero + HeroVitality)

    private func characterCard(_ hero: HeroStatus, avatar: AvatarProfile?) -> some View {
        Card {
            VStack(spacing: Theme.Space.md) {
                if let avatar {
                    PixelHeroView(look: avatar.heroLook, size: 140)
                } else {
                    Image(systemName: hero.stageSymbol)
                        .font(.system(size: 64))
                        .foregroundStyle(Theme.accent)
                }

                VitalityMeter(hero: hero)

                Text(hero.mood)
                    .font(.outfitCallout).italic()
                    .foregroundStyle(.secondary).multilineTextAlignment(.center)

                (Text("Currently: ").foregroundStyle(.secondary)
                    + Text(hero.activity.text).italic().foregroundStyle(.secondary))
                    .font(.outfitCaption).multilineTextAlignment(.center)

                if let avatar {
                    HStack(spacing: Theme.Space.lg) {
                        Label("Level \(avatar.level)", systemImage: "star.fill")
                        Label("\(avatar.battlePower) power", systemImage: "bolt.fill").foregroundStyle(Theme.accent)
                    }
                    .font(.outfitCaption)
                }
                Text("Last fed \(DateUtils.relative(hero.lastFedAt))")
                    .font(.outfitCaption2).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: - Equipment slots (web EquipmentSlotCard grid)

    private func equipmentCard(_ avatar: AvatarProfile) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                SectionHeader("Loadout") {
                    AvatarBadge(name: avatar.avatarClass, colorHex: avatar.avatarColor, size: 28)
                }
                ForEach(GearSlot.order, id: \.rawValue) { slot in
                    EquipmentSlotRow(slot: slot, item: avatar.equippedGear.first { $0.slot.lowercased() == slot.rawValue })
                }
            }
        }
    }

    private func companionCard(_ companion: HeroStatus.Companion) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                HStack {
                    Label("Companion", systemImage: "pawprint.fill")
                        .font(.outfitSubheadlineBold).labelStyle(TealIconLabelStyle())
                    Spacer()
                    Text("\(companion.bondTierName) · Tier \(companion.bondTier)").font(.outfitCaption).foregroundStyle(.secondary)
                }
                if !companion.line.isEmpty {
                    Text("“\(companion.line)”").font(.outfitCallout).italic()
                }
                Text("\(companion.bondQuestsCompleted) quests together").font(.outfitCaption).foregroundStyle(.secondary)
            }
        }
    }

    private func kingdomsCard(_ response: KingdomsResponse) -> some View {
        let capital = response.kingdoms.first { $0.isCapital }
        let others = response.kingdoms.filter { !$0.isCapital }
        // Two per row (5 areas → 2/2/1), all tiles the same size on purpose: sizing
        // by activity would rank a user's life areas against each other.
        let columns = [GridItem(.flexible(), spacing: Theme.Space.sm),
                       GridItem(.flexible(), spacing: Theme.Space.sm)]
        return Card {
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                SectionHeader("Life Kingdoms") {
                    if response.worldResting {
                        Label("Resting", systemImage: "moon.zzz.fill")
                            .font(.outfitCaption).foregroundStyle(.secondary)
                            .labelStyle(TealIconLabelStyle())
                    }
                }
                Text(response.worldResting
                     ? "Your world is resting. Every place you've built is still standing."
                     : "Each life area grows as you work in it. Quiet places are just sleeping.")
                    .font(.outfitCaption).foregroundStyle(.secondary)

                LazyVGrid(columns: columns, spacing: Theme.Space.sm) {
                    ForEach(others) { kingdom in
                        kingdomTile(kingdom, worldResting: response.worldResting)
                    }
                }

                if let capital { capitalBand(capital) }

                if !response.worldResting, let invitation = response.invitation {
                    Text("\(invitation.kingdomName) has been quiet lately — it's still there whenever you want to head back.")
                        .font(.outfitCaption).foregroundStyle(Theme.accent)
                }
            }
        }
    }

    /// One life-area tile: its scene image with the name + tier caption beneath.
    private func kingdomTile(_ kingdom: KingdomState, worldResting: Bool) -> some View {
        VStack(spacing: 0) {
            KingdomSceneImage(
                kingdomId: kingdom.id,
                tier: kingdom.tier,
                liveliness: worldResting ? "stirring" : kingdom.liveliness)
                .frame(maxWidth: .infinity)
            HStack(spacing: Theme.Space.sm) {
                Text(kingdom.name).font(.outfitCaptionBold).lineLimit(1)
                Spacer(minLength: 4)
                Text(kingdom.tierName.uppercased())
                    .font(.outfitCaption2).foregroundStyle(.secondary).lineLimit(1)
            }
            .padding(.horizontal, Theme.Space.sm)
            .padding(.vertical, 6)
        }
        .background(Theme.screenBackground.opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
            .strokeBorder(Color.white.opacity(0.10)))
    }

    /// The capital: a full-width band cropped to its centre composition, with a
    /// bottom gradient carrying the label — the seat of the realm. The scene is an
    /// overlay on a fixed-size container so its wide (1024×192) art crops to the
    /// column width instead of stretching the card past the screen.
    private func capitalBand(_ capital: KingdomState) -> some View {
        Color.clear
            .frame(maxWidth: .infinity)
            .frame(height: 104)
            .overlay {
                KingdomSceneImage(kingdomId: capital.id, tier: capital.tier, liveliness: nil, fill: true)
            }
            .overlay(alignment: .bottom) {
                LinearGradient(colors: [.clear, Theme.screenBackground.opacity(0.92)],
                               startPoint: .top, endPoint: .bottom)
                    .frame(height: 56)
            }
            .overlay(alignment: .bottom) {
                HStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("SEAT OF THE REALM")
                            .font(.outfitCaption2).kerning(1.5).foregroundStyle(.secondary)
                        Text("The Capital").font(.outfitSubheadline)
                    }
                    Spacer()
                    Text(capital.tier > 0 ? capital.tierName.uppercased() : "UNFOUNDED")
                        .font(.outfitCaption2).foregroundStyle(.secondary)
                }
                .padding(.horizontal, Theme.Space.sm)
                .padding(.vertical, 8)
            }
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(Color.white.opacity(0.10)))
    }
}

// MARK: - Vitality meter (web HeroVitality)

/// Five-segment hunger/vitality bar + stage label, matching the web hero panel.
private struct VitalityMeter: View {
    let hero: HeroStatus
    var body: some View {
        HStack(spacing: Theme.Space.sm) {
            HStack(spacing: 3) {
                ForEach(0..<5, id: \.self) { i in
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(i < hero.stageSegments
                              ? (hero.stageDanger ? Theme.danger : Theme.gold)
                              : Color.white.opacity(0.15))
                        .frame(width: 18, height: 8)
                }
            }
            Text(hero.stageLabel)
                .font(.outfitCaption).fontWeight(.medium)
                .foregroundStyle(hero.stageDanger ? Theme.danger : Color.secondary)
        }
    }
}

// MARK: - Equipment slot row (web EquipmentSlotCard)

private enum GearSlot: String {
    case weapon, helmet, armor, boots, accessory
    static let order: [GearSlot] = [.weapon, .helmet, .armor, .boots, .accessory]
    var label: String { rawValue.capitalized }
    /// Slot-based glyph (the web keys the icon off the slot, not the item).
    /// SF Symbol rendered in electric teal.
    var symbol: String {
        switch self {
        case .weapon: return "bolt.fill"
        case .helmet: return "shield.lefthalf.filled"
        case .armor: return "shield.fill"
        case .boots: return "figure.walk"
        case .accessory: return "sparkles"
        }
    }
}

private struct EquipmentSlotRow: View {
    let slot: GearSlot
    let item: EquippedGearItem?
    var body: some View {
        HStack(spacing: Theme.Space.md) {
            ZStack {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill((item.map { $0.rarityColor } ?? .secondary).opacity(0.15))
                    .frame(width: 34, height: 34)
                Image(systemName: slot.symbol)
                    .font(.system(size: 16))
                    .foregroundStyle(Theme.accent)
                    .opacity(item == nil ? 0.3 : 1)
            }
            if let item {
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.name).font(.outfitSubheadline).lineLimit(1)
                    HStack(spacing: Theme.Space.sm) {
                        Text(item.rarity.uppercased())
                            .font(.outfitCaption2).fontWeight(.bold).kerning(0.5)
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .background(item.rarityColor.opacity(0.18))
                            .foregroundStyle(item.rarityColor)
                            .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                        Text("+\(item.statPower) power").font(.outfitCaption).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
            } else {
                Text("\(slot.label) — empty").font(.outfitSubheadline).foregroundStyle(.secondary.opacity(0.6))
                Spacer(minLength: 0)
            }
        }
        .padding(.horizontal, Theme.Space.md)
        .padding(.vertical, Theme.Space.sm)
        .background(item == nil ? Color.clear : Theme.screenBackground.opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(item.map { $0.rarityColor.opacity(0.5) } ?? Color.white.opacity(0.12),
                              style: StrokeStyle(lineWidth: 1, dash: item == nil ? [4] : []))
        )
    }
}

// MARK: - Model helpers mirroring the web hero-vitality lib

private extension HeroStatus {
    var stageSegments: Int {
        switch stage {
        case "well_fed": return 5
        case "peckish": return 4
        case "hungry": return 3
        case "starving": return 1
        default: return 0 // fainted / unknown
        }
    }
    var stageLabel: String {
        switch stage {
        case "well_fed": return "Well Fed"
        case "peckish": return "Peckish"
        case "hungry": return "Hungry"
        case "starving": return "Starving"
        case "fainted": return "Fainted"
        default: return stage.capitalized
        }
    }
    var stageDanger: Bool { stage == "starving" || stage == "fainted" }
}

private extension EquippedGearItem {
    /// Rarity → color, matching the web RARITY_COLORS.
    var rarityColor: Color {
        switch rarity.lowercased() {
        case "rare": return Color(h: 217, s: 0.91, l: 0.60)      // #3b82f6
        case "epic": return Color(h: 271, s: 0.91, l: 0.65)      // #a855f7
        case "legendary": return Color(h: 38, s: 0.92, l: 0.50)  // #f59e0b
        default: return Color(h: 220, s: 0.09, l: 0.65)          // #9ca3af common
        }
    }
}
