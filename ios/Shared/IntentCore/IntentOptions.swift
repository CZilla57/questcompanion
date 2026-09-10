import AppIntents

enum FocusPresetOption: String, AppEnum {
    case classic, deep, short
    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Focus Preset" }
    static var caseDisplayRepresentations: [FocusPresetOption: DisplayRepresentation] {
        [.classic: "Classic", .deep: "Deep Work", .short: "Short"]
    }
    var key: FocusPresetKey { FocusPresetKey(rawValue: rawValue) ?? .classic }
}

enum BrainModeOption: String, AppEnum {
    case focused, distracted, frozen, hyperfocus, neutral
    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Brain Mode" }
    static var caseDisplayRepresentations: [BrainModeOption: DisplayRepresentation] {
        [.focused: "Focused", .distracted: "Distracted", .frozen: "Frozen",
         .hyperfocus: "Hyperfocus", .neutral: "Neutral"]
    }
    var mode: BrainMode { BrainMode(rawValue: rawValue) ?? .neutral }
}
