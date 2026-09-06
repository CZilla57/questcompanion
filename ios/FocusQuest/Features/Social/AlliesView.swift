import SwiftUI

enum AllyTab: String, CaseIterable, Identifiable {
    case allies = "Allies", requests = "Requests", find = "Find", inbox = "Inbox"
    var id: String { rawValue }
}

@MainActor
final class AlliesViewModel: ObservableObject {
    @Published var state: Loadable<[Partnership]> = .idle
    @Published var inbox: [Nudge] = []
    @Published var myId: Int?
    @Published var searchQuery = ""
    @Published var searchResults: [UserSummary] = []
    @Published var searching = false

    func load() async {
        state = .loading
        async let me = try? UserService.me()
        async let partners = SocialService.partners()
        async let nudges = try? SocialService.inbox()
        myId = (await me)?.id
        do {
            state = .loaded(try await partners)
            inbox = await nudges ?? []
        } catch { state = .failed(error.userMessage) }
    }

    /// Existing tie (accepted/pending) keyed by the other user's id, so search
    /// results reflect the relationship instead of offering a duplicate add.
    var relationshipByUserId: [Int: String] {
        var map: [Int: String] = [:]
        for p in state.value ?? [] where p.status != "declined" {
            if let partner = p.partner { map[partner.id] = p.status }
        }
        return map
    }

    func accept(_ p: Partnership) async { _ = try? await SocialService.acceptPartner(id: p.id); await load() }
    func decline(_ p: Partnership) async { try? await SocialService.declinePartner(id: p.id); await load() }
    func nudge(_ p: Partnership, kind: String, reaction: String) async {
        _ = try? await SocialService.nudge(partnerId: p.id, kind: kind, reaction: reaction)
        await load()
    }
    func send(_ id: Int) async { _ = try? await SocialService.requestPartner(recipientId: id); await load() }

    func runSearch() async {
        let q = searchQuery.trimmingCharacters(in: .whitespaces)
        guard q.count > 2 else { searchResults = []; return }
        searching = true
        searchResults = (try? await SocialService.searchUsers(q: q)) ?? []
        searching = false
    }

    func markInboxRead() async {
        let unread = inbox.filter { $0.readAt == nil }.map(\.id)
        guard !unread.isEmpty else { return }
        try? await SocialService.markNudgesRead(ids: unread)
    }
}

struct AlliesView: View {
    @StateObject private var model = AlliesViewModel()
    @State private var tab: AllyTab = .allies

    private func partners() -> [Partnership] { model.state.value ?? [] }
    private var active: [Partnership] { partners().filter { $0.status == "accepted" } }
    private var pendingIncoming: [Partnership] {
        partners().filter { $0.status == "pending" && $0.recipientId == model.myId }
    }
    private var unread: Int { model.inbox.filter { $0.readAt == nil }.count }

    var body: some View {
        VStack(spacing: 0) {
            NeonTabs(items: AllyTab.allCases, selection: $tab) { tabTitle($0) }
                .padding(.horizontal, Theme.Space.md)
                .padding(.vertical, Theme.Space.sm)

            AsyncContentView(state: model.state, retry: { Task { await model.load() } }) { _ in
                ScrollView {
                    VStack(alignment: .leading, spacing: Theme.Space.md) {
                        switch tab {
                        case .allies: alliesTab
                        case .requests: requestsTab
                        case .find: findTab
                        case .inbox: inboxTab
                        }
                    }
                    .padding(Theme.Space.lg)
                }
                .refreshable { await model.load() }
            }
        }
        .background(Theme.screenBackground)
        .navigationTitle("Allies")
        .task { if model.state.value == nil { await model.load() } }
        .onChange(of: tab) { _, newValue in
            if newValue == .inbox { Task { await model.markInboxRead() } }
        }
    }

    private func tabTitle(_ t: AllyTab) -> String {
        switch t {
        case .allies: return active.isEmpty ? "Allies" : "Allies (\(active.count))"
        case .requests: return pendingIncoming.isEmpty ? "Requests" : "Requests (\(pendingIncoming.count))"
        case .find: return "Find"
        case .inbox: return unread > 0 ? "Inbox (\(unread))" : "Inbox"
        }
    }

    // MARK: - My Allies

    @ViewBuilder private var alliesTab: some View {
        if active.isEmpty {
            Card { EmptyStateView(symbol: "person.2", title: "No active allies", message: "Find friends to hold you accountable.") }
        } else {
            ForEach(active) { p in allyCard(p) }
        }
    }

    private func allyCard(_ p: Partnership) -> some View {
        Card {
            VStack(spacing: Theme.Space.md) {
                NavigationLink { AllyDetailView(partnershipId: p.id, name: p.partner?.name ?? "Ally") } label: {
                    HStack(spacing: Theme.Space.md) {
                        AvatarBadge(name: p.partner?.name ?? "?", colorHex: p.partner?.avatarColor, size: 44)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(p.partner?.name ?? "Ally").font(.outfitHeadline)
                            if let level = p.partner?.levelName {
                                Text(level).font(.outfitCaption).foregroundStyle(Theme.accent)
                            }
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right").font(.outfitCaption2).foregroundStyle(.secondary)
                    }
                }
                .buttonStyle(.plain)

                Divider().overlay(Theme.cardBorder)

                HStack {
                    allyStat("\(p.partner?.totalPoints ?? 0)", "XP")
                    Spacer()
                    allyStat("\(p.partner?.streakDays ?? 0)", "Streak")
                    if let prog = p.progress {
                        Spacer()
                        allyStat("\(prog.questsCompletedToday)/\(prog.questsDueToday)", "Today")
                    }
                }

                HStack(spacing: Theme.Space.md) {
                    nudgeButton(p, kind: "poke", reaction: "you_got_this", label: "Poke",
                                icon: "hand.point.right.fill", sent: p.sentTodayPoke ?? false)
                    nudgeButton(p, kind: "cheer", reaction: "nice_work", label: "Cheer",
                                icon: "hands.clap.fill", sent: p.sentTodayCheer ?? false)
                }
            }
        }
    }

    private func allyStat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 1) {
            Text(value).font(.outfitSubheadlineBold)
            Text(label).font(.outfitCaption2).foregroundStyle(.secondary)
        }
    }

    private func nudgeButton(_ p: Partnership, kind: String, reaction: String, label: String, icon: String, sent: Bool) -> some View {
        Button { Task { await model.nudge(p, kind: kind, reaction: reaction) } } label: {
            Label(sent ? "Sent" : label, systemImage: icon)
                .font(.outfitCaption).labelStyle(TealIconLabelStyle(spacing: 4))
                .frame(maxWidth: .infinity).padding(.vertical, 6)
        }
        .buttonStyle(.bordered).tint(Theme.accent)
        .disabled(sent)
    }

    // MARK: - Requests

    @ViewBuilder private var requestsTab: some View {
        if pendingIncoming.isEmpty {
            Card { EmptyStateView(symbol: "tray", title: "No pending requests", message: nil) }
        } else {
            ForEach(pendingIncoming) { p in
                Card {
                    HStack(spacing: Theme.Space.md) {
                        AvatarBadge(name: p.partner?.name ?? "?", colorHex: p.partner?.avatarColor, size: 40)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(p.partner?.name ?? "Someone").font(.outfitSubheadlineBold)
                            if let lvl = p.partner?.currentLevel {
                                Text("Lv. \(lvl)\(p.partner?.levelName.map { " · \($0)" } ?? "")")
                                    .font(.outfitCaption).foregroundStyle(.secondary)
                            }
                        }
                        Spacer(minLength: 0)
                        Button { Task { await model.decline(p) } } label: {
                            Image(systemName: "xmark").foregroundStyle(.secondary)
                        }.buttonStyle(.bordered)
                        Button { Task { await model.accept(p) } } label: {
                            Image(systemName: "checkmark")
                        }.buttonStyle(.borderedProminent).tint(Theme.accent)
                    }
                }
            }
        }
    }

    // MARK: - Find Allies

    @ViewBuilder private var findTab: some View {
        HStack(spacing: Theme.Space.sm) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField("Search by username…", text: $model.searchQuery)
                .textFieldStyle(.plain).autocorrectionDisabled()
                .textInputAutocapitalization(.never)
        }
        .padding(Theme.Space.md)
        .background(Theme.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous).strokeBorder(Theme.cardBorder, lineWidth: 1))
        .task(id: model.searchQuery) {
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard !Task.isCancelled else { return }
            await model.runSearch()
        }

        if model.searching {
            Text("Scanning network…").font(.outfitSubheadline).foregroundStyle(Theme.accent)
                .frame(maxWidth: .infinity)
        } else if !model.searchResults.isEmpty {
            ForEach(model.searchResults) { u in searchRow(u) }
        } else if model.searchQuery.trimmingCharacters(in: .whitespaces).count > 2 {
            Text("No users found matching \"\(model.searchQuery)\"")
                .font(.outfitSubheadline).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
        }
    }

    private func searchRow(_ u: UserSummary) -> some View {
        let relationship = model.relationshipByUserId[u.id]
        return Card {
            HStack(spacing: Theme.Space.md) {
                AvatarBadge(name: u.name, colorHex: u.avatarColor, size: 40)
                VStack(alignment: .leading, spacing: 1) {
                    Text(u.name).font(.outfitSubheadlineBold)
                    Text("Lv. \(u.currentLevel) · \(u.totalPoints) XP").font(.outfitCaption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                switch relationship {
                case "accepted":
                    Label("Allies", systemImage: "checkmark").font(.outfitCaption)
                        .labelStyle(TealIconLabelStyle(spacing: 4)).foregroundStyle(.secondary)
                case "pending":
                    Label("Pending", systemImage: "checkmark").font(.outfitCaption)
                        .labelStyle(TealIconLabelStyle(spacing: 4)).foregroundStyle(.secondary)
                default:
                    Button { Task { await model.send(u.id) } } label: {
                        Label("Add", systemImage: "person.badge.plus").font(.outfitCaption)
                            .labelStyle(TealIconLabelStyle(spacing: 4))
                    }.buttonStyle(.bordered).tint(Theme.accent)
                }
            }
        }
    }

    // MARK: - Inbox

    @ViewBuilder private var inboxTab: some View {
        if model.inbox.isEmpty {
            Card { EmptyStateView(symbol: "bell", title: "No nudges yet", message: "Your allies' pokes and cheers will show up here.") }
        } else {
            ForEach(model.inbox) { nudge in
                Card {
                    HStack(spacing: Theme.Space.md) {
                        Image(systemName: nudge.kind == "cheer" ? "hands.clap.fill" : "hand.point.right.fill")
                            .foregroundStyle(Theme.accent)
                        VStack(alignment: .leading, spacing: 1) {
                            Text("\(nudge.sender?.name ?? "An ally") \(nudge.kind == "poke" ? "poked you" : "cheered you")")
                                .font(.outfitSubheadline)
                            Text(nudge.reactionLabel ?? nudge.reaction).font(.outfitCaption).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                        Text(DateUtils.relative(nudge.createdAt)).font(.outfitCaption2).foregroundStyle(.secondary)
                    }
                }
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
