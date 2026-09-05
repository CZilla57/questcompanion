import SwiftUI

@MainActor
final class HeroViewModel: ObservableObject {
    struct Bundle { let hero: HeroStatus; let avatar: AvatarProfile?; let kingdoms: KingdomsResponse? }
    @Published var state: Loadable<Bundle> = .idle

    func load() async {
        state = .loading
        do {
            async let hero = UserService.heroStatus()
            async let avatar = try? HeroService.avatar()
            async let kingdoms = try? UserService.kingdoms()
            let bundle = Bundle(hero: try await hero, avatar: await avatar, kingdoms: await kingdoms)
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
                    VStack(spacing: Theme.Space.lg) {
                        heroCard(bundle.hero, avatar: bundle.avatar)
                        companionCard(bundle.hero.companion)
                        if let avatar = bundle.avatar { avatarCard(avatar) }
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

    private func heroCard(_ hero: HeroStatus, avatar: AvatarProfile?) -> some View {
        Card {
            VStack(spacing: Theme.Space.md) {
                Text(hero.stageEmoji).font(.system(size: 64))
                Text(hero.mood).font(.headline).multilineTextAlignment(.center)
                Text(hero.activity.text).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                if let avatar {
                    HStack(spacing: Theme.Space.lg) {
                        Label("Level \(avatar.level)", systemImage: "star.fill")
                        Label("\(avatar.battlePower) power", systemImage: "bolt.fill")
                    }
                    .font(.caption).foregroundStyle(.secondary)
                }
                Text("Last fed \(DateUtils.relative(hero.lastFedAt))").font(.caption2).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
        }
    }

    private func companionCard(_ companion: HeroStatus.Companion) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                HStack {
                    Text("🐾 Companion").font(.subheadline.bold())
                    Spacer()
                    Text("\(companion.bondTierName) · Tier \(companion.bondTier)").font(.caption).foregroundStyle(.secondary)
                }
                if !companion.line.isEmpty {
                    Text("“\(companion.line)”").font(.callout).italic()
                }
                Text("\(companion.bondQuestsCompleted) quests together").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func avatarCard(_ avatar: AvatarProfile) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                SectionHeader("Loadout")
                HStack(spacing: Theme.Space.md) {
                    AvatarBadge(name: avatar.avatarClass, colorHex: avatar.avatarColor, size: 56)
                    VStack(alignment: .leading) {
                        Text(avatar.avatarClass.capitalized).font(.headline)
                        Text(avatar.avatarSkin.capitalized).font(.caption).foregroundStyle(.secondary)
                    }
                }
                if avatar.equippedGear.isEmpty {
                    Text("No gear equipped yet.").font(.caption).foregroundStyle(.secondary)
                } else {
                    ForEach(avatar.equippedGear) { gear in
                        HStack {
                            Text(gear.icon)
                            Text(gear.name).font(.subheadline)
                            Spacer()
                            Text("\(gear.slot.capitalized) · +\(gear.statPower)").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

    private func kingdomsCard(_ response: KingdomsResponse) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                SectionHeader("Life Kingdoms") {
                    if response.worldResting { Text("Resting 😴").font(.caption).foregroundStyle(.secondary) }
                }
                ForEach(response.kingdoms) { kingdom in
                    HStack {
                        Text(kingdom.name).font(.subheadline)
                        Spacer()
                        Text(kingdom.tierName).font(.caption).foregroundStyle(.secondary)
                        Text("\(kingdom.lifetimePoints) pts").font(.caption).foregroundStyle(Theme.accent)
                    }
                }
            }
        }
    }
}
