import SwiftUI

/// Create a campaign: name the long goal, let the Dungeon Master draft a story
/// arc (AI, with a curated fallback), tweak the chapter titles, then begin.
/// Mirrors the web campaigns create dialog. The server enforces one running
/// campaign per user — a second one surfaces as a friendly error here.
struct CampaignCreateSheet: View {
    /// Called after a campaign is created so the caller can refresh.
    var onCreated: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var goal = ""
    @State private var premise: String?
    @State private var ending: String?
    @State private var source = "curated"
    @State private var chapters: [EditableChapter] = []
    @State private var drafting = false
    @State private var creating = false
    @State private var error: String?
    @FocusState private var goalFocused: Bool

    private struct EditableChapter: Identifiable {
        let id = UUID()
        var title: String
        var beat: String
    }

    private var hasUnnamedChapter: Bool { chapters.contains { $0.title.trimmingCharacters(in: .whitespaces).isEmpty } }
    private var canBegin: Bool {
        !goal.trimmingCharacters(in: .whitespaces).isEmpty && !hasUnnamedChapter && !creating
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("e.g. Make the garage usable again", text: $goal, axis: .vertical)
                        .focused($goalFocused)
                        .lineLimit(1...3)
                    Button {
                        Task { await draft() }
                    } label: {
                        Label(drafting ? "Drafting…" : (chapters.isEmpty ? "Draft the arc" : "Redraft the arc"),
                              systemImage: "sparkles")
                    }
                    .disabled(goal.trimmingCharacters(in: .whitespaces).isEmpty || drafting)
                } header: {
                    Text("The long goal")
                } footer: {
                    Text("The Dungeon Master turns your goal into a short story arc — 3–5 chapters you can rename.")
                }

                if let premise, !premise.isEmpty {
                    Section("The arc") {
                        Text(premise).font(.outfitCallout)
                        if let ending, !ending.isEmpty {
                            Text(ending).font(.outfitCaption).italic().foregroundStyle(.secondary)
                        }
                    }
                }

                if !chapters.isEmpty {
                    Section("Chapters") {
                        ForEach($chapters) { $chapter in
                            VStack(alignment: .leading, spacing: 4) {
                                TextField("Chapter title", text: $chapter.title)
                                    .font(.outfitSubheadlineBold)
                                if !chapter.beat.isEmpty {
                                    Text(chapter.beat).font(.outfitCaption).foregroundStyle(.secondary)
                                }
                            }
                        }
                        .onDelete { chapters.remove(atOffsets: $0) }
                    }
                }

                if let error {
                    Section { Text(error).foregroundStyle(Theme.danger).font(.outfitFootnote) }
                }
            }
            .navigationTitle("New Campaign")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Begin") { Task { await create() } }.disabled(!canBegin)
                }
            }
            .onAppear { goalFocused = true }
        }
    }

    private func draft() async {
        drafting = true
        error = nil
        defer { drafting = false }
        do {
            let arc = try await CampaignService.suggestArc(goal: goal.trimmingCharacters(in: .whitespaces))
            premise = arc.arcPremise
            ending = arc.endingBeat
            source = arc.source
            chapters = arc.chapters.map { EditableChapter(title: $0.title, beat: $0.beat) }
        } catch {
            self.error = "Couldn't draft an arc — you can still name chapters yourself, or begin with just the goal."
        }
    }

    private func create() async {
        creating = true
        error = nil
        defer { creating = false }
        let kept = chapters
            .map { EditableChapter(title: $0.title.trimmingCharacters(in: .whitespaces), beat: $0.beat) }
            .filter { !$0.title.isEmpty }
            .map { CampaignInput.Chapter(title: $0.title, beat: $0.beat.isEmpty ? nil : $0.beat, questTitles: nil) }
        let input = CampaignInput(
            title: goal.trimmingCharacters(in: .whitespaces),
            arcPremise: premise,
            endingBeat: ending,
            storySource: source,
            chapters: kept.isEmpty ? nil : kept)
        do {
            _ = try await CampaignService.create(input)
            onCreated()
            dismiss()
        } catch {
            self.error = error.userMessage
        }
    }
}
