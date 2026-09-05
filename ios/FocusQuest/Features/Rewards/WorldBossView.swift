import SwiftUI

@MainActor
final class WorldBossViewModel: ObservableObject {
    @Published var state: Loadable<WorldBossStatus> = .idle
    @Published var attackResult: WorldBossAttackResult?
    @Published var busy = false

    func load() async {
        state = .loading
        do { state = .loaded(try await HeroService.worldBoss()) }
        catch { state = .failed(error.userMessage) }
    }

    func attack() async {
        busy = true; defer { busy = false }
        attackResult = try? await HeroService.attackBoss()
        await load()
    }
}

struct WorldBossView: View {
    @StateObject private var model = WorldBossViewModel()

    var body: some View {
        AsyncContentView(state: model.state, retry: { Task { await model.load() } }) { boss in
            ScrollView {
                VStack(spacing: Theme.Space.lg) {
                    Card {
                        VStack(spacing: Theme.Space.md) {
                            Text(boss.defeated ? "💀" : "🐉").font(.system(size: 64))
                            Text(boss.defeated ? "Boss defeated!" : "World Boss").font(.title2.bold())
                            ProgressBar(value: boss.hp > 0 ? Double(boss.totalDamage) / Double(boss.totalDamage + boss.hp) : 1, tint: Theme.danger)
                            Text("HP \(boss.hp)").font(.caption).foregroundStyle(.secondary)
                            Text("Your damage: \(boss.yourContribution) · Power \(boss.yourPower)")
                                .font(.subheadline).foregroundStyle(.secondary)
                            if !boss.defeated {
                                PrimaryButton(title: boss.attackedToday ? "Attacked today ✓" : "Attack (+\(boss.attackXp) XP)",
                                              systemImage: "bolt.fill", tint: Theme.danger, isLoading: model.busy) {
                                    Task { await model.attack() }
                                }
                                .disabled(boss.attackedToday)
                            }
                        }
                        .frame(maxWidth: .infinity)
                    }

                    Card {
                        VStack(alignment: .leading, spacing: Theme.Space.sm) {
                            Text("Contributors").font(.headline)
                            ForEach(boss.contributors) { c in
                                HStack {
                                    Circle().fill(Color(hex: c.avatarColor)).frame(width: 10, height: 10)
                                    Text(c.displayName).font(.subheadline)
                                    if c.isAlly { Text("ally").font(.caption2).foregroundStyle(Theme.accent) }
                                    Spacer()
                                    Text("\(c.damage)").font(.caption).foregroundStyle(.secondary)
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
        .navigationTitle("World Boss")
        .alert("Attack!", isPresented: .constant(model.attackResult != nil)) {
            Button("OK") { model.attackResult = nil }
        } message: {
            if let r = model.attackResult {
                Text(r.attacked ? "You dealt \(r.damage ?? 0) damage! +\(r.xpAwarded) XP" + (r.justDefeated ? " — boss defeated! +\(r.coinsAwarded) coins" : "") : "No attack landed.")
            }
        }
        .task { if model.state.value == nil { await model.load() } }
    }
}
