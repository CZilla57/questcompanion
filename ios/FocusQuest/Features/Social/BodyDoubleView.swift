import SwiftUI

// Enables `.navigationDestination(item:)`, which requires Hashable. Identity is
// the room id — enough to distinguish navigation targets.
extension BodyDoubleRoomState: Hashable {
    static func == (lhs: BodyDoubleRoomState, rhs: BodyDoubleRoomState) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

@MainActor
final class BodyDoubleViewModel: ObservableObject {
    @Published var state: Loadable<[BodyDoubleOpenRoom]> = .idle
    @Published var activeRoom: BodyDoubleRoomState?
    @Published var busy = false

    func load() async {
        state = .loading
        do { state = .loaded(try await SocialService.openRooms()) }
        catch { state = .failed(error.userMessage) }
    }

    func open() async {
        busy = true; defer { busy = false }
        do { activeRoom = try await SocialService.openRoom() } catch {}
    }

    func join(_ room: BodyDoubleOpenRoom) async {
        busy = true; defer { busy = false }
        do { activeRoom = try await SocialService.joinRoom(id: room.id) } catch {}
    }
}

struct BodyDoubleView: View {
    @StateObject private var model = BodyDoubleViewModel()

    var body: some View {
        AsyncContentView(state: model.state, retry: { Task { await model.load() } }) { rooms in
            NeonList {
                Section {
                    Text("Work alongside others in a shared focus room. Silent company, gentle accountability.")
                        .font(.outfitSubheadline).foregroundStyle(.secondary)
                    Button { Task { await model.open() } } label: {
                        Label("Open a room", systemImage: "plus.circle.fill")
                    }.disabled(model.busy)
                }
                Section("Open rooms") {
                    if rooms.isEmpty {
                        Text("No open rooms right now.").font(.outfitSubheadline).foregroundStyle(.secondary)
                    }
                    ForEach(rooms) { room in
                        HStack {
                            AvatarBadge(name: room.host.name, colorHex: room.host.avatarColor, size: 32)
                            VStack(alignment: .leading) {
                                Text("\(room.host.name)'s room").font(.outfitSubheadline)
                                Text("\(room.memberCount) here").font(.outfitCaption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button(room.amMember ? "Open" : "Join") { Task { await model.join(room) } }
                                .buttonStyle(.bordered)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .refreshable { await model.load() }
        }
        .navigationTitle("Body Double")
        .navigationDestination(item: $model.activeRoom) { room in BodyDoubleRoomView(roomId: room.id) }
        .task { if model.state.value == nil { await model.load() } }
    }
}

struct BodyDoubleRoomView: View {
    let roomId: Int
    @State private var state: Loadable<BodyDoubleRoomState> = .idle
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        AsyncContentView(state: state, retry: { Task { await load() } }) { room in
            NeonList {
                Section("In the room") {
                    ForEach(room.members) { member in
                        HStack {
                            AvatarBadge(name: member.name, colorHex: member.avatarColor, size: 32)
                            Text(member.name).font(.outfitSubheadline)
                            if member.isHost { Text("host").font(.outfitCaption2).foregroundStyle(.secondary) }
                            Spacer()
                            Text(member.presence == "headsDown" ? "🎧 heads down" : "👋 here")
                                .font(.outfitCaption).foregroundStyle(.secondary)
                        }
                    }
                }
                Section {
                    ForEach([15, 25, 50], id: \.self) { mins in
                        Button("Start \(mins)-minute sprint") { Task { await sprint(mins) } }
                    }
                    Button("Wave 👋") { Task { try? await SocialService.wave(roomId: roomId); await load() } }
                    Button("Leave room", role: .destructive) {
                        Task { try? await SocialService.leaveRoom(id: roomId); dismiss() }
                    }
                }
            }
            .navigationTitle("Focus Room")
        }
        .task { if state.value == nil { await load() } }
    }

    private func load() async {
        state = .loading
        do { state = .loaded(try await SocialService.room(id: roomId)) }
        catch { state = .failed(error.userMessage) }
    }

    private func sprint(_ minutes: Int) async {
        if let updated = try? await SocialService.startSprint(roomId: roomId, minutes: minutes) {
            state = .loaded(updated)
        }
    }
}
