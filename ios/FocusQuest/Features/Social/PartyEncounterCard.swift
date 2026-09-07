import SwiftUI

@MainActor
final class PartyEncounterViewModel: ObservableObject {
    @Published var parties: [PartyEncounter] = []

    func load() async {
        parties = (try? await PartyService.encounters()) ?? []
    }
}

/// The Campaign — Phase 2 (Party): the co-op reframe of the personal encounter.
/// A party (an accepted partnership) fights ONE shared foe whose single HP bar is
/// chipped by either ally's quest completions. Contributions render as additive
/// teamwork — never a ranking, never a "behind" state; an unfelled foe rests.
///
/// Renders nothing when the viewer has no party, so it composes with the
/// campaigns gate at the mount site.
struct PartyEncounterCard: View {
    @StateObject private var model = PartyEncounterViewModel()

    var body: some View {
        // A VStack (not a Group) hosts the .task: when `parties` is empty the
        // Group renders zero child views and the load never fires — the VStack
        // always exists, so the fetch runs and the cards appear once it lands.
        VStack(spacing: Theme.Space.md) {
            ForEach(model.parties) { party in
                partyCard(party)
            }
        }
        .task { await model.load() }
    }

    private func partyCard(_ party: PartyEncounter) -> some View {
        let enc = party.encounter
        let pct = Int((enc.percentRemaining * 100).rounded())
        return Card {
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                HStack(spacing: Theme.Space.sm) {
                    ZStack {
                        Circle().fill(Theme.accent.opacity(0.15)).frame(width: 40, height: 40)
                        Image(systemName: "person.2.fill").foregroundStyle(Theme.accent)
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        Text(party.foeName).font(.outfitHeadline)
                        Text("Party encounter \(party.tier) · \(enc.phaseLabel)")
                            .font(.outfitCaption).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                }

                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text("\(pct)% HP").font(.outfitCaption).foregroundStyle(.secondary)
                        Spacer()
                        Text("\(enc.hpRemaining) / \(enc.hp)").font(.outfitCaptionBold)
                    }
                    ProgressBar(value: enc.percentRemaining, tint: enc.hpBarColor)
                }

                // Both allies' damage, side by side — teamwork, not a leaderboard.
                HStack(spacing: Theme.Space.sm) {
                    ForEach(party.members) { member in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(member.displayName).font(.outfitSubheadlineBold).lineLimit(1)
                            Text("\(member.damage) struck").font(.outfitCaption2).foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(Theme.Space.sm)
                        .background(Theme.accentSoft)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous))
                    }
                }

                Text("Every quest either of you finishes strikes together.")
                    .font(.outfitCaption2).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "\(party.foeName), party encounter \(party.tier), \(enc.phaseLabel), \(pct) percent HP. "
            + party.members.map { "\($0.displayName) struck \($0.damage)" }.joined(separator: ", "))
    }
}
