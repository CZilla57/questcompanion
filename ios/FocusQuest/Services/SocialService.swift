import Foundation

enum SocialService {
    static func partners() async throws -> [Partnership] {
        try await APIClient.shared.get("accountability/partners")
    }

    static func requestPartner(recipientId: Int) async throws -> Partnership {
        try await APIClient.shared.post("accountability/partners", body: PartnerRequestInput(recipientId: recipientId))
    }

    static func acceptPartner(id: Int) async throws -> Partnership {
        try await APIClient.shared.post("accountability/partners/\(id)/accept")
    }

    static func declinePartner(id: Int) async throws {
        try await APIClient.shared.send("accountability/partners/\(id)/decline", method: .post)
    }

    static func allyDetail(id: Int) async throws -> AllyDetail {
        try await APIClient.shared.get("accountability/partners/\(id)/detail")
    }

    static func nudge(partnerId: Int, kind: String, reaction: String, contextType: String? = nil) async throws -> SentNudge {
        try await APIClient.shared.post(
            "accountability/partners/\(partnerId)/nudge",
            body: NudgeInput(kind: kind, reaction: reaction, contextType: contextType)
        )
    }

    static func inbox() async throws -> [Nudge] {
        try await APIClient.shared.get("accountability/nudges")
    }

    static func markNudgesRead(ids: [Int]) async throws {
        let _: Empty = try await APIClient.shared.request(
            "accountability/nudges/read", method: .post, body: MarkNudgesReadInput(ids: ids)
        )
    }

    // MARK: - Body double

    static func openRooms() async throws -> [BodyDoubleOpenRoom] {
        try await APIClient.shared.get("body-double/rooms")
    }

    static func openRoom() async throws -> BodyDoubleRoomState {
        try await APIClient.shared.post("body-double/rooms/open")
    }

    static func room(id: Int) async throws -> BodyDoubleRoomState {
        try await APIClient.shared.get("body-double/rooms/\(id)")
    }

    static func joinRoom(id: Int) async throws -> BodyDoubleRoomState {
        try await APIClient.shared.post("body-double/rooms/\(id)/join")
    }

    static func leaveRoom(id: Int) async throws {
        try await APIClient.shared.send("body-double/rooms/\(id)/leave", method: .post)
    }

    static func wave(roomId: Int) async throws {
        try await APIClient.shared.send("body-double/rooms/\(roomId)/wave", method: .post)
    }

    static func startSprint(roomId: Int, minutes: Int) async throws -> BodyDoubleRoomState {
        try await APIClient.shared.post(
            "body-double/rooms/\(roomId)/sprints", body: BodyDoubleSprintInput(minutes: minutes)
        )
    }
}
