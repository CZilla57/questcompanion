import Foundation

struct FocusPreset: Codable, Identifiable {
    var id: String { key.rawValue }
    let key: FocusPresetKey
    let label: String
    let focusMinutes: Int
    let breakMinutes: Int
    let longBreakMinutes: Int
    let longBreakEvery: Int
    let plannedCycles: Int
}

struct FocusSession: Codable, Identifiable, Equatable {
    let id: Int
    let userId: Int
    let taskId: Int?
    let preset: FocusPresetKey
    let focusMinutes: Int
    let breakMinutes: Int
    let longBreakMinutes: Int
    let longBreakEvery: Int
    let plannedCycles: Int
    let completedIntervals: Int
    let focusedSeconds: Int
    let xpAwarded: Int
    let status: String
    let startedAt: String
    let lastIntervalAt: String?
    let endedAt: String?
    let createdAt: String

    static func == (lhs: FocusSession, rhs: FocusSession) -> Bool {
        lhs.id == rhs.id && lhs.completedIntervals == rhs.completedIntervals && lhs.status == rhs.status
    }
}

struct FocusSessionCreated: Codable {
    // FocusSession fields (flattened via the same keys) plus initiationXp.
    let id: Int
    let userId: Int
    let taskId: Int?
    let preset: FocusPresetKey
    let focusMinutes: Int
    let breakMinutes: Int
    let longBreakMinutes: Int
    let longBreakEvery: Int
    let plannedCycles: Int
    let completedIntervals: Int
    let focusedSeconds: Int
    let xpAwarded: Int
    let status: String
    let startedAt: String
    let lastIntervalAt: String?
    let endedAt: String?
    let createdAt: String
    let initiationXp: InitiationXp

    var session: FocusSession {
        FocusSession(
            id: id, userId: userId, taskId: taskId, preset: preset, focusMinutes: focusMinutes,
            breakMinutes: breakMinutes, longBreakMinutes: longBreakMinutes, longBreakEvery: longBreakEvery,
            plannedCycles: plannedCycles, completedIntervals: completedIntervals, focusedSeconds: focusedSeconds,
            xpAwarded: xpAwarded, status: status, startedAt: startedAt, lastIntervalAt: lastIntervalAt,
            endedAt: endedAt, createdAt: createdAt
        )
    }
}

struct FocusSessionResult: Codable {
    let session: FocusSession
    let xpDelta: Int
}

struct StartFocusSessionInput: Encodable {
    let preset: FocusPresetKey
    let taskId: Int?
}

struct FocusIntervalInput: Encodable { let intervalIndex: Int }
struct FocusCompleteInput: Encodable { let partialSeconds: Int? }

// MARK: - Initiation XP (Celebrate Starting)

struct InitiationXp: Codable {
    let total: Int
    let awards: [InitiationAward]
}

struct InitiationAward: Codable, Identifiable {
    var id: String { kind }
    let kind: String
    let points: Int
}
