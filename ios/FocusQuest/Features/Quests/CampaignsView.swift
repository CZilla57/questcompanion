import SwiftUI

@MainActor
final class CampaignsViewModel: ObservableObject {
    @Published var state: Loadable<[Campaign]> = .idle
    func load() async {
        state = .loading
        do { state = .loaded(try await CampaignService.list()) }
        catch { state = .failed(error.userMessage) }
    }
}

struct CampaignsView: View {
    @StateObject private var model = CampaignsViewModel()
    @State private var showCreate = false

    var body: some View {
        AsyncContentView(state: model.state, retry: { Task { await model.load() } }) { campaigns in
            NeonList {
                // Exactly one campaign runs at a time (server-enforced), so the
                // start button only appears when none is currently running.
                if !campaigns.contains(where: { $0.status == "running" }) {
                    Button { showCreate = true } label: {
                        Label("New campaign", systemImage: "plus.circle.fill")
                            .font(.outfitHeadline).foregroundStyle(Theme.accent)
                    }
                }
                if campaigns.isEmpty {
                    EmptyStateView(symbol: "books.vertical", title: "No campaigns", message: "Campaigns tell a longer story across several questlines.")
                }
                ForEach(campaigns) { campaign in
                    NavigationLink {
                        CampaignDetailView(campaignId: campaign.id) { Task { await model.load() } }
                    } label: {
                        campaignRow(campaign)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .refreshable { await model.load() }
        }
        .navigationTitle("Campaigns")
        .sheet(isPresented: $showCreate) {
            CampaignCreateSheet { Task { await model.load() } }
        }
        .task { if model.state.value == nil { await model.load() } }
    }

    private func campaignRow(_ campaign: Campaign) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.sm) {
            HStack {
                Text(campaign.title).font(.outfitHeadline)
                Spacer()
                Text(campaign.status.capitalized).font(.outfitCaption).foregroundStyle(.secondary)
            }
            if let premise = campaign.arcPremise, !premise.isEmpty {
                Text(premise).font(.outfitCaption).foregroundStyle(.secondary).lineLimit(2)
            }
            ProgressBar(value: campaign.progress)
            Text("\(campaign.done)/\(campaign.total) chapters").font(.outfitCaption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

struct CampaignDetailView: View {
    let campaignId: Int
    /// Let the list refresh after a status change or delete.
    var onChanged: () -> Void = {}
    @Environment(\.dismiss) private var dismiss
    @State private var state: Loadable<CampaignDetail> = .idle
    @State private var claiming = false
    @State private var showDeleteConfirm = false

    var body: some View {
        AsyncContentView(state: state, retry: { Task { await load() } }) { detail in
            NeonList {
                Section {
                    if detail.campaign.status == "set_aside" {
                        Label("Set aside. The story waited for you — pick it back up whenever you want.",
                              systemImage: "moon.zzz.fill")
                            .font(.outfitCaption).foregroundStyle(.secondary)
                    }
                    if let premise = detail.campaign.arcPremise, !premise.isEmpty {
                        Text(premise).font(.outfitSubheadline)
                    }
                    ProgressBar(value: detail.campaign.progress)
                    Text("\(detail.campaign.done)/\(detail.campaign.total) chapters").font(.outfitCaption).foregroundStyle(.secondary)
                    if detail.campaign.ready {
                        PrimaryButton(title: "Claim ending", systemImage: "flag.checkered", tint: Theme.gold, isLoading: claiming) {
                            Task { await claim() }
                        }
                    }
                }
                Section("Chapters") {
                    ForEach(Array(detail.chapters.enumerated()), id: \.element.id) { index, chapter in
                        chapterRow(index: index, chapter: chapter)
                    }
                }
            }
            .navigationTitle(detail.campaign.title)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        if detail.campaign.status == "running" {
                            Button { Task { await setStatus("set_aside") } } label: {
                                Label("Set aside", systemImage: "moon.zzz")
                            }
                        } else if detail.campaign.status == "set_aside" {
                            Button { Task { await setStatus("running") } } label: {
                                Label("Pick back up", systemImage: "play.circle")
                            }
                        }
                        Button(role: .destructive) { showDeleteConfirm = true } label: {
                            Label("Delete campaign", systemImage: "trash")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .confirmationDialog("Delete this campaign?", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
                Button("Delete", role: .destructive) { Task { await deleteCampaign() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("The chapters stay as questlines — only the campaign is removed.")
            }
        }
        .task { if state.value == nil { await load() } }
    }

    private func chapterRow(index: Int, chapter: CampaignChapter) -> some View {
        let done = chapter.status == "completed"
        return HStack {
            Image(systemName: done ? "checkmark.seal.fill" : "\(index + 1).circle")
                .foregroundStyle(done ? Theme.success : .secondary)
            VStack(alignment: .leading) {
                Text(chapter.title).font(.outfitSubheadline)
                if let beat = chapter.chapterBeat, !beat.isEmpty {
                    Text(beat).font(.outfitCaption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            Text("\(chapter.done)/\(chapter.total)").font(.outfitCaption).foregroundStyle(.secondary)
        }
    }

    private func load() async {
        state = .loading
        do { state = .loaded(try await CampaignService.detail(id: campaignId)) }
        catch { state = .failed(error.userMessage) }
    }

    private func claim() async {
        claiming = true
        defer { claiming = false }
        _ = try? await CampaignService.claim(id: campaignId)
        await load()
    }

    private func setStatus(_ status: String) async {
        _ = try? await CampaignService.update(id: campaignId, CampaignUpdate(status: status))
        await load()
        onChanged()
    }

    private func deleteCampaign() async {
        do {
            try await CampaignService.delete(id: campaignId)
            onChanged()
            dismiss()
        } catch {
            state = .failed(error.userMessage)
        }
    }
}
