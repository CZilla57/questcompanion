import SwiftUI

@MainActor
final class AlliesViewModel: ObservableObject {
    @Published var state: Loadable<[Partnership]> = .idle
    @Published var inbox: [Nudge] = []

    func load() async {
        state = .loading
        do {
            async let partners = SocialService.partners()
            async let nudges = try? SocialService.inbox()
            state = .loaded(try await partners)
            inbox = await nudges ?? []
        } catch { state = .failed(error.userMessage) }
    }

    func accept(_ p: Partnership) async { _ = try? await SocialService.acceptPartner(id: p.id); await load() }
    func decline(_ p: Partnership) async { try? await SocialService.declinePartner(id: p.id); await load() }
    func nudge(_ p: Partnership, kind: String, reaction: String) async {
        _ = try? await SocialService.nudge(partnerId: p.id, kind: kind, reaction: reaction)
        await load()
    }
}

struct AlliesView: View {
    @StateObject private var model = AlliesViewModel()

    var body: some View {
        AsyncContentView(state: model.state, retry: { Task { await model.load() } }) { partners in
            NeonList {
                if !model.inbox.isEmpty {
                    Section("Recent nudges") {
                        ForEach(model.inbox) { nudge in
                            HStack {
                                Text(nudge.kind == "cheer" ? "🎉" : "👉")
                                VStack(alignment: .leading) {
                                    Text(nudge.sender?.name ?? "Ally").font(.outfitSubheadline)
                                    Text(nudge.reactionLabel ?? nudge.reaction).font(.outfitCaption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text(DateUtils.relative(nudge.createdAt)).font(.outfitCaption2).foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                let pending = partners.filter { $0.status == "pending" }
                if !pending.isEmpty {
                    Section("Requests") {
                        ForEach(pending) { p in
                            HStack {
                                Text(p.partner?.name ?? "Someone").font(.outfitSubheadline)
                                Spacer()
                                Button("Accept") { Task { await model.accept(p) } }.buttonStyle(.borderedProminent).tint(Theme.success)
                                Button("Decline") { Task { await model.decline(p) } }.buttonStyle(.bordered)
                            }
                        }
                    }
                }

                Section("Allies") {
                    let active = partners.filter { $0.status == "accepted" }
                    if active.isEmpty {
                        EmptyStateView(symbol: "person.2", title: "No allies yet", message: "Accountability partners keep each other moving.")
                    }
                    ForEach(active) { p in
                        NavigationLink { AllyDetailView(partnershipId: p.id, name: p.partner?.name ?? "Ally") } label: {
                            AllyRow(p: p) { kind, reaction in Task { await model.nudge(p, kind: kind, reaction: reaction) } }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .refreshable { await model.load() }
        }
        .navigationTitle("Allies")
        .task { if model.state.value == nil { await model.load() } }
    }
}

private struct AllyRow: View {
    let p: Partnership
    let onNudge: (String, String) -> Void
    var body: some View {
        HStack {
            AvatarBadge(name: p.partner?.name ?? "?", colorHex: p.partner?.avatarColor, size: 36)
            VStack(alignment: .leading) {
                Text(p.partner?.name ?? "Ally").font(.outfitSubheadline)
                if let prog = p.progress {
                    Text("\(prog.questsCompletedToday)/\(prog.questsDueToday) today" + (prog.allDoneToday ? " ✅" : ""))
                        .font(.outfitCaption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            if !(p.sentTodayCheer ?? false) {
                Button { onNudge("cheer", "nice_work") } label: { Text("🎉") }.buttonStyle(.plain)
            }
            if !(p.sentTodayPoke ?? false) {
                Button { onNudge("poke", "you_got_this") } label: { Text("👉") }.buttonStyle(.plain)
            }
        }
    }
}

struct AllyDetailView: View {
    let partnershipId: Int
    let name: String
    @State private var state: Loadable<AllyDetail> = .idle

    var body: some View {
        AsyncContentView(state: state, retry: { Task { await load() } }) { detail in
            NeonList {
                Section {
                    HStack {
                        AvatarBadge(name: detail.partner.name, colorHex: detail.partner.avatarColor, size: 48)
                        VStack(alignment: .leading) {
                            Text(detail.partner.name).font(.outfitHeadline)
                            Text("Level \(detail.partner.currentLevel)").font(.outfitCaption).foregroundStyle(.secondary)
                        }
                    }
                    Text("\(detail.progress.questsCompletedToday)/\(detail.progress.questsDueToday) quests today")
                        .font(.outfitSubheadline)
                }
                if !detail.badges.isEmpty {
                    Section("Badges") {
                        ForEach(detail.badges) { ub in
                            Label(ub.badge.name, systemImage: "rosette")
                        }
                    }
                }
                if !detail.milestones.isEmpty {
                    Section("Milestones") {
                        ForEach(detail.milestones) { item in
                            VStack(alignment: .leading) {
                                Text(item.description).font(.outfitSubheadline)
                                Text(DateUtils.relative(item.createdAt)).font(.outfitCaption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle(detail.partner.name)
        }
        .navigationTitle(name)
        .task { if state.value == nil { await load() } }
    }

    private func load() async {
        state = .loading
        do { state = .loaded(try await SocialService.allyDetail(id: partnershipId)) }
        catch { state = .failed(error.userMessage) }
    }
}
