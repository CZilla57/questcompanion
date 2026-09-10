# iOS Siri & Widget Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this repo, delivery is sharded across Sidequest executors — each Task below maps to one ticket, dispatched in phase order.

**Goal:** Expand the iOS app's Siri (App Intents) and widget capabilities into background voice actions, interactive widget buttons, and new widget surfaces.

**Architecture:** A shared **IntentCore** source set (compiled into both the app and widget-extension targets) holds the networking (`APIClient`, `Keychain`), the models intents read, and an `IntentActions` helper wrapping the handful of endpoints intents call. Siri phrases run intents in the app process; interactive widget buttons run the same intents in the extension process — both go through `IntentActions`. Widgets render from a `WidgetSnapshot` (bumped to v2) the app writes into the App Group; buttons/intents mutate via the API and trigger a timeline reload.

**Tech Stack:** Swift / SwiftUI, App Intents framework, WidgetKit, App Group `group.app.focusquest`, first-party Apple frameworks only (no SPM deps). Backend is the existing REST API via `APIClient`.

**Spec:** `docs/superpowers/specs/2026-09-09-ios-siri-widgets-expansion-design.md`

## Global Constraints

- **No SPM dependencies** — first-party Apple frameworks only.
- **App Group id:** `group.app.focusquest` (already in both targets' entitlements).
- **Auth in background intents:** load the session token with
  `Keychain.get(account: Keychain.sessionTokenAccount)`; if `nil`, return a
  "sign in first" dialog / no-op (never crash). Then `await APIClient.shared.setToken(token)`.
- **No XCTest target exists.** The test cycle for every task is:
  `xcodebuild build -project ios/FocusQuest.xcodeproj -scheme FocusQuest -destination 'generic/platform=iOS Simulator' -skipMacroValidation CODE_SIGNING_ALLOWED=NO`
  (the `FocusQuest` scheme builds the `FocusQuestWidgetsExtension` target too), plus a
  booted-simulator run for tasks with observable behavior. **Zero compiler warnings.**
- **Focus presets are a fixed enum:** `FocusPresetKey { classic, deep, short }`. No arbitrary minutes.
- **Brain modes:** `BrainMode { focused, distracted, frozen, hyperfocus, neutral }`.
- **Pattern to follow:** `ios/FocusQuest/Intents/AddQuestIntent.swift` is the reference for background intents.
- **Target membership matters:** any file an interactive-widget button touches must belong to **both** the `FocusQuest` and `FocusQuestWidgetsExtension` targets. Verify membership in `project.pbxproj`, not just that the app builds.

---

## File Structure

- `ios/Shared/WidgetSharedStore.swift` — extend `WidgetSnapshot` to v2 + migrating read (both targets, already shared).
- `ios/Shared/IntentCore/` — **new shared group, both targets:**
  - `IntentActions.swift` — thin endpoint wrappers used by every action intent.
  - `QuestEntity.swift` — `QuestEntity` + `QuestEntityQuery`.
  - `IntentOptions.swift` — `FocusPresetOption`, `BrainModeOption` AppEnums.
  - `StartFocusIntent.swift`, `CompleteQuestIntent.swift`, `CheckStatsIntent.swift`, `BrainCheckInIntent.swift`.
- `ios/FocusQuest/Networking/APIClient.swift`, `ios/FocusQuest/Auth/Keychain.swift`, and the read models (`CoreModels`, `FocusModels`, `Enums`, `Quest`) — **add widget-extension target membership** (no code change, membership only). If any of these `import` app-only code, extract the minimal networking core instead (flagged in Task 2).
- `ios/FocusQuest/Intents/FocusQuestShortcuts.swift` — add an `AppShortcut` per new intent (app target).
- `ios/FocusQuest/Features/Today/TodayView.swift` — populate v2 snapshot fields.
- `ios/FocusQuest/Features/Focus/*` — adopt a server-started session on foreground (Task 6).
- `ios/FocusQuestWidgets/FocusQuestWidget.swift` — interactive buttons on existing widgets (Phase 3).
- `ios/FocusQuestWidgets/QuestListWidget.swift`, `StatsWidget.swift`, `ConfigurableFocusWidget.swift` — new widgets (Phase 4).
- `ios/FocusQuestWidgets/FocusQuestWidgetBundle.swift` — register new widgets.

---

# Phase 1 — Foundation

### Task 1: `WidgetSnapshot` v2 + migrating read

**Files:**
- Modify: `ios/Shared/WidgetSharedStore.swift`

**Interfaces:**
- Produces: `SnapshotQuest { id: Int, title: String, completed: Bool }`; `WidgetSnapshot` gains `nextQuestId: Int?`, `topQuests: [SnapshotQuest]`, `coins: Int?`, `activeFocus: Bool`. `WidgetSharedStore.read()` returns a v2 snapshot, migrating from a stored v1.

- [ ] **Step 1: Extend the model.** In `WidgetSharedStore.swift`, add:

```swift
struct SnapshotQuest: Codable, Hashable, Identifiable {
    let id: Int
    let title: String
    let completed: Bool
}
```

Add to `WidgetSnapshot` (keep existing fields):

```swift
var nextQuestId: Int?
var topQuests: [SnapshotQuest]
var coins: Int?
var activeFocus: Bool
```

Update `.placeholder` and `.empty` to set the new fields (placeholder: a couple of
sample `topQuests`, `activeFocus: false`; empty: `nextQuestId: nil, topQuests: [], coins: 0, activeFocus: false`).

- [ ] **Step 2: Bump the key + migrate on read.** Change `snapshotKey` to `"widget.snapshot.v2"`, add `private static let legacyKey = "widget.snapshot.v1"`. Rewrite `read()`:

```swift
static func read() -> WidgetSnapshot? {
    if let data = defaults?.data(forKey: snapshotKey),
       let snap = try? JSONDecoder().decode(WidgetSnapshot.self, from: data) {
        return snap
    }
    // Migrate a v1 payload: decode the old shape, map new fields to defaults.
    if let data = defaults?.data(forKey: legacyKey),
       let legacy = try? JSONDecoder().decode(LegacySnapshotV1.self, from: data) {
        return WidgetSnapshot(
            focusQuestTitle: legacy.focusQuestTitle, streakDays: legacy.streakDays,
            level: legacy.level, levelName: legacy.levelName,
            todayCompleted: legacy.todayCompleted, todayTotal: legacy.todayTotal,
            updatedAt: legacy.updatedAt,
            nextQuestId: nil, topQuests: [], coins: nil, activeFocus: false)
    }
    return nil
}
```

Add a private `LegacySnapshotV1: Codable` mirroring the six original fields + `updatedAt`.

- [ ] **Step 3: Build.** Run the Global-Constraints `xcodebuild` command. Expected: build succeeds, no warnings.

- [ ] **Step 4: Commit.**

```bash
git add ios/Shared/WidgetSharedStore.swift
git commit -m "feat(ios): WidgetSnapshot v2 with quest ids, coins, active-focus + v1 migration"
```

---

### Task 2: IntentCore shared membership + `IntentActions`

**Files:**
- Create: `ios/Shared/IntentCore/IntentActions.swift`
- Modify: `ios/FocusQuest.xcodeproj/project.pbxproj` (add widget-extension membership for `APIClient.swift`, `Keychain.swift`, and the read models; add the new `IntentCore` group to both targets)

**Interfaces:**
- Consumes: `APIClient.shared` (`get`/`post`/`request`/`send`/`setToken`), `Keychain.get`, `QuestService`/`FocusService`/`BrainService`/`UserService` call shapes.
- Produces: `enum IntentActions` with:
  - `static func authorize() async -> Bool` — loads Keychain token into `APIClient`; returns false if missing.
  - `static func todaysQuests() async throws -> [Quest]`
  - `static func momentumNext() async throws -> Quest?`
  - `static func completeQuest(id: Int) async throws -> TaskCompletionResult`
  - `static func startFocus(preset: FocusPresetKey) async throws -> FocusSessionCreated`
  - `static func stats() async throws -> UserStats`
  - `static func brainCheckin(mode: BrainMode) async throws -> BrainState`

- [ ] **Step 1: Write `IntentActions`.** Create the file:

```swift
import Foundation

/// The only networking surface App Intents use. Lives in IntentCore so both the
/// app process (Siri) and the widget-extension process (interactive buttons) call
/// one implementation. Each caller invokes `authorize()` first.
enum IntentActions {
    /// Load the session token from the Keychain into the shared client.
    /// Returns false when the user isn't signed in.
    static func authorize() async -> Bool {
        guard let token = Keychain.get(account: Keychain.sessionTokenAccount) else { return false }
        await APIClient.shared.setToken(token)
        return true
    }

    static func todaysQuests() async throws -> [Quest] {
        try await QuestService.list(date: UserService.dateString(daysFromToday: 0))
    }

    static func momentumNext() async throws -> Quest? {
        try await QuestService.momentum().suggestions.first?.task
    }

    static func completeQuest(id: Int) async throws -> TaskCompletionResult {
        try await QuestService.complete(id: id)
    }

    static func startFocus(preset: FocusPresetKey) async throws -> FocusSessionCreated {
        try await FocusService.start(preset: preset, taskId: nil)
    }

    static func stats() async throws -> UserStats { try await UserService.stats() }

    static func brainCheckin(mode: BrainMode) async throws -> BrainState {
        try await BrainService.checkin(mode: mode, source: "siri")
    }
}
```

- [ ] **Step 2: Add target membership.** In Xcode (or by editing `project.pbxproj`), add these files to the **FocusQuestWidgetsExtension** target's `Sources` build phase (they already belong to `FocusQuest`): `APIClient.swift`, `Keychain.swift`, `IntentActions.swift`, and the model files the wrappers reference (`CoreModels.swift`, `FocusModels.swift`, `Enums.swift`, and the `Quest` model file). Also add the referenced `Service` files (`QuestService.swift`, `FocusService.swift`, `BrainService.swift`, `UserService.swift`) — or, if a service pulls in app-only UI code, inline its one call into `IntentActions` instead of adding the whole service.

- [ ] **Step 3: Build BOTH targets.** Run the `xcodebuild` command (builds the extension via the scheme). Expected: both `FocusQuest` and `FocusQuestWidgetsExtension` compile. If the extension fails on an app-only symbol pulled in transitively, narrow membership (extract the minimal networking core) until the extension compiles clean.

- [ ] **Step 4: Verify membership.** `grep` the new files' build-file ids appear under **both** targets' Sources phases in `project.pbxproj`.

- [ ] **Step 5: Commit.**

```bash
git add ios/Shared/IntentCore/IntentActions.swift ios/FocusQuest.xcodeproj/project.pbxproj
git commit -m "feat(ios): IntentCore shared networking + IntentActions for app+widget intents"
```

---

### Task 3: `QuestEntity` + `QuestEntityQuery`

**Files:**
- Create: `ios/Shared/IntentCore/QuestEntity.swift` (both targets)

**Interfaces:**
- Consumes: `IntentActions.authorize()`, `IntentActions.todaysQuests()`.
- Produces: `QuestEntity: AppEntity` (`id: Int`, `title: String`); `QuestEntityQuery: EntityQuery`.

- [ ] **Step 1: Write the entity + query.**

```swift
import AppIntents

struct QuestEntity: AppEntity {
    let id: Int
    let title: String

    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Quest" }
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(title)") }
    static var defaultQuery = QuestEntityQuery()

    init(id: Int, title: String) { self.id = id; self.title = title }
    init(quest: Quest) { self.id = quest.id; self.title = quest.title }
}

struct QuestEntityQuery: EntityQuery {
    func entities(for ids: [Int]) async throws -> [QuestEntity] {
        guard await IntentActions.authorize() else { return [] }
        let quests = try await IntentActions.todaysQuests()
        let byId = Dictionary(uniqueKeysWithValues: quests.map { ($0.id, $0) })
        return ids.compactMap { byId[$0].map(QuestEntity.init(quest:)) }
    }

    /// Live picker: today's not-yet-completed quests.
    func suggestedEntities() async throws -> [QuestEntity] {
        guard await IntentActions.authorize() else { return [] }
        return try await IntentActions.todaysQuests()
            .filter { !$0.completed }
            .map(QuestEntity.init(quest:))
    }
}
```

- [ ] **Step 2: Build both targets** (Global-Constraints command). Expected: pass.

- [ ] **Step 3: Commit.**

```bash
git add ios/Shared/IntentCore/QuestEntity.swift
git commit -m "feat(ios): QuestEntity + query for Siri/Shortcuts quest picker"
```

---

### Task 4: Populate v2 snapshot fields from `TodayView`

**Files:**
- Modify: `ios/FocusQuest/Features/Today/TodayView.swift` (`publishWidgetSnapshot()`, ~line 112)

**Interfaces:**
- Consumes: `WidgetSnapshot` v2 (Task 1), local `quests`, `stats`, `focusSuggestion`.

- [ ] **Step 1: Fill the new fields.** Update `publishWidgetSnapshot()` so the written snapshot sets `nextQuestId`, `topQuests`, `activeFocus`, and `coins` (best-effort — pass whatever `coins`/active-focus state the view already holds; if not held locally, `coins: nil` and `activeFocus: false`):

```swift
let pending = quests.filter { !$0.completed }
let nextTitle = focusSuggestion?.task.title ?? pending.first?.title
let nextId = focusSuggestion?.task.id ?? pending.first?.id
let top = quests.prefix(4).map { SnapshotQuest(id: $0.id, title: $0.title, completed: $0.completed) }
WidgetSharedStore.write(WidgetSnapshot(
    focusQuestTitle: nextTitle, streakDays: s.streakDays, level: s.currentLevel,
    levelName: s.levelName, todayCompleted: s.todayTasksCompleted, todayTotal: s.todayTasksTotal,
    updatedAt: .now, nextQuestId: nextId, topQuests: Array(top),
    coins: nil, activeFocus: activeFocusSessionExists))
```

Where `activeFocusSessionExists` is whatever the view already knows (else `false`).

- [ ] **Step 2: Build** (Global-Constraints command). Expected: pass.

- [ ] **Step 3: Simulator check.** Boot the sim, run the app, add the Home widget; confirm it still renders (now from v2 data) and shows the next quest. Screenshot.

- [ ] **Step 4: Commit.**

```bash
git add ios/FocusQuest/Features/Today/TodayView.swift
git commit -m "feat(ios): publish v2 snapshot fields (next quest id, top quests) for widgets"
```

---

# Phase 2 — Siri App Intents (background-first)

### Task 5: `FocusPresetOption` + `BrainModeOption` AppEnums

**Files:**
- Create: `ios/Shared/IntentCore/IntentOptions.swift` (both targets)

**Interfaces:**
- Produces: `FocusPresetOption: AppEnum` mapping to `FocusPresetKey`; `BrainModeOption: AppEnum` mapping to `BrainMode`.

- [ ] **Step 1: Write the enums.**

```swift
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
```

- [ ] **Step 2: Build both targets.** Expected: pass.
- [ ] **Step 3: Commit.**

```bash
git add ios/Shared/IntentCore/IntentOptions.swift
git commit -m "feat(ios): AppEnum options for focus preset and brain mode intents"
```

---

### Task 6: `StartFocusIntent` (pure background) + session adoption

**Files:**
- Create: `ios/Shared/IntentCore/StartFocusIntent.swift` (both targets)
- Modify: the Focus feature's foreground/active-session path (`ios/FocusQuest/Features/Focus/`) to adopt a server-started session.

**Interfaces:**
- Consumes: `IntentActions.startFocus(preset:)`, `FocusPresetOption`, `WidgetSharedStore`.
- Produces: `StartFocusIntent: AppIntent`.

- [ ] **Step 1: Write the intent.**

```swift
import AppIntents

struct StartFocusIntent: AppIntent {
    static var title: LocalizedStringResource = "Start a Focus Session"
    static var description = IntentDescription("Start a FocusQuest focus session in the background.")
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Preset", default: .classic)
    var preset: FocusPresetOption

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard await IntentActions.authorize() else {
            return .result(dialog: "Open FocusQuest and sign in first, then try again.")
        }
        do {
            _ = try await IntentActions.startFocus(preset: preset.key)
            // Reflect the running session for widgets; app adopts the live timer on next open.
            if var snap = WidgetSharedStore.read() { snap.activeFocus = true; snap.updatedAt = .now; WidgetSharedStore.write(snap) }
            return .result(dialog: "Started a \(preset.rawValue == "deep" ? "Deep Work" : preset.rawValue.capitalized) focus session. Open FocusQuest to run the timer.")
        } catch {
            return .result(dialog: "I couldn't start a focus session just now. Please try again.")
        }
    }
}
```

- [ ] **Step 2: Session adoption.** In the Focus feature, on foreground/appear, call `FocusService.active()`; if it returns a session the app didn't start locally, adopt it (populate the timer state / offer resume) so a Siri-started session isn't orphaned. Follow the existing active-session handling; if none exists, add a minimal adopt-on-appear that seeds the timer from the returned `FocusSession` (`preset`, `focusMinutes`, `completedIntervals`, `startedAt`).

- [ ] **Step 3: Build both targets.** Expected: pass.

- [ ] **Step 4: Simulator check.** Sign in on the sim; trigger `StartFocusIntent` from the Shortcuts app; confirm the spoken/return dialog, that `focus-sessions/active` now returns a session, and that opening the app adopts it. Screenshot.

- [ ] **Step 5: Commit.**

```bash
git add ios/Shared/IntentCore/StartFocusIntent.swift ios/FocusQuest/Features/Focus
git commit -m "feat(ios): StartFocusIntent (background) + adopt server-started focus session on foreground"
```

---

### Task 7: `CompleteQuestIntent` (quest picker + momentum fallback)

**Files:**
- Create: `ios/Shared/IntentCore/CompleteQuestIntent.swift` (both targets)

**Interfaces:**
- Consumes: `QuestEntity`, `IntentActions.momentumNext()`, `IntentActions.completeQuest(id:)`.
- Produces: `CompleteQuestIntent: AppIntent` (used by Siri AND the widget Complete button).

- [ ] **Step 1: Write the intent.**

```swift
import AppIntents

struct CompleteQuestIntent: AppIntent {
    static var title: LocalizedStringResource = "Complete a Quest"
    static var description = IntentDescription("Mark a FocusQuest quest done.")
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Quest")
    var quest: QuestEntity?

    init() {}
    init(quest: QuestEntity?) { self.quest = quest }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard await IntentActions.authorize() else {
            return .result(dialog: "Open FocusQuest and sign in first, then try again.")
        }
        do {
            let targetId: Int?
            if let quest { targetId = quest.id }
            else { targetId = try await IntentActions.momentumNext()?.id }
            guard let id = targetId else { return .result(dialog: "You're all clear — no quests to complete.") }

            let result = try await IntentActions.completeQuest(id: id)
            WidgetCenter.shared.reloadAllTimelines()
            let levelLine = result.leveledUp ? " You reached level \(result.newLevel)!" : ""
            return .result(dialog: "Completed “\(result.task.title)” — \(result.pointsAwarded) points.\(levelLine)")
        } catch {
            return .result(dialog: "I couldn't complete that quest just now. Please try again.")
        }
    }
}
```

Add `import WidgetKit` for the reload.

- [ ] **Step 2: Build both targets.** Expected: pass.

- [ ] **Step 3: Simulator check.** From Shortcuts, run "Complete a Quest": once picking a specific quest (verify picker lists today's incomplete quests), once with none selected (verify it completes the momentum next). Confirm the dialog and that the quest is done in-app. Screenshot.

- [ ] **Step 4: Commit.**

```bash
git add ios/Shared/IntentCore/CompleteQuestIntent.swift
git commit -m "feat(ios): CompleteQuestIntent with quest picker + momentum-next fallback"
```

---

### Task 8: `CheckStatsIntent`

**Files:**
- Create: `ios/Shared/IntentCore/CheckStatsIntent.swift` (both targets)

**Interfaces:**
- Consumes: `IntentActions.stats()`.
- Produces: `CheckStatsIntent: AppIntent`.

- [ ] **Step 1: Write the intent.**

```swift
import AppIntents

struct CheckStatsIntent: AppIntent {
    static var title: LocalizedStringResource = "Check My Stats"
    static var description = IntentDescription("Hear your streak, level, and today's progress.")
    static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard await IntentActions.authorize() else {
            return .result(dialog: "Open FocusQuest and sign in first, then try again.")
        }
        do {
            let s = try await IntentActions.stats()
            return .result(dialog: "You're on a \(s.streakDays)-day streak at level \(s.currentLevel), \(s.levelName). You've done \(s.todayTasksCompleted) of \(s.todayTasksTotal) quests today.")
        } catch {
            return .result(dialog: "I couldn't fetch your stats just now. Please try again.")
        }
    }
}
```

- [ ] **Step 2: Build both targets.** Expected: pass.
- [ ] **Step 3: Simulator check.** Run from Shortcuts; confirm the spoken numbers match the app's Today screen. Screenshot.
- [ ] **Step 4: Commit.**

```bash
git add ios/Shared/IntentCore/CheckStatsIntent.swift
git commit -m "feat(ios): CheckStatsIntent — speak streak, level, today progress"
```

---

### Task 9: `BrainCheckInIntent`

**Files:**
- Create: `ios/Shared/IntentCore/BrainCheckInIntent.swift` (both targets)

**Interfaces:**
- Consumes: `BrainModeOption`, `IntentActions.brainCheckin(mode:)`.
- Produces: `BrainCheckInIntent: AppIntent`.

- [ ] **Step 1: Write the intent.**

```swift
import AppIntents

struct BrainCheckInIntent: AppIntent {
    static var title: LocalizedStringResource = "Brain Check-In"
    static var description = IntentDescription("Log how your brain feels right now.")
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Mode", default: .neutral)
    var mode: BrainModeOption

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard await IntentActions.authorize() else {
            return .result(dialog: "Open FocusQuest and sign in first, then try again.")
        }
        do {
            _ = try await IntentActions.brainCheckin(mode: mode.mode)
            return .result(dialog: "Logged you as \(mode.mode.label.lowercased()). Nice check-in.")
        } catch {
            return .result(dialog: "I couldn't log that just now. Please try again.")
        }
    }
}
```

- [ ] **Step 2: Build both targets.** Expected: pass.
- [ ] **Step 3: Simulator check.** Run from Shortcuts choosing a mode; confirm dialog and that the Brain screen reflects the check-in. Screenshot.
- [ ] **Step 4: Commit.**

```bash
git add ios/Shared/IntentCore/BrainCheckInIntent.swift
git commit -m "feat(ios): BrainCheckInIntent — log brain mode by voice"
```

---

### Task 10: Register phrases in `FocusQuestShortcuts`

**Files:**
- Modify: `ios/FocusQuest/Intents/FocusQuestShortcuts.swift`

**Interfaces:**
- Consumes: `AddQuestIntent` (existing), `StartFocusIntent`, `CompleteQuestIntent`, `CheckStatsIntent`, `BrainCheckInIntent`.

- [ ] **Step 1: Add an `AppShortcut` per intent** (keep the existing Add-a-Quest one):

```swift
AppShortcut(intent: StartFocusIntent(), phrases: [
    "Start a focus session in \(.applicationName)",
    "Start deep work in \(.applicationName)",
], shortTitle: "Start Focus", systemImageName: "timer")

AppShortcut(intent: CompleteQuestIntent(), phrases: [
    "Complete a quest in \(.applicationName)",
    "Mark a quest done in \(.applicationName)",
], shortTitle: "Complete a Quest", systemImageName: "checkmark.circle")

AppShortcut(intent: CheckStatsIntent(), phrases: [
    "What's my streak in \(.applicationName)",
    "Check my \(.applicationName) stats",
], shortTitle: "Check Stats", systemImageName: "chart.bar")

AppShortcut(intent: BrainCheckInIntent(), phrases: [
    "Log my brain in \(.applicationName)",
    "Brain check in \(.applicationName)",
], shortTitle: "Brain Check-In", systemImageName: "brain.head.profile")
```

- [ ] **Step 2: Build** (Global-Constraints command). Expected: pass.
- [ ] **Step 3: Simulator check.** Confirm all five actions appear in the Shortcuts app under FocusQuest and in Spotlight. Screenshot.
- [ ] **Step 4: Commit.**

```bash
git add ios/FocusQuest/Intents/FocusQuestShortcuts.swift
git commit -m "feat(ios): Siri phrases + Shortcuts/Spotlight entries for focus, complete, stats, brain"
```

---

# Phase 3 — Interactive widget buttons

### Task 11: Complete + Start Focus buttons on the Home widget

**Files:**
- Modify: `ios/FocusQuestWidgets/FocusQuestWidget.swift`

**Interfaces:**
- Consumes: `CompleteQuestIntent(quest:)`, `StartFocusIntent`, `QuestEntity`, `WidgetSnapshot` v2.

- [ ] **Step 1: Replace the deep-link pill with real buttons.** In `FocusHomeView`, gate on iOS 17. Build a `QuestEntity` from the snapshot when `nextQuestId` is set, and use `Button(intent:)`:

```swift
if let id = snapshot.nextQuestId, let title = snapshot.focusQuestTitle {
    Button(intent: CompleteQuestIntent(quest: QuestEntity(id: id, title: title))) {
        Label("Complete", systemImage: "checkmark.circle")
    }
    .buttonStyle(.plain)
}
Button(intent: StartFocusIntent()) {
    Label("Start Focus", systemImage: "timer")
}
.buttonStyle(.plain)
```

Keep the existing `.widgetURL(WidgetSharedStore.startFocusURL)` as a fallback for the whole-widget tap. Style the buttons to match the current `startFocusPill` look.

- [ ] **Step 2: Build both targets.** Expected: pass. (`Button(intent:)` requires the intents in the extension — provided by Task 2 membership.)

- [ ] **Step 3: Simulator check.** Add the Home widget; tap **Complete** — the quest completes without opening the app and the widget updates on the next reload; tap **Start Focus** — a session is created (verify via app). Screenshots of before/after.

- [ ] **Step 4: Commit.**

```bash
git add ios/FocusQuestWidgets/FocusQuestWidget.swift
git commit -m "feat(ios): interactive Complete + Start Focus buttons on the Home widget"
```

---

### Task 12: Lock-Screen accessory interactive affordance

**Files:**
- Modify: `ios/FocusQuestWidgets/FocusQuestWidget.swift` (`FocusAccessoryView`)

**Interfaces:**
- Consumes: `CompleteQuestIntent(quest:)`.

- [ ] **Step 1: Add a Complete button where the family allows.** For `.accessoryRectangular` (iOS 17+), wrap the next-quest line in a `Button(intent: CompleteQuestIntent(quest:))` when `nextQuestId` is present; leave `.accessoryCircular`/`.accessoryInline` as deep links (no room for a button). Keep `.widgetAccentable()`.

- [ ] **Step 2: Build both targets.** Expected: pass.
- [ ] **Step 3: Simulator check.** Add the rectangular Lock-Screen widget; confirm the Complete affordance works. Screenshot.
- [ ] **Step 4: Commit.**

```bash
git add ios/FocusQuestWidgets/FocusQuestWidget.swift
git commit -m "feat(ios): interactive Complete on rectangular Lock-Screen accessory"
```

---

# Phase 4 — New widget surfaces

### Task 13: Today's Quests list widget

**Files:**
- Create: `ios/FocusQuestWidgets/QuestListWidget.swift`
- Modify: `ios/FocusQuestWidgets/FocusQuestWidgetBundle.swift` (register)

**Interfaces:**
- Consumes: `FocusProvider`/`FocusEntry` (existing), `snapshot.topQuests`, `CompleteQuestIntent(quest:)`.
- Produces: `QuestListWidget: Widget` (kind `"FocusQuestList"`).

- [ ] **Step 1: Write the widget.** Reuse `FocusProvider`. New `StaticConfiguration` for kind `"FocusQuestList"`, families `[.systemMedium, .systemLarge]`. View renders `snapshot.topQuests` (2 on medium, up to 4 on large), each row: title + a trailing `Button(intent: CompleteQuestIntent(quest: QuestEntity(id:title:)))` with a checkmark; completed rows show a filled check, no button. Empty state: "All clear today". `containerBackground(.fill.tertiary, for: .widget)`.

- [ ] **Step 2: Register** in `FocusQuestWidgetBundle.body`: add `QuestListWidget()`.

- [ ] **Step 3: Build both targets.** Expected: pass.
- [ ] **Step 4: Simulator check.** Add the list widget; confirm it lists today's quests and per-row Complete works. Screenshot.
- [ ] **Step 5: Commit.**

```bash
git add ios/FocusQuestWidgets/QuestListWidget.swift ios/FocusQuestWidgets/FocusQuestWidgetBundle.swift
git commit -m "feat(ios): Today's Quests list widget with per-row complete buttons"
```

---

### Task 14: Stats widget

**Files:**
- Create: `ios/FocusQuestWidgets/StatsWidget.swift`
- Modify: `ios/FocusQuestWidgets/FocusQuestWidgetBundle.swift` (register)

**Interfaces:**
- Consumes: `FocusProvider`/`FocusEntry`, `WidgetSnapshot` (level, levelName, streakDays, todayCompleted/Total, coins).
- Produces: `StatsWidget: Widget` (kind `"FocusQuestStats"`).

- [ ] **Step 1: Write the widget.** `StaticConfiguration` kind `"FocusQuestStats"`, families `[.systemSmall, .accessoryRectangular]`. Small: level + name, `streakDays`-day streak with flame, a today-progress ring (`todayCompleted/todayTotal`), and coins **only when `snapshot.coins != nil`**. Rectangular accessory: compact streak + level line. `containerBackground` for the home family.

- [ ] **Step 2: Register** `StatsWidget()` in the bundle.
- [ ] **Step 3: Build both targets.** Expected: pass.
- [ ] **Step 4: Simulator check.** Add the stats widget (home + lock screen); confirm values match the app. Screenshot.
- [ ] **Step 5: Commit.**

```bash
git add ios/FocusQuestWidgets/StatsWidget.swift ios/FocusQuestWidgets/FocusQuestWidgetBundle.swift
git commit -m "feat(ios): stats widget (level, streak, progress, coins)"
```

---

### Task 15: Configurable widget (category/next selection)

**Files:**
- Create: `ios/FocusQuestWidgets/ConfigurableFocusWidget.swift`
- Modify: `ios/FocusQuestWidgets/FocusQuestWidgetBundle.swift` (register)

**Interfaces:**
- Consumes: `WidgetSnapshot.topQuests`, `TaskCategory` (for the filter enum).
- Produces: `FocusConfigIntent: WidgetConfigurationIntent`, `ConfigurableFocusWidget: Widget` (kind `"FocusQuestConfigurable"`), and an `IntentTimelineProvider`.

- [ ] **Step 1: Configuration intent.** Create `FocusConfigIntent: WidgetConfigurationIntent` with a `@Parameter var filter: QuestFilterOption` — an `AppEnum` `{ nextUp, allToday }` (start minimal; a category filter can be added later only if `topQuests` carries category — it does not today, so keep it to next-up vs. list to stay within the snapshot).

- [ ] **Step 2: Provider + widget.** An `IntentTimelineProvider` (mirrors `FocusProvider` but typed to `FocusConfigIntent`) reads the snapshot; the view shows either the single next-up quest or the `topQuests` list per `configuration.filter`. `AppIntentConfiguration(kind: "FocusQuestConfigurable", intent: FocusConfigIntent.self, provider:) { ... }`, families `[.systemMedium]`.

- [ ] **Step 3: Register** `ConfigurableFocusWidget()` in the bundle.
- [ ] **Step 4: Build both targets.** Expected: pass.
- [ ] **Step 5: Simulator check.** Add the widget, long-press → Edit, switch the filter, confirm the content changes. Screenshot.
- [ ] **Step 6: Commit.**

```bash
git add ios/FocusQuestWidgets/ConfigurableFocusWidget.swift ios/FocusQuestWidgets/FocusQuestWidgetBundle.swift
git commit -m "feat(ios): configurable widget with next-up vs today's-list option"
```

---

## Self-Review

**Spec coverage:**
- Foundation (snapshot v2, QuestEntity, IntentCore) → Tasks 1–4. ✓
- Siri intents StartFocus/CompleteQuest/CheckStats/BrainCheckIn + phrases/Spotlight → Tasks 5–10. ✓
- Start-Focus background reconciliation → Task 6 Step 2. ✓
- Interactive buttons on existing widgets → Tasks 11–12. ✓
- New surfaces: list, stats, configurable → Tasks 13–15. ✓
- Error handling (no token / API failure / stale id) → baked into each intent's `guard` + `catch`; stale-id handled by re-fetch/idempotent complete (Task 7). ✓
- Out-of-scope items (reflection-Siri, gear/party widget actions, watchOS, arbitrary minutes) → not planned. ✓

**Type consistency:** `IntentActions` method names/signatures in Task 2 match their call sites in Tasks 3, 6, 7, 8, 9. `QuestEntity(id:title:)` and `QuestEntity(quest:)` used consistently (Tasks 3, 7, 11, 12, 13). `CompleteQuestIntent(quest:)` initializer defined in Task 7, used in 11/12/13. `FocusPresetOption.key`/`BrainModeOption.mode` defined in Task 5, used in 6/9. Snapshot v2 fields defined in Task 1, written in Task 4, read in 11–15.

**Placeholder scan:** No TBD/TODO; every code step carries real content.
