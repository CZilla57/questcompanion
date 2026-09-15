# iOS Siri & Widget Expansion — Design

*Date: 2026-09-09*
*Status: Draft for review*
*Target: `ios/` native SwiftUI app (`FocusQuest` app target + `FocusQuestWidgets` extension)*

## Goal

Broaden the iOS app's Siri (App Intents) and widget capabilities from today's
single "Add a quest" intent + read-only widgets into a set of voice-driven
actions, interactive widget buttons, and new widget surfaces. Actions that
change data run **in the background** wherever technically possible, confirming
with a spoken/visual result rather than opening the app.

## Current state (baseline)

- **Intents:** one — `AddQuestIntent` (background capture) surfaced via
  `FocusQuestShortcuts` (three "add a quest" phrases). Establishes the working
  pattern: load session token from `Keychain`, `APIClient.shared.setToken`,
  call a `Service`, return `.result(dialog:)`.
- **Widgets:** `FocusQuestHomeWidget` (small/medium), `FocusQuestAccessoryWidget`
  (lock-screen rectangular/circular/inline), and `FocusActivityLiveActivity`.
  All read-only; "Start Focus" is a `widgetURL` deep link (`focusquest://focus`),
  not an interactive intent.
- **Shared data:** `WidgetSnapshot` (key `widget.snapshot.v1`) with
  `focusQuestTitle`, `streakDays`, `level`, `levelName`, `todayCompleted`,
  `todayTotal`, `updatedAt`. Written by `TodayView.publishWidgetSnapshot()`.
- **Services available** (app target, all `async throws`): `QuestService`
  (`list`, `complete`, `momentum`, `create`, `parse`, `pinFocus`),
  `FocusService` (`start(preset:taskId:)`, `active`, `presets`),
  `BrainService.checkin(mode:source:)`, `UserService.stats`.
- **Enums:** `FocusPresetKey { classic, deep, short }` (presets are fixed —
  **no arbitrary minutes**); `BrainMode { focused, distracted, frozen,
  hyperfocus, neutral }`.
- App Group `group.app.focusquest` is already in **both** targets' entitlements.

## Locked decisions

1. **Start Focus is pure background** — no `openAppWhenRun`. The intent creates
   the session server-side and confirms by voice. The in-app timer / Live
   Activity is **not** started from the intent; the app reconciles the active
   session on next foreground (see "Start Focus background reconciliation").
2. **Complete-quest supports a specific-quest picker** — a `QuestEntity` +
   `EntityQuery` so Siri/Spotlight/Shortcuts offer a quest chooser; omitting the
   quest completes the momentum "next" quest.
3. **All four fronts are in scope** and specified here as four sequenced phases.

---

## Key architectural constraint: where intents execute

App Intents run in **different processes** depending on how they're invoked:

- Siri / Shortcuts / Spotlight invocations of an `AppShortcut` run the intent in
  the **app's** process (has `APIClient`, `Keychain`, `Services`, `Models`).
- **Interactive widget buttons** (`Button(intent:)`, iOS 17+) run the intent in
  the **widget extension's** process, which today compiles only `ios/Shared/*`
  and cannot see the app target's networking.

**Therefore:** any intent a widget button invokes must have its dependencies
compiled into the widget extension too. This project has no SPM deps (first-party
frameworks only), so the standard fix is shared **target membership** rather than
a new framework.

**Decision — introduce a shared "IntentCore" source set** compiled into both the
app and widget targets, containing exactly the code intents need:

- `APIClient.swift`, `Keychain.swift` (move into shared membership — verify no
  app-only dependency; if any, extract the minimal networking core).
- The Models the intents touch (`Quest`, `TaskInput`/`TaskUpdate`,
  `FocusPresetKey`, `BrainMode`, `UserStats`, and the result types those calls
  return).
- Thin service call-sites the intents use. To avoid pulling the entire `Service`
  layer into the extension, the intents call a small **`IntentActions`** helper
  (new, in IntentCore) that wraps just the handful of endpoints needed
  (`completeQuest(id:)`, `startFocus(preset:)`, `stats()`, `brainCheckin(mode:)`,
  `todaysQuests()`, `momentumNext()`). App-process Siri intents call the same
  helper, so there is **one** implementation per action.

This keeps a single code path for both processes and bounds how much compiles
into the extension. The `AddQuestIntent` file and `FocusQuestShortcuts` stay in
the app target (Siri-only), but the shared action intents live in IntentCore.

> Risk note: moving `APIClient`/`Keychain` into shared membership is the
> highest-risk part of the foundation. Phase 1 verifies **both** targets still
> build before any intent work proceeds.

---

## Phase 1 — Foundation: shared data + Quest entity + IntentCore

### 1a. `WidgetSnapshot` v2

Extend the snapshot (new key `widget.snapshot.v2`) with the fields interactive
widgets and result dialogs need:

```
var nextQuestId: Int?          // target for the widget "complete" button / default complete
var topQuests: [SnapshotQuest] // up to 4: { id, title, completed } for the list widget
var coins: Int
var activeFocus: Bool          // a focus session is running (drives widget state)
// (existing fields retained)
```

`WidgetSharedStore.read()` migrates: decode v2; if absent, decode legacy v1 and
map (new fields default to `nil`/`[]`/`0`/`false`). `write()` unchanged in shape.
`TodayView.publishWidgetSnapshot()` populates the new fields from `quests` /
`stats` / `momentum`.

### 1b. `QuestEntity` + `QuestEntityQuery`

`AppEntity` with `id: Int`, `title: String`, `TypeDisplayRepresentation`
"Quest", and `DisplayRepresentation(title:)`. `EntityQuery`:

- `entities(for ids:)` → fetch via `QuestService.list()` filtered by id (or a
  per-id lookup), authed with the Keychain token.
- `suggestedEntities()` → today's **incomplete** quests (`QuestService.list()`),
  so Siri/Shortcuts show a live picker.

### 1c. IntentCore shared membership

Create the shared source set described above; make both targets build. Add
`IntentActions` helper with the wrapped endpoints. No behavior change yet —
`AddQuestIntent` continues to work unchanged.

**Phase 1 done when:** app + widget extension both build clean; a temporary unit
or manual check confirms v1→v2 snapshot migration and `QuestEntityQuery`
suggestions return live quests on the simulator.

---

## Phase 2 — Siri App Intents (background-first)

New intents (in IntentCore where widget-shared, else app target), all following
the token-load → `IntentActions` → `ProvidesDialog` pattern:

1. **`StartFocusIntent`** — `@Parameter var preset: FocusPresetOption` (an
   `AppEnum` mapping to `FocusPresetKey`: Classic / Deep Work / Short). Pure
   background: `IntentActions.startFocus(preset:)`, set `activeFocus` in the
   snapshot, speak e.g. "Started a Deep Work focus session." `openAppWhenRun =
   false`.
2. **`CompleteQuestIntent`** — `@Parameter var quest: QuestEntity?`. If provided,
   complete that id; if `nil`, complete `IntentActions.momentumNext()`. Speak XP
   and any level-up from the completion result. Background.
3. **`CheckStatsIntent`** — read-only; `IntentActions.stats()`; speak streak,
   level + name, and today's `completed/total`. Background. Optional snippet view.
4. **`BrainCheckInIntent`** — `@Parameter var mode: BrainModeOption` (`AppEnum`
   over `BrainMode`); `IntentActions.brainCheckin(mode:)`; speak confirmation.
   Background.

**`FocusQuestShortcuts`** gains an `AppShortcut` per intent with natural,
parameterized phrases, e.g.:

- "Start a focus session in `applicationName`", "Start deep work in `applicationName`"
- "Complete a quest in `applicationName`", "Mark `\(.$quest)` done in `applicationName`"
- "What's my streak in `applicationName`", "Check my `applicationName` stats"
- "Log my focus in `applicationName`"

Each with `shortTitle` + `systemImageName`. This also surfaces them in Spotlight
and the Shortcuts app (Front-most polish item covered here).

### Start Focus background reconciliation

Because the intent does not open the app, no Live Activity/timer starts at intent
time. The server session exists (`FocusService.active()` returns it). On next
foreground the app already calls the active-session path; confirm it adopts a
session it didn't start locally and offers to resume/show the timer. If the app
does **not** currently reconcile a server-started session, add that adoption in
this phase (small, in the Focus feature). The spoken result sets expectations:
"Started a focus session — open FocusQuest to run the timer."

**Phase 2 done when:** each intent runs from the Shortcuts app and via Siri on the
simulator against the real backend; completing via the quest picker and via
"next" both work; stats speak correctly.

---

## Phase 3 — Interactive buttons on existing widgets

iOS 17 `Button(intent:)` inside the existing widgets, replacing deep-link-only taps:

- **Home widget (small/medium):** a ✓ **Complete** button on the next quest
  (invokes `CompleteQuestIntent` with a `QuestEntity` built from
  `snapshot.nextQuestId`/title), and a **Start Focus** button (invokes
  `StartFocusIntent` with a default preset). Both refresh the timeline in place
  (`WidgetCenter` reload happens inside the shared write).
- Keep a `widgetURL` fallback for families that can't host buttons.
- **Lock-screen accessories:** accessory families support a limited interactive
  set; where allowed, a single Complete affordance, else remain deep-link.

The button intents are exactly the Phase 2 intents (now reachable from the
extension thanks to IntentCore) — no new logic.

**Phase 3 done when:** tapping Complete/Start Focus on the Home widget performs
the action without opening the app and the widget visibly updates on the
simulator.

---

## Phase 4 — New widget surfaces

- **Today's Quests list widget** (`.systemMedium` / `.systemLarge`): renders
  `snapshot.topQuests` (2 on medium, up to 4 on large), each row with an inline
  Complete button (Phase 3 intent). New `Widget` in the bundle.
- **Stats widget** (`.systemSmall` + `.accessoryRectangular`): level + name,
  streak, coins, today progress ring. Reuses the snapshot; no new intent.
- **Configurable widget** (`AppIntentConfiguration` + a `WidgetConfigurationIntent`):
  lets the user pick which the "Next/List" widget shows — e.g. category filter or
  momentum-next vs. first-pending. Backed by the snapshot's `topQuests`; if a
  filter needs data the snapshot lacks, extend the snapshot rather than fetching
  in the extension.

All new widgets registered in `FocusQuestWidgetBundle`.

**Phase 4 done when:** the new widgets appear in the gallery, render live snapshot
data, the list widget's per-row Complete works, and the configurable widget's
parameter changes what's shown — verified on the simulator.

---

## Data flow (after all phases)

```
App foreground / data change ──► TodayView.publishWidgetSnapshot()
      └─► WidgetSharedStore.write(v2)  ──► App Group  ──► WidgetKit reload
Widget render ◄── WidgetSharedStore.read() (migrating v1→v2)
Widget button / Siri phrase ──► App Intent.perform()
      └─► IntentActions.<action>()  ──► APIClient (Keychain token)  ──► REST API
             └─► update snapshot (activeFocus / completion) ──► reload
```

## Error handling

- No token in Keychain → spoken "Open FocusQuest and sign in first" (matches
  `AddQuestIntent`); widget buttons show the same via a failable result / no-op
  with a hint.
- Network/API failure → non-crashing spoken "Couldn't do that just now, try
  again"; widget button leaves state unchanged (next reload re-reads truth).
- Unknown/stale `nextQuestId` (already completed) → complete resolves gracefully
  (server idempotency / re-fetch next) rather than erroring.

## Testing / verification

Per repo rule, iOS changes are **built and run**, not just described:

- Each phase ends with `xcodebuild` of the app **and** widget extension targets
  (both must compile — the shared-membership move is the key risk) and a
  simulator run against the real backend, verifying that phase's "done when".
- Snapshot v2 migration gets a focused check (v1 payload → v2 read).
- No compiler warnings (project quality bar).

## Out of scope (YAGNI)

- Reflection-via-Siri (conversational; better in-app) — deferred.
- Widget-driven gear/party/world-boss actions — deferred; snapshot stays lean.
- watchOS / macOS widgets.
- Arbitrary-minute focus durations (presets are fixed server-side).

## Delivery

Phases are largely independent file sets; implementation will be sharded across
Sidequest executors by phase (Phase 1 foundation first as it unblocks 2–4), each
integrated only after its build+simulator verification passes.
