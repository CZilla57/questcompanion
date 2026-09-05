import SwiftUI

@MainActor
final class ReflectionViewModel: ObservableObject {
    @Published var state: Loadable<Reflection?> = .idle
    @Published var selectedChips: Set<String> = []
    @Published var freeText = ""
    @Published var busy = false
    @Published var awardedXp: Int?

    func load() async {
        state = .loading
        do {
            let response = try await ReflectionService.today()
            if let reflection = response.reflection {
                selectedChips = Set(reflection.chips)
                freeText = reflection.freeText ?? ""
            }
            state = .loaded(response.reflection)
        } catch { state = .failed(error.userMessage) }
    }

    func toggle(_ chip: String) {
        if selectedChips.contains(chip) { selectedChips.remove(chip) } else { selectedChips.insert(chip) }
    }

    func submit() async {
        busy = true; defer { busy = false }
        do {
            let response = try await ReflectionService.answer(
                chips: Array(selectedChips),
                freeText: freeText.isEmpty ? nil : freeText
            )
            awardedXp = response.xpAwarded
            state = .loaded(response.reflection)
        } catch {}
    }
}

struct ReflectionView: View {
    @StateObject private var model = ReflectionViewModel()

    var body: some View {
        AsyncContentView(state: model.state, retry: { Task { await model.load() } }) { reflection in
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.lg) {
                    Card {
                        VStack(alignment: .leading, spacing: Theme.Space.sm) {
                            Text("🌙 Evening reflection").font(.headline)
                            Text(reflection?.prompt ?? "How did today go?").font(.subheadline).foregroundStyle(.secondary)
                        }
                    }

                    chipGroup("What helped?", chips: ReflectionChip.helped)
                    chipGroup("What got in the way?", chips: ReflectionChip.hindered)

                    Card {
                        VStack(alignment: .leading, spacing: Theme.Space.sm) {
                            Text("Anything else? (optional)").font(.subheadline.bold())
                            TextField("A sentence for future you…", text: $model.freeText, axis: .vertical)
                                .lineLimit(2...5)
                                .textFieldStyle(.roundedBorder)
                        }
                    }

                    if let xp = model.awardedXp {
                        Text("Saved · +\(xp) XP").font(.subheadline).foregroundStyle(Theme.success)
                    }

                    PrimaryButton(title: reflection?.answeredAt == nil ? "Save reflection" : "Update", isLoading: model.busy) {
                        Task { await model.submit() }
                    }
                }
                .padding(Theme.Space.lg)
            }
            .background(Theme.screenBackground)
        }
        .navigationTitle("Reflection")
        .task { if model.state.value == nil { await model.load() } }
    }

    private func chipGroup(_ title: String, chips: [(key: String, label: String)]) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                Text(title).font(.subheadline.bold())
                FlowLayout(spacing: Theme.Space.sm) {
                    ForEach(chips, id: \.key) { chip in
                        SelectableChip(label: chip.label, isSelected: model.selectedChips.contains(chip.key)) {
                            model.toggle(chip.key)
                        }
                    }
                }
            }
        }
    }
}

/// Minimal wrapping flow layout for chips.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var rows: [[CGSize]] = [[]]
        var x: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x + size.width > maxWidth, !rows[rows.count - 1].isEmpty {
                rows.append([]); x = 0
            }
            rows[rows.count - 1].append(size); x += size.width + spacing
        }
        let height = rows.reduce(0) { $0 + (($1.map(\.height).max() ?? 0)) + spacing } - spacing
        return CGSize(width: maxWidth == .infinity ? x : maxWidth, height: max(0, height))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX, x > bounds.minX {
                x = bounds.minX; y += rowHeight + spacing; rowHeight = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
