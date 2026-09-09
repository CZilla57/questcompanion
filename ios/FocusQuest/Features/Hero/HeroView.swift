import SwiftUI

@MainActor
final class HeroViewModel: ObservableObject {
    struct Bundle {
        let hero: HeroStatus
        let avatar: AvatarProfile?
        let kingdoms: KingdomsResponse?
        let me: User?
        let sheet: CharacterSheet?
        let encounter: PersonalEncounterStatus?
        let feats: FeatsResponse?
        // Act V: the capital (a home that visibly grows). Optional so a pre-deploy
        // server just omits the card.
        let capital: CapitalProgress?
    }
    @Published var state: Loadable<Bundle> = .idle
    /// The active feat currently being used, so its button can show progress.
    @Published var activatingFeatId: String?
    /// True while a specialization choice is in flight (Act V).
    @Published var choosingBranch = false

    func load() async {
        state = .loading
        do {
            async let hero = UserService.heroStatus()
            async let avatar = try? HeroService.avatar()
            async let kingdoms = try? UserService.kingdoms()
            async let me = try? UserService.me()
            async let sheet = try? UserService.characterSheet()
            async let encounter = try? UserService.currentEncounter()
            async let feats = try? FeatService.list()
            async let capital = try? UserService.capital()
            let bundle = Bundle(
                hero: try await hero, avatar: await avatar, kingdoms: await kingdoms,
                me: await me, sheet: await sheet, encounter: await encounter,
                feats: await feats, capital: await capital)
            state = .loaded(bundle)
        } catch {
            state = .failed(error.userMessage)
        }
    }

    /// Act V free respec: choose a specialization branch, or nil to clear. Best-
    /// effort; reloads so the feats card reflects the new calling.
    func chooseBranch(_ id: String?) async {
        choosingBranch = true
        _ = try? await FeatService.chooseBranch(id)
        choosingBranch = false
        await load()
    }

    /// Use an active feat, then reload so its readiness flips and any granted
    /// boost/shield shows. Best-effort — a failure just leaves the card as-is.
    func activate(_ feat: Feat) async {
        activatingFeatId = feat.id
        _ = try? await FeatService.activate(id: feat.id)
        activatingFeatId = nil
        await load()
    }
}

struct HeroView: View {
    @StateObject private var model = HeroViewModel()
    @State private var namingCompanion = false

    var body: some View {
        NavigationStack {
            AsyncContentView(state: model.state, retry: { Task { await model.load() } }) { bundle in
                ScrollView {
                    VStack(alignment: .leading, spacing: Theme.Space.lg) {
                        if let name = bundle.me?.username { heroName(name, avatar: bundle.avatar) }
                        characterCard(bundle.hero, avatar: bundle.avatar)
                        if let wr = bundle.hero.wellRested, wr.active { wellRestedBadge(wr) }
                        if let capital = bundle.capital { capitalCard(capital) }
                        if let sheet = bundle.sheet { characterSheetCard(sheet) }
                        if let feats = bundle.feats, !(feats.unlocked.isEmpty && feats.locked.isEmpty) {
                            featsCard(feats)
                        }
                        if let avatar = bundle.avatar { equipmentCard(avatar) }
                        companionCard(bundle.hero.companion)
                        if let encounter = bundle.encounter { encounterCard(encounter) }
                        if let kingdoms = bundle.kingdoms { kingdomsCard(kingdoms) }
                    }
                    // Bound the content to the viewport so long text (e.g. the Act V
                    // specialization copy) wraps instead of forcing the whole
                    // vertical ScrollView wider than the screen.
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(Theme.Space.lg)
                }
                .background(Theme.screenBackground)
                .refreshable { await model.load() }
                .sheet(isPresented: $namingCompanion) {
                    CompanionNamingSheet(companion: bundle.hero.companion) { await model.load() }
                }
            }
            .navigationTitle("Hero")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    NavigationLink { InventoryView() } label: { Image(systemName: "backpack.fill") }
                }
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
                    Label(companion.displayName, systemImage: "pawprint.fill")
                        .font(.outfitSubheadlineBold).labelStyle(TealIconLabelStyle())
                    Button {
                        namingCompanion = true
                    } label: {
                        Image(systemName: "pencil").font(.caption)
                    }
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Name your companion")
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

    // MARK: - Character sheet (The Campaign — Phase 0)

    private func characterSheetCard(_ sheet: CharacterSheet) -> some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: Theme.Space.sm), count: 3)
        return Card {
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                SectionHeader("Character Sheet") {
                    Text("Lvl \(sheet.level) \(sheet.heroClass.capitalized) · Prof \(sheet.proficiencyText)")
                        .font(.outfitCaption).foregroundStyle(.secondary)
                }
                LazyVGrid(columns: columns, spacing: Theme.Space.sm) {
                    ForEach(sheet.abilities) { ability in
                        VStack(spacing: 2) {
                            Text(ability.name.uppercased())
                                .font(.outfitCaption2).kerning(0.5).foregroundStyle(.secondary)
                                .lineLimit(1).minimumScaleFactor(0.8)
                            Text("\(ability.score)").font(.outfitTitle2Bold)
                            Text(ability.modifierText).font(.outfitCaption).foregroundStyle(Theme.accent)
                            if let progress = ability.progress {
                                AbilityProgressBar(progress: progress)
                                    .padding(.top, 3)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, Theme.Space.sm)
                        .padding(.horizontal, 6)
                        .background(Theme.screenBackground.opacity(0.5))
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.10)))
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(abilityAccessibilityLabel(ability))
                    }
                }
            }
        }
    }

    /// Reads the score, modifier, and (when present) how close the next quest in
    /// this area is to the next point — spoken, never a bare number.
    private func abilityAccessibilityLabel(_ ability: AbilityScore) -> String {
        var label = "\(ability.name) \(ability.score), modifier \(ability.modifierText)"
        if let p = ability.progress {
            if p.atMax {
                label += ", at its peak"
            } else if let next = p.nextScore {
                label += ", \(Int((p.clampedFraction * 100).rounded()))% to \(next)"
            }
        }
        return label
    }

    // MARK: - Class Feats (The Campaign — second wave)

    private func featsCard(_ feats: FeatsResponse) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                SectionHeader("Class Feats")
                ForEach(feats.unlocked) { feat in unlockedFeatRow(feat) }
                ForEach(feats.locked) { feat in lockedFeatRow(feat) }
                if let tree = feats.branchTree { specializationSection(tree) }
            }
        }
    }

    // MARK: - Act V: specialization (free respec — "focus, not a cage")

    @ViewBuilder private func specializationSection(_ tree: FeatBranchTree) -> some View {
        Divider().overlay(Theme.cardBorder)
        VStack(alignment: .leading, spacing: Theme.Space.sm) {
            HStack(spacing: 6) {
                Label("Specialization", systemImage: "arrow.triangle.branch")
                    .font(.outfitSubheadlineBold).labelStyle(TealIconLabelStyle(spacing: 4))
                if !tree.unlocked {
                    Text("Opens at Level \(tree.unlockLevel)").font(.outfitCaption).foregroundStyle(.secondary)
                }
            }
            Text("Choose a second calling for a +\(tree.bonusPct)% XP bias there. Free to change anytime — nothing is ever locked out.")
                .font(.outfitCaption).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            ForEach(tree.branches) { branch in
                branchRow(branch, chosen: tree.chosen == branch.id, unlocked: tree.unlocked)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func branchRow(_ branch: FeatBranch, chosen: Bool, unlocked: Bool) -> some View {
        HStack(spacing: Theme.Space.sm) {
            Text(branch.emoji).font(.outfitTitle2)
            VStack(alignment: .leading, spacing: 2) {
                Text(branch.label).font(.outfitSubheadlineBold)
                Text(branch.description).font(.outfitCaption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: Theme.Space.sm)
            if chosen {
                Button { Task { await model.chooseBranch(nil) } } label: {
                    Label("Chosen", systemImage: "checkmark.circle.fill")
                        .font(.outfitCaptionBold).labelStyle(TealIconLabelStyle(spacing: 3))
                }
                .buttonStyle(.bordered).tint(Theme.success)
                .disabled(model.choosingBranch)
            } else {
                Button { Task { await model.chooseBranch(branch.id) } } label: {
                    Text(unlocked ? "Choose" : "Locked").font(.outfitCaptionBold)
                }
                .buttonStyle(.bordered).tint(Theme.accent)
                .disabled(!unlocked || model.choosingBranch)
            }
        }
        .padding(Theme.Space.sm)
        .background(chosen ? Theme.accentSoft : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    // MARK: - Act IV: Well-Rested badge

    private func wellRestedBadge(_ wr: HeroStatus.WellRested) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "moon.stars.fill").foregroundStyle(Theme.accent)
            Text("Well-Rested +\(wr.bonus)").font(.outfitSubheadlineBold).foregroundStyle(Theme.accent)
            Text("to quest rolls while your good run holds").font(.outfitCaption).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, Theme.Space.md).padding(.vertical, Theme.Space.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.accentSoft)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    // MARK: - Act V: the Capital (a home that visibly grows)

    private func capitalCard(_ capital: CapitalProgress) -> some View {
        let founded = capital.tier > 0
        return Card {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                HStack {
                    Label("The Capital", systemImage: "building.columns.fill")
                        .font(.outfitSubheadlineBold).labelStyle(TealIconLabelStyle())
                    Spacer()
                    Text(founded ? capital.name : "Unfounded").font(.outfitCaption).foregroundStyle(.secondary)
                }
                // A .fill scene reports a wide ideal width; hosting it as an OVERLAY
                // on a width-bounded Color.clear keeps it from stretching the card
                // past the screen (mirrors capitalBand's pattern).
                Color.clear
                    .frame(maxWidth: .infinity)
                    .frame(height: 96)
                    .overlay { KingdomSceneImage(kingdomId: "capital", tier: capital.tier, liveliness: nil, fill: true) }
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                if capital.atMax {
                    Text("The realm is at its height — Eternal Capital. ✦")
                        .font(.outfitCaption).foregroundStyle(Theme.accent)
                } else {
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Color.white.opacity(0.12))
                            Capsule().fill(Theme.accent).frame(width: geo.size.width * max(0, min(1, capital.fraction)))
                        }
                    }
                    .frame(height: 6)
                    Text("\(capital.pointsToNext) to \(capital.nextName ?? "")")
                        .font(.outfitCaption2).foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder private func unlockedFeatRow(_ feat: Feat) -> some View {
        HStack(spacing: Theme.Space.sm) {
            Text(feat.emoji).font(.outfitTitle2)
            VStack(alignment: .leading, spacing: 2) {
                Text(feat.label).font(.outfitSubheadlineBold)
                Text(feat.description).font(.outfitCaption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: Theme.Space.sm)
            if feat.isActive {
                if feat.isUsable {
                    Button {
                        Task { await model.activate(feat) }
                    } label: {
                        Text(model.activatingFeatId == feat.id ? "…" : "Use today").font(.outfitCaptionBold)
                    }
                    .buttonStyle(.borderedProminent).tint(Theme.accent)
                    .disabled(model.activatingFeatId != nil)
                } else {
                    Text(feat.atMax == true ? "Fully warded" : "Ready tomorrow")
                        .font(.outfitCaption).foregroundStyle(.secondary)
                }
            } else {
                Label("Always on", systemImage: "infinity")
                    .font(.outfitCaption2).labelStyle(TealIconLabelStyle(spacing: 3))
                    .foregroundStyle(Theme.accent)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func lockedFeatRow(_ feat: Feat) -> some View {
        HStack(spacing: Theme.Space.sm) {
            Image(systemName: "lock.fill").font(.outfitCaption).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(feat.label).font(.outfitSubheadline).foregroundStyle(.secondary)
                Text(feat.description).font(.outfitCaption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: Theme.Space.sm)
            Text("Level \(feat.unlockLevel)").font(.outfitCaption).foregroundStyle(.secondary)
        }
        .opacity(0.7)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(feat.label), unlocks at level \(feat.unlockLevel)")
    }

    // MARK: - Personal encounter (The Campaign — Phase 2)

    private func encounterCard(_ status: PersonalEncounterStatus) -> some View {
        let enc = status.encounter
        let pct = max(0, min(1, enc.percentRemaining))
        return Card {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                HStack {
                    Label("Encounter", systemImage: "shield.lefthalf.filled")
                        .font(.outfitSubheadlineBold).labelStyle(TealIconLabelStyle())
                    Spacer()
                    Text(enc.phaseLabel).font(.outfitCaption).foregroundStyle(.secondary)
                }
                HStack(alignment: .firstTextBaseline) {
                    Text(status.name).font(.outfitHeadline)
                    Spacer(minLength: Theme.Space.sm)
                    Text("Tier \(status.tier)").font(.outfitCaption2).fontWeight(.bold).kerning(0.5)
                        .foregroundStyle(.secondary)
                }
                if let motive = status.motive, !motive.isEmpty {
                    Text(motive).font(.outfitCaption).italic().foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.white.opacity(0.12))
                        // The foe's HP drains as you complete quests; the color warms
                        // from teal → gold → red as it weakens, reading as progress.
                        Capsule().fill(enc.hpBarColor).frame(width: geo.size.width * pct)
                            .animation(.spring(response: 0.5, dampingFraction: 0.8), value: pct)
                    }
                }
                .frame(height: 10)
                HStack {
                    Text("\(enc.hpRemaining) / \(enc.hp) HP").font(.outfitCaption2).foregroundStyle(.secondary)
                    Spacer()
                    Text(enc.status == "resting" ? "Recovering — it'll return" : "Every quest lands a blow")
                        .font(.outfitCaption2).foregroundStyle(.secondary)
                }
                // Act V: into the discovery log of foes you've felled.
                NavigationLink { BestiaryView() } label: {
                    Label("Bestiary", systemImage: "book.closed.fill")
                        .font(.outfitCaption).labelStyle(TealIconLabelStyle(spacing: 3))
                }
                .buttonStyle(.plain).foregroundStyle(Theme.accent)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(
                "Encounter: \(status.name), tier \(status.tier). \(enc.hpRemaining) of \(enc.hp) hit points. \(enc.phaseLabel).")
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

// MARK: - Ability progress bar (Act I — per-task ability feedback)

/// A thin bar under each ability showing how far the next completed quest in
/// that life area has carried the score toward its next point. Gold when the
/// ability is maxed; teal while climbing. Purely derived, never a countdown.
private struct AbilityProgressBar: View {
    let progress: AbilityProgress
    var body: some View {
        GeometryReader { geo in
            let filled = progress.atMax ? 1 : progress.clampedFraction
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.12))
                Capsule()
                    .fill(progress.atMax ? Theme.gold : Theme.accent)
                    .frame(width: max(0, geo.size.width * filled))
            }
        }
        .frame(height: 3)
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

// MARK: - Companion naming (Act III — the Living World)

/// Rename the companion and pick its disposition. Purely cosmetic — the fallback
/// name and warm disposition mean skipping this leaves the companion unchanged.
private struct CompanionNamingSheet: View {
    let companion: HeroStatus.Companion
    let onSaved: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var disposition: CompanionDisposition
    @State private var saving = false
    @State private var errorText: String?

    init(companion: HeroStatus.Companion, onSaved: @escaping () async -> Void) {
        self.companion = companion
        self.onSaved = onSaved
        _name = State(initialValue: companion.name ?? "")
        _disposition = State(initialValue: CompanionDisposition(rawValue: companion.disposition ?? "warm") ?? .warm)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Name") {
                    TextField("Name your companion", text: $name)
                        .textInputAutocapitalization(.words)
                }
                Section("Disposition") {
                    Picker("Disposition", selection: $disposition) {
                        ForEach(CompanionDisposition.allCases) { d in Text(d.label).tag(d) }
                    }
                    .pickerStyle(.segmented)
                    Text(disposition.hint).font(.outfitCaption).foregroundStyle(.secondary)
                }
                if let errorText {
                    Text(errorText).font(.outfitCaption).foregroundStyle(Theme.danger)
                }
            }
            .navigationTitle("Your companion")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }.disabled(saving)
                }
            }
        }
    }

    private func save() async {
        saving = true
        errorText = nil
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            _ = try await UserService.updateCompanion(name: trimmed.isEmpty ? nil : trimmed, disposition: disposition.rawValue)
            await onSaved()
            dismiss()
        } catch {
            errorText = error.userMessage
            saving = false
        }
    }
}

// MARK: - Act V: the Bestiary (discovery log)

/// A collection you complete by felling each roster foe. Derived server-side
/// from the hero's fell history. Anti-shame: an unmet foe is a "not yet
/// encountered" silhouette, never "unbeaten"; facing one again is a re-match.
struct BestiaryView: View {
    @State private var state: Loadable<Bestiary> = .idle

    var body: some View {
        AsyncContentView(state: state, retry: { Task { await load() } }) { bestiary in
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.md) {
                    Text("The frictions you've faced as foes. Fell one to add it to your log — the ones you haven't met yet wait in shadow.")
                        .font(.outfitSubheadline).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("\(bestiary.discoveredCount) / \(bestiary.total) discovered")
                        .font(.outfitSubheadlineBold).foregroundStyle(Theme.accent)
                    ForEach(bestiary.entries) { entry in foeCard(entry) }
                }
                .padding(Theme.Space.lg)
            }
            .background(Theme.screenBackground)
            .refreshable { await load() }
        }
        .navigationTitle("Bestiary")
        .task { if state.value == nil { await load() } }
    }

    private func load() async {
        state = .loading
        do { state = .loaded(try await UserService.bestiary()) }
        catch { state = .failed(error.userMessage) }
    }

    @ViewBuilder private func foeCard(_ entry: BestiaryEntry) -> some View {
        if entry.revealed {
            Card {
                VStack(alignment: .leading, spacing: Theme.Space.sm) {
                    HStack {
                        Text(entry.name ?? "").font(.outfitHeadline)
                        Spacer(minLength: Theme.Space.sm)
                        if entry.active {
                            Text("Currently facing").font(.outfitCaption2).fontWeight(.bold)
                                .foregroundStyle(Theme.accent)
                        } else if entry.timesFelled > 1 {
                            Text("felled ×\(entry.timesFelled)").font(.outfitCaption2).foregroundStyle(.secondary)
                        }
                    }
                    if let motive = entry.motive, !motive.isEmpty {
                        Text(motive).font(.outfitCaption).italic().foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if entry.discovered {
                        if let beat = entry.defeatBeat, !beat.isEmpty {
                            Text(beat).font(.outfitCaption).foregroundStyle(.primary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        if let note = entry.worldNote, !note.isEmpty {
                            Text(note).font(.outfitCaption2).foregroundStyle(Theme.accent)
                        }
                    } else {
                        Text("You're facing this one now — fell it to complete its entry.")
                            .font(.outfitCaption2).foregroundStyle(.secondary)
                    }
                }
            }
        } else {
            Card {
                HStack(spacing: Theme.Space.md) {
                    Image(systemName: "questionmark.circle").font(.outfitTitle2).foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("? ? ?").font(.outfitSubheadlineBold).foregroundStyle(.secondary)
                        Text("Not yet encountered").font(.outfitCaption).foregroundStyle(.secondary)
                    }
                    Spacer()
                }
            }
        }
    }
}
