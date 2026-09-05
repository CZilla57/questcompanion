import SwiftUI

@MainActor
final class QuestlinesViewModel: ObservableObject {
    @Published var state: Loadable<[Questline]> = .idle
    @Published var showCreate = false

    func load() async {
        state = .loading
        do { state = .loaded(try await QuestlineService.list()) }
        catch { state = .failed(error.userMessage) }
    }
}

struct QuestlinesView: View {
    @StateObject private var model = QuestlinesViewModel()

    var body: some View {
        AsyncContentView(state: model.state, retry: { Task { await model.load() } }) { lines in
            List {
                if lines.isEmpty {
                    EmptyStateView(symbol: "list.bullet.rectangle", title: "No questlines", message: "Group related quests toward a goal.")
                }
                ForEach(lines) { line in
                    NavigationLink { QuestlineDetailView(questlineId: line.id) } label: {
                        QuestlineRow(line: line)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .refreshable { await model.load() }
        }
        .navigationTitle("Questlines")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { model.showCreate = true } label: { Image(systemName: "plus") }
            }
        }
        .sheet(isPresented: $model.showCreate) {
            CreateQuestlineSheet { Task { await model.load() } }
        }
        .task { if model.state.value == nil { await model.load() } }
    }
}

struct QuestlineRow: View {
    let line: Questline
    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.sm) {
            HStack {
                Circle().fill(Color(hex: line.color)).frame(width: 10, height: 10)
                Text(line.title).font(.headline)
                Spacer()
                if line.ready { Text("Ready 🎁").font(.caption.bold()).foregroundStyle(Theme.gold) }
            }
            ProgressBar(value: line.progress, tint: Color(hex: line.color))
            Text("\(line.done)/\(line.total) quests").font(.caption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

struct QuestlineDetailView: View {
    let questlineId: Int
    @State private var state: Loadable<QuestlineDetail> = .idle
    @State private var showQuickAdd = false
    @State private var claiming = false

    var body: some View {
        AsyncContentView(state: state, retry: { Task { await load() } }) { detail in
            List {
                Section {
                    if let desc = detail.questline.description, !desc.isEmpty {
                        Text(desc).font(.subheadline).foregroundStyle(.secondary)
                    }
                    ProgressBar(value: detail.questline.progress, tint: Color(hex: detail.questline.color))
                    Text("\(detail.questline.done)/\(detail.questline.total) complete").font(.caption).foregroundStyle(.secondary)
                    if detail.questline.ready {
                        PrimaryButton(title: "Claim reward", systemImage: "gift.fill", tint: Theme.gold, isLoading: claiming) {
                            Task { await claim() }
                        }
                    }
                }
                Section("Quests") {
                    ForEach(detail.quests) { quest in
                        QuestRow(quest: quest) { Task { await toggle(quest) } }
                    }
                }
            }
            .navigationTitle(detail.questline.title)
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { showQuickAdd = true } label: { Image(systemName: "plus") }
            }
        }
        .sheet(isPresented: $showQuickAdd) {
            QuickAddSheet(onCreated: { _ in Task { await load() } }, questlineId: questlineId)
        }
        .task { if state.value == nil { await load() } }
    }

    private func load() async {
        state = .loading
        do { state = .loaded(try await QuestlineService.detail(id: questlineId)) }
        catch { state = .failed(error.userMessage) }
    }

    private func toggle(_ quest: Quest) async {
        do {
            if quest.completed { _ = try await QuestService.uncomplete(id: quest.id) }
            else { _ = try await QuestService.complete(id: quest.id) }
        } catch {}
        await load()
    }

    private func claim() async {
        claiming = true
        defer { claiming = false }
        _ = try? await QuestlineService.claim(id: questlineId)
        await load()
    }
}

struct CreateQuestlineSheet: View {
    var onCreated: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var description = ""
    @State private var isWorking = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section { TextField("Title", text: $title) }
                Section { TextField("Description (optional)", text: $description, axis: .vertical).lineLimit(1...4) }
                if let error { Text(error).foregroundStyle(Theme.danger).font(.footnote) }
            }
            .navigationTitle("New Questline")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") { Task { await create() } }
                        .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || isWorking)
                }
            }
        }
    }

    private func create() async {
        isWorking = true
        defer { isWorking = false }
        do {
            _ = try await QuestlineService.create(QuestlineInput(
                title: title,
                description: description.isEmpty ? nil : description,
                color: nil,
                questTitles: nil
            ))
            onCreated()
            dismiss()
        } catch { self.error = error.userMessage }
    }
}
