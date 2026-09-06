# iOS Native Power Features — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a **multi-phase program**; each phase is independently shippable. Do phases in order — later phases reuse structure from earlier ones.

**Goal:** Turn the native SwiftUI FocusQuest app (`ios/`) into a genuinely iOS-native experience: reliable focus/break/quest alerts that fire when locked, a Live Activity + Dynamic Island countdown, voice capture, Home/Lock-Screen widgets, haptics, and Sign in with Apple — reusing the existing REST API and NL parser rather than adding server surface.

**Architecture:** All alerting in Phases 1–5 is **on-device local notifications** (`UNUserNotificationCenter`) and **ActivityKit** — **no server push, no APNs backend, no new API endpoints.** This matches the highest-leverage ADHD win (a timer that alerts when locked) and sidesteps the APNs device-token server work the README flags as a prerequisite for *push*. The focus countdown is already derived from a wall-clock `phaseEndDate` in [`FocusViewModel`](../../../ios/FocusQuest/Features/Focus/FocusViewModel.swift); we make the *alerting and crediting* survive suspension by (a) scheduling a local notification at the target end-time and (b) reconciling elapsed phases on foreground instead of trusting the in-process ticker. The Live Activity and Widgets live in one new **Widget Extension target** sharing an `ActivityAttributes`/snapshot model with the app via an **App Group**.

**Tech Stack:** Swift 5.9+ / SwiftUI, iOS 17.0+ deployment target, Xcode 16 (`objectVersion = 77`, file-system-synchronized folder groups), `UserNotifications`, `ActivityKit`, `WidgetKit`, `AppIntents`, `Speech` + `AVFoundation`, `AuthenticationServices`. Existing app: `APIClient` actor + typed `*Service` groups, MVVM with `Loadable`, Auth0 PKCE.

**Referenced design thinking:** `docs/superpowers/plans/2026-07-16-context-aware-notifications.md` (anti-shame copy law, envelope timing) and `docs/superpowers/plans/2026-07-19-one-voice-notifications.md` (one-voice categories) inform *copy and cadence*, even though those describe the server-side web push path and this plan is on-device.

## Global Constraints

- **Branch:** continue on `claude/swift-mobile-app-a70k2k` (the Swift app branch). Verify `git branch --show-current` before every commit. Never `git add -A`; stage explicit `ios/...` paths only.
- **The project is not yet Xcode-compiled** (built/pushed from Linux CI — see `ios/README.md` "Known caveats"). The **real gate for every phase is `⌘B` in Xcode + a run on a device/simulator**, mirroring the on-device "G" gates in the existing iOS runbooks. Do not mark a phase done on code-write alone.
- **No server changes** in Phases 1–5. The one backend touch in the whole program is **Auth0 dashboard config** for Sign in with Apple (Phase 6) — no api-server code.
- **Local, not push:** Phases 1–5 schedule notifications on-device. Do **not** add `UIBackgroundModes: remote-notification`, APNs registration, or `/api/devices` calls — that path is deliberately out of scope here.
- **Anti-shame copy law** (from the notification plans): no "warning", no guilt, no "you didn't"; quest titles quoted; real numbers only. Applies to every user-facing notification/Activity string in this program.
- **Entitlements:** several phases need a `FocusQuest.entitlements` file wired via `CODE_SIGN_ENTITLEMENTS`. It does not exist yet — Phase 1 creates it. Adding an entry is an Xcode "Signing & Capabilities" action; when editing `project.pbxproj` by hand, change it in **one** place and re-verify the build.
- **pbxproj edits are the structural risk.** The file is hand-maintained. For the new extension target (Phases 2/4), **prefer adding the target through the Xcode UI** on first open (the project is uncompiled anyway) rather than hand-writing pbxproj, then commit the resulting diff. Document what Xcode generated.
- **iOS pending-notification cap is 64.** The quest-nudge scheduler (Phase 1, Task 4) must only register near-horizon (today/tomorrow) triggers and cancel on completion/reschedule.
- **Interruption level:** focus/break-over and quest-due alerts use `.timeSensitive` so they pierce Focus Mode / DND. That requires the Time Sensitive Notifications entitlement (Phase 1, Task 1).

---

## Phase 1 — Local notifications + focus-timer background correctness

**Why first:** highest ADHD value, a real correctness fix, pure app-target Swift (no new build target), and it establishes the "store target end-time → schedule → reconcile on foreground" logic that the Live Activity (Phase 2) reuses.

### Task 1: Entitlements + `NotificationManager` foundation

**Files:**
- Create: `ios/FocusQuest/FocusQuest.entitlements`
- Create: `ios/FocusQuest/Services/NotificationManager.swift`
- Modify: `ios/FocusQuest.xcodeproj/project.pbxproj` (set `CODE_SIGN_ENTITLEMENTS = FocusQuest/FocusQuest.entitlements` in both build configs)
- Modify: `ios/FocusQuest/App/FocusQuestApp.swift` (install the notification-center delegate)

**Interfaces produced:** a `NotificationManager` singleton (`@MainActor`, `ObservableObject`) exposing `requestAuthorizationIfNeeded() async -> Bool`, `authorizationStatus`, `scheduleFocusPhaseEnd(sessionId:phase:fireDate:)`, `cancelFocusPhaseAlerts(sessionId:)`, and a `UNUserNotificationCenterDelegate` that (a) presents banners in-foreground (`.banner`, `.sound`) and (b) routes taps via `AppRouter`.

- [ ] **Step 1:** Create `FocusQuest.entitlements` with the Time Sensitive entitlement:
  ```xml
  <key>com.apple.developer.usernotifications.time-sensitive</key>
  <true/>
  ```
- [ ] **Step 2:** Wire `CODE_SIGN_ENTITLEMENTS` in both Debug/Release configs of the `FocusQuest` target in `project.pbxproj` (or via Xcode Signing & Capabilities → "+ Time Sensitive Notifications", then commit the diff).
- [ ] **Step 3:** Implement `NotificationManager`. Authorization requests `[.alert, .sound]` (no badge). Keep a stable identifier scheme: focus alerts `focus.<sessionId>.<phase>`; quest nudges `quest.<questId>` (Task 4). The delegate's `userNotificationCenter(_:willPresent:)` returns `[.banner, .sound]` so an alert still shows if the app is foregrounded when a phase ends; `didReceive` reads the identifier and asks `AppRouter` to route to `/focus` (focus alerts) or the quest (quest nudges).
- [ ] **Step 4:** In `FocusQuestApp.init` (or an `@UIApplicationDelegateAdaptor`), set `UNUserNotificationCenter.current().delegate = NotificationManager.shared`. **Set the delegate before the app finishes launching** so a cold launch from a notification tap is delivered.
- [ ] **Gate:** `⌘B`; on device, trigger `requestAuthorizationIfNeeded()` from a temporary button and confirm the system prompt appears once.

### Task 2: Schedule focus/break-over alerts from the timer

**Files:** Modify `ios/FocusQuest/Features/Focus/FocusViewModel.swift`

**Behavior:** every time a phase window is set, schedule a `.timeSensitive` local notification at `phaseEndDate`; cancel/reschedule when the window changes.

- [ ] **Step 1:** Request authorization on the **first `start()`** (contextual, not at app launch). If denied, the timer still works on-screen; only alerts are absent.
- [ ] **Step 2:** In `setPhaseWindow(minutes:)`, after computing `phaseEndDate`, call `NotificationManager.shared.scheduleFocusPhaseEnd(...)` with copy per phase — focus→"Focus interval done. Take a breath." / break→"Break's over — ready for the next round?" Use `interruptionLevel = .timeSensitive`. Prefer `UNCalendarNotificationTrigger` on `phaseEndDate` (survives suspension precisely) over a `UNTimeIntervalNotificationTrigger`.
- [ ] **Step 3:** Cancel the pending focus alert in `togglePause()` (pause), `stop()`, `skipBreak()`, and `reset()`; on resume, reschedule at the shifted `phaseEndDate`. One pending focus alert at a time.
- [ ] **Gate:** start a 1-minute-ish focus preset, lock the phone, confirm the banner fires at end **with the screen locked**, and that it pierces a test Focus Mode.

### Task 3: Reconcile elapsed phases on foreground (the correctness fix)

**Files:** Modify `ios/FocusQuest/Features/Focus/FocusViewModel.swift`, `ios/FocusQuest/Features/Focus/FocusView.swift`

**Problem:** the in-process `Timer.publish` ticker is suspended while backgrounded, so `handlePhaseEnd()` (which credits the interval via `FocusService.recordInterval`) never runs; on reopen the timer just shows `00:00`. One or **several** phases may have elapsed.

- [ ] **Step 1:** Add `func reconcile() async` to the VM: while `phaseEndDate != nil && Date() >= phaseEndDate!`, run the same transition `handlePhaseEnd()` performs (credit focus interval / advance to break / finalize when cycles complete), advancing `phaseEndDate` phase-by-phase until it's in the future or the session finalizes. Guard against crediting the same interval twice (the server response's `completedIntervals` is the source of truth — trust the returned session).
- [ ] **Step 2:** In `FocusView`, observe `@Environment(\.scenePhase)`; on `.active` call `Task { await vm.reconcile() }`, then restart the ticker. Stop the ticker on `.background` (it's dead anyway; this avoids a wasted wake).
- [ ] **Gate:** start focus, background the app past a phase boundary (or two), reopen — confirm the interval(s) got credited server-side and the timer resumes on the correct phase, not `00:00`.

### Task 4: Quest due-time nudges (`UNCalendarNotificationTrigger`)

**Files:** Create `ios/FocusQuest/Services/QuestNudgeScheduler.swift`; modify quest load/create/complete call sites (`QuestsView` / `QuestService` consumers, `QuickAddSheet` `onCreated`, `CompletionSheet`).

**Data:** `Quest` already carries `dueDate` + `dueTime` (`ios/FocusQuest/Models/TaskModels.swift`) — parse to a local `Date`.

- [ ] **Step 1:** `QuestNudgeScheduler.sync(quests:)` — a **declarative reconcile**: for incomplete quests with a `dueTime` in the future within the horizon (today/tomorrow), schedule `quest.<id>` via `UNCalendarNotificationTrigger` (`.timeSensitive`, copy: `"\"<title>\" is scheduled for now."`); remove pendings whose quest is completed, past, rescheduled, or gone. **Respect the 64-pending cap** — sort by fire date, keep the soonest N (e.g. 30), leave headroom for focus alerts.
- [ ] **Step 2:** Call `sync` after quests load, after quick-add create, and after completion. Debounce.
- [ ] **Step 3:** Cancel `quest.<id>` immediately on complete/reschedule (don't wait for the next full sync).
- [ ] **Gate:** create a quest due in ~2 min, lock the phone, confirm the nudge fires; complete a scheduled quest and confirm its pending alert is gone.

### Task 5: Settings toggle + permission recovery

**Files:** Modify `ios/FocusQuest/Features/Settings/SettingsView.swift`

- [ ] A "Notifications" section: shows current `authorizationStatus`; a toggle that requests (if `.notDetermined`) or deep-links to `UIApplication.openSettingsURLString` (if `.denied`); optional per-category switches (focus alerts / quest nudges) stored in `@AppStorage`, honored by the schedulers.
- [ ] **Gate:** deny at OS level, confirm Settings shows the deep-link path and re-enabling restores alerts.

**Phase 1 done when:** locked-phone focus/break/quest alerts fire, pierce Focus Mode, intervals credit correctly across suspension, and Settings governs it — verified on a physical device.

---

## Phase 2 — Live Activity + Dynamic Island (ActivityKit)

**Why second:** the "killer" native feature, but it needs a new extension target — build it on the notification foundation. The lock-screen countdown uses `Text(timerInterval:)`, which self-updates **without** any push, so display correctness is free once the Activity is running.

### Task 1: Add the Widget Extension target + shared attributes

**Files:** new `ios/FocusQuestWidgets/` target; `ios/FocusQuest/Focus/FocusActivityAttributes.swift` (shared, membership in **both** targets); `project.pbxproj`; `Info.plist` (`NSSupportsLiveActivities = true`).

- [ ] Add a **Widget Extension** target via Xcode UI (safer than hand-editing pbxproj). Commit the generated diff; document the target name/bundle id.
- [ ] Define `FocusActivityAttributes: ActivityAttributes` with static `questTitle`/`preset` and a `ContentState` of `phase`, `phaseEndDate`, `isPaused`. Add file membership to app + extension.
- [ ] Add `NSSupportsLiveActivities` to the app `Info.plist`.

### Task 2: Drive the Activity from the timer lifecycle

**Files:** modify `FocusViewModel.swift`; create `ios/FocusQuest/Services/FocusActivityController.swift`.

- [ ] `start()` → `Activity.request`; `setPhaseWindow`/`togglePause` → `activity.update(ContentState)`; `stop()`/`reset()` → `activity.end(dismissalPolicy:)`. Reuse `phaseEndDate` verbatim.
- [ ] Lock-screen + Island views render the countdown with `Text(timerInterval: start...phaseEndDate)`; expanded Island shows phase + quest; minimal shows a ring/glyph. Tap deep-links to `/focus`.
- [ ] **Gate:** start focus on a Dynamic-Island device, confirm live countdown on lock screen and in the Island, correct phase transitions, and clean end on stop.

---

## Phase 3 — Voice quick-add (SFSpeechRecognizer) + Siri/App Intent

**Why:** reuses the existing `/tasks/parse` path — voice only supplies the transcript. Self-contained (app target) for the mic button; the App Intent unlocks capture without opening the app (serves `never-lose-a-thought`).

### Task 1: Mic button → live transcription → existing parser

**Files:** create `ios/FocusQuest/Services/SpeechRecognizer.swift`; modify `ios/FocusQuest/Features/Quests/QuickAddSheet.swift`, `Info.plist`.

- [ ] Add `NSSpeechRecognitionUsageDescription` to `Info.plist` (`NSMicrophoneUsageDescription` already present).
- [ ] `SpeechRecognizer` (observable): request `SFSpeechRecognizer` + `AVAudioSession` auth, stream partial results to a published `transcript`. A mic button in `QuickAddSheet` toggles listening and writes the transcript into the existing `text` field — then the current `preview()`/`create()` (→ `QuestService.parse`) path is unchanged. **No server change.**
- [ ] **Gate:** dictate "email Dr. Lee tomorrow 9am #health", confirm it lands in the field and previews the same parsed fields as typing.

### Task 2: App Intent + Siri + Shortcuts ("Add a quest to FocusQuest")

**Files:** create `ios/FocusQuest/Intents/AddQuestIntent.swift`, `ios/FocusQuest/Intents/FocusQuestShortcuts.swift`.

- [ ] `AddQuestIntent: AppIntent` with a `@Parameter` quest string → calls `QuestService.parse` + create using the Keychain bearer token (same app process; ensure `APIClient` works from an intent). `AppShortcutsProvider` phrases: "Add a quest to FocusQuest". Handle the signed-out case gracefully.
- [ ] **Gate:** "Hey Siri, add a quest to FocusQuest" and a Shortcuts run both create a quest without opening the app.

---

## Phase 4 — Home / Lock Screen widgets (WidgetKit)

**Why:** for a habit app, an at-a-glance widget drives returns more than notifications. Same extension target as Phase 2.

**Files:** `ios/FocusQuestWidgets/` (widgets + `TimelineProvider`); an **App Group** entitlement on both targets; a shared snapshot writer in the app.

- [ ] Add App Group (`group.app.focusquest`) to app + extension entitlements. On foreground, the app writes a small snapshot (today's focus quest, streak, hero state) to the shared container / `UserDefaults(suiteName:)`.
- [ ] Widgets (systemSmall/medium + a lock-screen accessory): today's focus quest, streak, and a **"Start Focus"** control — an `AppIntent`-backed button (iOS 17) or deep link to `/focus`.
- [ ] **Gate:** add each widget to Home + Lock Screen, confirm data and that "Start Focus" launches into a session.

---

## Phase 5 — Haptics

**Why:** cheap dopamine, on-brand for the reward loop. Cross-cutting, tiny.

**Files:** create `ios/FocusQuest/Support/Haptics.swift`; call sites in `CompletionSheet.swift` (quest complete), `FocusViewModel.swift` (interval/session done), and the level-up feedback path.

- [ ] `Haptics` helper wrapping `UINotificationFeedbackGenerator` (success on complete/level-up) and a Core Haptics pattern for timer-done. Respect a Settings toggle (`@AppStorage`).
- [ ] **Gate:** feel distinct haptics on quest-complete, level-up, and focus-interval end.

---

## Phase 6 — Sign in with Apple

**Why:** low effort on Auth0, and effectively **required by App Store review** once other social logins exist.

**Files:** modify `ios/FocusQuest/Features/Auth/LoginView.swift`, `FocusQuest.entitlements`; **Auth0 dashboard** (enable Apple connection). No api-server change (Auth0 brokers the identity).

- [ ] Add the `com.apple.developer.applesignin` entitlement. Present `ASAuthorizationAppleIDButton`; route through Auth0's Apple connection so the resulting session token matches the existing `/mobile-auth/token-exchange` flow (keeps one user identity across web/RN/native).
- [ ] Enable + configure the Apple social connection in the Auth0 tenant (Services ID, key). Document the dashboard steps in `ios/README.md`.
- [ ] **Gate:** complete Sign in with Apple on device, land in the app authenticated as the same user identity.

---

## Second wave (scoped later, not in this pass)

Tracked here so the sequencing is explicit; each is a separate future plan:

- **Focus filter integration** (`AppIntents` Focus filter) — app adapts to system Focus/DND. Thematically perfect, uniquely iOS.
- **StoreKit 2** — only if rewards/power-ups become paid.
- **Handoff / iCloud polish, Spotlight indexing of quests, Control Center / Action Button "Start Focus"** (iOS 18 App Intent control) — reuses the Phase 3 `AddQuestIntent` / Phase 4 Start-Focus intent.

---

## Cross-cutting notes

- **Entitlements accrete:** Phase 1 (time-sensitive) → Phase 4 (App Group) → Phase 6 (Apple sign-in) all add to the one `FocusQuest.entitlements`; the widget extension gets its own with the shared App Group.
- **One identity everywhere:** all auth stays on the existing Auth0 + `/mobile-auth/token-exchange` path so web, RN, and native remain one user.
- **Every phase's true gate is on-device**, per `ios/README.md`. Treat green code as "ready to compile", not "done".
