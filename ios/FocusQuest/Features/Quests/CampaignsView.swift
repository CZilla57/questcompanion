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

    var body: some View {
        AsyncContentView(state: model.state, retry: { Task { await model.load() } }) { campaigns in
            NeonList {
                if campaigns.isEmpty {
                    EmptyStateView(symbol: "books.vertical", title: "No campaigns", message: "Campaigns tell a longer story across several questlines.")
                }
                ForEach(campaigns) { campaign in
                    NavigationLink { CampaignDetailView(campaignId: campaign.id) } label: {
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
            }
            .listStyle(.insetGrouped)
            .refreshable { await model.load() }
        }
        .navigationTitle("Campaigns")
        .task { if model.state.value == nil { await model.load() } }
    }
}

struct CampaignDetailView: View {
    let campaignId: Int
    @State private var state: Loadable<CampaignDetail> = .idle
    @State private var claiming = false

    var body: some View {
        AsyncContentView(state: state, retry: { Task { await load() } }) { detail in
            NeonList {
                Section {
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
                        HStack {
                            Image(systemName: chapter.status == "completed" ? "checkmark.seal.fill" : "\(index + 1).circle")
                                .foregroundStyle(chapter.status == "completed" ? Theme.success : .secondary)
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
                }
            }
            .navigationTitle(detail.campaign.title)
        }
        .task { if state.value == nil { await load() } }
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
}
