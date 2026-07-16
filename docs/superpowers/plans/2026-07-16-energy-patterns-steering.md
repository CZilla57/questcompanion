# Energy Patterns Steering Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 28-day pattern substrate act: boost "big swing" quests in the momentum ranking when the user is inside a power window, and offer a one-tap "save it for your window" reschedule on big-swing quests when they're outside it.

**Architecture:** Server owns the big-swing predicate (`api-server/src/lib/steering.ts`, exposed on every task as `bigSwing` via `formatTask`) and a power-window boost signal in `rankMomentum` (patterns loaded once per momentum call). Client owns the window math (`focusquest/src/lib/steering.ts`) fed by the cached `useGetMyPatterns` fetch, rendering a chip on task cards, a quick button in the reschedule popover, and a banner on the Today's Focus board. A `viaSteering` flag on task PATCH suppresses the forward-reschedule struggle signal.

**Tech Stack:** Express + Drizzle (api-server), React + react-query + orval-generated hooks (focusquest), openapi.yaml single source (`lib/api-spec`), vitest in both packages. No DB schema changes, no LLM.

**Spec:** `docs/superpowers/specs/2026-07-16-energy-patterns-steering-design.md`
**Branch:** `feat/act5-energy-steering` (already created from main @ 9d4cbc0)

## Global Constraints

- Confidence gate: every steering surface requires `confidence === "ok"` from `derivePatterns`; at `low`/`none` surfaces are absent (no teaser states).
- Boost-only: no quest is ever downranked, flagged, or grayed for being at the wrong hour.
- Mode beats clock: the momentum boost applies only in `focused`/`neutral`; the chip and banner are hidden in `frozen` mode.
- Steered reschedules (`viaSteering: true`) never increment `struggleScore`.
- Copy is invitation-shaped: "good time for a big swing", "save it for then?" — never "you should" / "you missed".
- Big swing = `difficulty === "hard" || priority === "high" || (estimatedMinutes ?? 0) >= 25` — defined ONCE server-side; the client reads `task.bigSwing`.
- Never hand-edit files under `lib/api-client-react/src/generated` or `lib/api-zod/src/generated` — regen with `pnpm --filter @workspace/api-spec codegen`.
- Windows repo: harmless `LF will be replaced by CRLF` warnings on commit are expected.
- End every commit message with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Server steering lib (pure)

**Files:**
- Create: `artifacts/api-server/src/lib/steering.ts`
- Test: `artifacts/api-server/src/lib/steering.test.ts`

**Interfaces:**
- Consumes: `struggleDeltaOnReschedule(existingDueDate: string | null, newDueDate: string): number` from `./difficulty` (existing).
- Produces: `isBigSwing(t: { difficulty: string; priority: string; estimatedMinutes: number | null }): boolean`; `inPowerWindow(localHour: number, powerHours: { hour: number }[]): boolean`; `rescheduleStruggleDelta(existingDueDate: string | null, newDueDate: string, viaSteering: boolean): number`. Tasks 2 and 4 import these exact names.

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/steering.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isBigSwing, inPowerWindow, rescheduleStruggleDelta } from "./steering";

describe("isBigSwing", () => {
  it("true for a hard difficulty rung", () => {
    expect(isBigSwing({ difficulty: "hard", priority: "low", estimatedMinutes: 5 })).toBe(true);
  });

  it("true for high priority", () => {
    expect(isBigSwing({ difficulty: "medium", priority: "high", estimatedMinutes: null })).toBe(true);
  });

  it("true at the 25-minute estimate floor", () => {
    expect(isBigSwing({ difficulty: "medium", priority: "low", estimatedMinutes: 25 })).toBe(true);
  });

  it("false below the floor with medium difficulty and priority", () => {
    expect(isBigSwing({ difficulty: "medium", priority: "medium", estimatedMinutes: 24 })).toBe(false);
  });

  it("false with no estimate and nothing else qualifying", () => {
    expect(isBigSwing({ difficulty: "easy", priority: "low", estimatedMinutes: null })).toBe(false);
  });
});

describe("inPowerWindow", () => {
  const HOURS = [{ hour: 9 }, { hour: 14 }, { hour: 21 }]; // non-contiguous is normal

  it("member hour is in the window", () => {
    expect(inPowerWindow(14, HOURS)).toBe(true);
  });

  it("non-member hour is not", () => {
    expect(inPowerWindow(10, HOURS)).toBe(false);
  });

  it("empty powerHours never matches", () => {
    expect(inPowerWindow(9, [])).toBe(false);
  });
});

describe("rescheduleStruggleDelta", () => {
  it("forward reschedule counts as struggle when not steered", () => {
    expect(rescheduleStruggleDelta("2026-07-10", "2026-07-12", false)).toBe(1);
  });

  it("steered forward reschedule is planning, not avoidance", () => {
    expect(rescheduleStruggleDelta("2026-07-10", "2026-07-12", true)).toBe(0);
  });

  it("backward reschedule never counts, steered or not", () => {
    expect(rescheduleStruggleDelta("2026-07-12", "2026-07-10", false)).toBe(0);
    expect(rescheduleStruggleDelta("2026-07-12", "2026-07-10", true)).toBe(0);
  });

  it("no existing date never counts", () => {
    expect(rescheduleStruggleDelta(null, "2026-07-12", false)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server test -- steering`
Expected: FAIL — cannot resolve `./steering`.

- [ ] **Step 3: Write minimal implementation**

Create `artifacts/api-server/src/lib/steering.ts`:

```ts
import { struggleDeltaOnReschedule } from "./difficulty";

/** A quest worth steering into a power window (spec: any of the three). */
export function isBigSwing(t: {
  difficulty: string;
  priority: string;
  estimatedMinutes: number | null;
}): boolean {
  return t.difficulty === "hard" || t.priority === "high" || (t.estimatedMinutes ?? 0) >= 25;
}

/** powerHours are the top-3 hours from derivePatterns and may be non-contiguous;
 * "in a window" is per-hour set membership, not a range. */
export function inPowerWindow(localHour: number, powerHours: { hour: number }[]): boolean {
  return powerHours.some((p) => p.hour === localHour);
}

/** Struggle delta for a reschedule. A steered reschedule (the "save it for your
 * power window" affordance) is planning, not avoidance — it never counts. */
export function rescheduleStruggleDelta(
  existingDueDate: string | null,
  newDueDate: string,
  viaSteering: boolean,
): number {
  return viaSteering ? 0 : struggleDeltaOnReschedule(existingDueDate, newDueDate);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server test -- steering`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/steering.ts artifacts/api-server/src/lib/steering.test.ts
git commit -m "feat(api): steering lib — big-swing predicate, window membership, steered struggle delta

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Momentum engine power-window boost

**Files:**
- Modify: `artifacts/api-server/src/lib/momentum.ts`
- Test: `artifacts/api-server/src/lib/momentum.test.ts`

**Interfaces:**
- Consumes: `isBigSwing` from `./steering` (Task 1).
- Produces: `MomentumTask` gains required `difficulty: string`; `MomentumContext` gains optional `powerHours?: readonly number[]` (plain local hours, already confidence-gated by the caller); new weight `WEIGHTS.powerWindowBigSwing: 15`; new signal `power_window` with reason `"You're usually strongest right now — good time for a big swing."`. Task 4's route wiring populates both new fields.

- [ ] **Step 1: Write the failing tests**

In `artifacts/api-server/src/lib/momentum.test.ts`, add `difficulty: "medium"` to the `task()` factory defaults (after `category: "admin",`):

```ts
    category: "admin",
    difficulty: "medium",
```

Then append this describe block at the end of the file (test context: the file's `ctx()` uses `localHour: 14`, mode `neutral`, all categories completed so variety is silent):

```ts
describe("power window steering", () => {
  const REASON = "You're usually strongest right now — good time for a big swing.";

  it("boosts a big swing over a small quest inside the window", () => {
    const big = task({ estimatedMinutes: 45 });
    const small = task({ estimatedMinutes: 5 });
    const ranked = rankMomentum([small, big], ctx({ powerHours: [14] }));
    expect(ranked[0]!.taskId).toBe(big.id);
    expect(ranked[0]!.reason).toBe(REASON);
  });

  it("all three big-swing qualifiers trigger the boost", () => {
    for (const overrides of [
      { difficulty: "hard" },
      { priority: "high" },
      { estimatedMinutes: 25 },
    ]) {
      const big = task(overrides);
      const inWindow = rankMomentum([big], ctx({ powerHours: [14] }))[0]!.score;
      const outside = rankMomentum([big], ctx())[0]!.score;
      expect(inWindow).toBe(outside + 15);
    }
  });

  it("no boost outside the window — and no penalty either (boost-only)", () => {
    const big = task({ estimatedMinutes: 45 });
    const inOther = rankMomentum([big], ctx({ powerHours: [9] }))[0]!.score; // now is 14
    const without = rankMomentum([big], ctx())[0]!.score;
    expect(inOther).toBe(without);
  });

  it("never pressures frozen or distracted brains", () => {
    const big = task({ estimatedMinutes: 45, priority: "high", difficulty: "hard" });
    for (const mode of ["frozen", "distracted"] as const) {
      const withWindow = rankMomentum([big], ctx({ mode, powerHours: [14] }))[0]!;
      const without = rankMomentum([big], ctx({ mode }))[0]!;
      expect(withWindow.score).toBe(without.score);
      expect(withWindow.reason).not.toBe(REASON);
    }
  });

  it("boost applies in focused mode too", () => {
    const big = task({ estimatedMinutes: 45 });
    const inWindow = rankMomentum([big], ctx({ mode: "focused", powerHours: [14] }))[0]!.score;
    const outside = rankMomentum([big], ctx({ mode: "focused" }))[0]!.score;
    expect(inWindow).toBe(outside + 15);
  });

  it("an eligible pin still structurally outranks a boosted big swing", () => {
    const pinned = task({ isDailyFocus: true, focusDate: TODAY, estimatedMinutes: 5 });
    const big = task({ estimatedMinutes: 45, priority: "high" });
    const ranked = rankMomentum([big, pinned], ctx({ powerHours: [14] }));
    expect(ranked[0]!.taskId).toBe(pinned.id);
  });

  it("undefined powerHours means no signal (route passes [] below confidence)", () => {
    const big = task({ estimatedMinutes: 45 });
    const a = rankMomentum([big], ctx({ powerHours: [] }))[0]!.score;
    const b = rankMomentum([big], ctx())[0]!.score;
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm --filter @workspace/api-server test -- momentum`
Expected: FAIL — `powerHours`/`difficulty` type errors and/or new assertions failing (existing tests still pass once the factory gains `difficulty`).

- [ ] **Step 3: Implement in `momentum.ts`**

Five edits:

(a) Import at top (after the `brain-mode` import):

```ts
import { isBigSwing } from "./steering";
```

(b) `MomentumTask` gains `difficulty` (after `category: string;`):

```ts
  category: string;
  difficulty: string;
```

(c) `MomentumContext` gains (after `completedTodayCategories`):

```ts
  completedTodayCategories: ReadonlySet<string>;
  /** Local hours that are power windows (top-3 from derivePatterns). The
   * caller confidence-gates: empty/undefined below "ok". */
  powerHours?: readonly number[];
```

(d) `WEIGHTS` gains (after `variety: 8,`):

```ts
  variety: 8,
  powerWindowBigSwing: 15,
```

(e) The `Signal` union gains `"power_window"`; `DOMINANCE` inserts it between `"distracted_short"` and `"focused_priority"`:

```ts
type Signal =
  | "pinned" | "minutes_fit" | "focused_priority" | "distracted_short"
  | "frozen_small" | "frozen_steps" | "hyperfocus_continue" | "power_window"
  | "morning" | "evening" | "age" | "past_due" | "variety";

const DOMINANCE: Signal[] = [
  "pinned", "minutes_fit", "frozen_small", "frozen_steps", "hyperfocus_continue",
  "distracted_short", "power_window", "focused_priority", "past_due", "age", "morning", "evening", "variety",
];
```

`reasonFor` gains a case (after `hyperfocus_continue`):

```ts
    case "power_window":       return "You're usually strongest right now — good time for a big swing.";
```

In `rankMomentum`, in the "Local time of day" section (after the `isEvening` block, before queue-age):

```ts
    // Personalized power window: boost-only, and mode beats clock — frozen and
    // distracted brains never get big-swing pressure.
    if (
      (ctx.mode === "focused" || ctx.mode === "neutral") &&
      ctx.powerHours?.includes(ctx.localHour) &&
      isBigSwing(t)
    ) {
      add("power_window", WEIGHTS.powerWindowBigSwing);
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workspace/api-server test -- momentum`
Expected: PASS — all existing momentum tests plus the 7 new ones.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/momentum.ts artifacts/api-server/src/lib/momentum.test.ts
git commit -m "feat(api): momentum power-window boost for big swings (focused/neutral only)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: API contract — `bigSwing` + `viaSteering` + codegen

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (Task schema ~line 2293, TaskUpdate schema ~line 2470)
- Regenerated (do not hand-edit): `lib/api-client-react/src/generated/**`, `lib/api-zod/src/generated/**`

**Interfaces:**
- Produces: generated `Task` type gains required `bigSwing: boolean`; generated `TaskUpdate` type gains optional `viaSteering?: boolean`. Tasks 4–7 rely on these.

- [ ] **Step 1: Edit the Task schema**

In `lib/api-spec/openapi.yaml`, the `Task:` schema's `required` list currently ends with `difficultyOfferable]`. Change it to end with `difficultyOfferable, bigSwing]`:

```yaml
      required: [id, userId, title, points, completed, dueDate, priority, createdAt, category, categoryLabel, steps, difficulty, difficultyOfferable, bigSwing]
```

Add the property right after the `difficultyOfferable` property block:

```yaml
        bigSwing:
          type: boolean
          description: True when this quest is a "big swing" (hard rung, high priority, or a 25+ minute estimate) — the kind steering routes into power windows
```

- [ ] **Step 2: Edit the TaskUpdate schema**

In the `TaskUpdate:` schema, add after the `questlineId` property block:

```yaml
        viaSteering:
          type: boolean
          description: True when this update came from a power-window steering affordance; skips the forward-reschedule struggle signal (planning, not avoidance). Never persisted.
```

- [ ] **Step 3: Regenerate clients**

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: exits 0; files under `lib/api-client-react/src/generated` and `lib/api-zod/src/generated` change (Task gains `bigSwing`, TaskUpdate gains `viaSteering`).

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. (The focusquest `momentum-board.test.ts` factory uses an `as Task` cast, so the new required field does not break it. The api-server does not consume the generated Task type.)

- [ ] **Step 5: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react lib/api-zod
git commit -m "feat(api-spec): Task.bigSwing + TaskUpdate.viaSteering for energy steering

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Server route wiring — formatTask, PATCH gate, momentum patterns load

**Files:**
- Modify: `artifacts/api-server/src/routes/tasks.ts` (formatTask ~line 52; PATCH body destructure ~line 377; struggle delta ~lines 420–422; import list ~line 17)
- Modify: `artifacts/api-server/src/routes/momentum.ts` (imports; tz resolution ~line 20; candidates map ~line 67; ranking context ~line 81)

**Interfaces:**
- Consumes: `isBigSwing`, `rescheduleStruggleDelta` from `../lib/steering` (Task 1); `MomentumContext.powerHours` + `MomentumTask.difficulty` (Task 2); `loadPatternInputs`, `resolveUserTimeZone` from `./patterns` and `derivePatterns` from `../lib/patterns` (all existing, from PR #47).
- Produces: every task JSON response carries `bigSwing`; `PATCH /tasks/:id` accepts `viaSteering`; momentum ranks with confidence-gated power hours and resolves tz as persisted `users.timezone` → query `tz` → UTC.

- [ ] **Step 1: `tasks.ts` — formatTask + viaSteering**

(a) Add to imports:

```ts
import { isBigSwing, rescheduleStruggleDelta } from "../lib/steering";
```

(b) In the line-17 import from `"../lib/difficulty"`, remove `struggleDeltaOnReschedule` (its only call site is replaced below — verify with a grep that no other usage remains in the file):

```ts
import { assembleLadder, snapshotMedium, needsVariantGeneration, evaluateDifficultyOffer, toOfferInput } from "../lib/difficulty";
```

(c) In `formatTask`, after the `difficultyOfferable` line:

```ts
    difficultyOfferable: opts.difficultyOfferable ?? false,
    bigSwing: isBigSwing(task),
```

(d) In the PATCH handler's body destructure (~line 377), add `viaSteering`:

```ts
  const { title, description, dueDate, dueTime, priority, estimatedMinutes, actualMinutes, category, isAnchored, questlineId, viaSteering } = req.body as {
    ...
    questlineId?: number | null;
    viaSteering?: boolean;
  };
```

(e) Replace the two struggle-delta lines inside `if (dueDate != null) {` (currently `const rescheduleDelta = struggleDeltaOnReschedule(existing.dueDate, dueDate);`):

```ts
    // Pushing an incomplete quest to a later day is a silent "I keep avoiding this" —
    // unless the user is steering it into a power window, which is planning.
    const rescheduleDelta = rescheduleStruggleDelta(existing.dueDate, dueDate, viaSteering === true);
    if (rescheduleDelta > 0) updates.struggleScore = existing.struggleScore + rescheduleDelta;
```

- [ ] **Step 2: `momentum.ts` route — patterns + tz**

(a) Replace the `resolveTimeZone` import usage. Change imports:

```ts
import { localDateKey, localHour } from "../lib/date-buckets";
import { derivePatterns } from "../lib/patterns";
import { loadPatternInputs, resolveUserTimeZone } from "./patterns";
```

(`resolveTimeZone` is no longer imported — it was only used for the query param.)

(b) Replace `const tz = resolveTimeZone(String(req.query.tz ?? ""));` with:

```ts
  // Persisted users.timezone beats the query param beats UTC — same resolution
  // as the patterns route, so windows and ranking agree on the user's clock.
  const tz = await resolveUserTimeZone(userId, req.query.tz);
```

(c) After `const state = deriveBrainState(latest, now, tz);`, load the patterns (confidence-gated to hours):

```ts
  // One substrate load per momentum call (compute-on-read, PR #47). Below "ok"
  // confidence steering is absent entirely: empty hours = no signal.
  const patterns = derivePatterns(await loadPatternInputs(userId, tz, now));
  const powerHours = patterns.confidence === "ok" ? patterns.powerHours.map((p) => p.hour) : [];
```

(d) In the `candidates` map, add `difficulty` (after `category: t.category,`):

```ts
        id: t.id, title: t.title, priority: t.priority, category: t.category,
        difficulty: t.difficulty,
```

(e) Pass `powerHours` into the ranking context:

```ts
  const ranked = rankMomentum(candidates, {
    mode: state.mode, minutes, now,
    localHour: localHour(now, tz), todayStr, completedTodayCategories,
    powerHours,
  });
```

- [ ] **Step 3: Run the api-server suite + typecheck**

Run: `pnpm --filter @workspace/api-server test`
Expected: PASS (all suites).
Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/tasks.ts artifacts/api-server/src/routes/momentum.ts
git commit -m "feat(api): expose bigSwing, honor viaSteering, rank momentum with power hours

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Client steering lib (pure)

**Files:**
- Create: `artifacts/focusquest/src/lib/steering.ts`
- Modify: `artifacts/focusquest/src/lib/rhythms.ts` (export the private `hourLabel`)
- Test: `artifacts/focusquest/src/lib/steering.test.ts`

**Interfaces:**
- Consumes: `hourLabel(h: number): string` from `./rhythms` (exported in this task); `PatternSummary`, `Task`, `BrainMode` types from `@workspace/api-client-react` (Task 3 added `Task.bigSwing`).
- Produces: `PowerWindowSlot { dueDate: string; dueTime: string; label: string }`; `nextPowerWindowSlot(now: Date, powerHours: { hour: number }[]): PowerWindowSlot | null`; `inWindowNow(now: Date, powerHours: { hour: number }[]): boolean`; `showSteeringChip(task, patterns, now, mode): boolean`. Tasks 6–7 import these exact names.

- [ ] **Step 1: Export `hourLabel` from rhythms**

In `artifacts/focusquest/src/lib/rhythms.ts`, change `function hourLabel(h: number): string {` to:

```ts
export function hourLabel(h: number): string {
```

- [ ] **Step 2: Write the failing tests**

Create `artifacts/focusquest/src/lib/steering.test.ts`. Note: `now` is constructed with the local-time constructor so tests are timezone-independent (the lib derives "today" from the `now` argument, never the system clock):

```ts
import { describe, it, expect } from "vitest";
import type { PatternSummary, Task, BrainMode } from "@workspace/api-client-react";
import { nextPowerWindowSlot, inWindowNow, showSteeringChip } from "./steering";

// Wed 2026-07-15, 14:30 local.
const NOW = new Date(2026, 6, 15, 14, 30);
const HOURS = [{ hour: 9 }, { hour: 16 }, { hour: 21 }];

function patterns(overrides: Partial<PatternSummary> = {}): PatternSummary {
  return { confidence: "ok", powerHours: HOURS, ...overrides } as PatternSummary;
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    bigSwing: true,
    completed: false,
    isAnchored: false,
    dueDate: null,
    ...overrides,
  } as Task;
}

describe("nextPowerWindowSlot", () => {
  it("picks the nearest window later today", () => {
    expect(nextPowerWindowSlot(NOW, HOURS)).toEqual({
      dueDate: "2026-07-15",
      dueTime: "16:00",
      label: "4pm",
    });
  });

  it("is strictly after the current hour — 14:30 does not pick a 14 window", () => {
    expect(nextPowerWindowSlot(NOW, [{ hour: 14 }, { hour: 21 }])).toEqual({
      dueDate: "2026-07-15",
      dueTime: "21:00",
      label: "9pm",
    });
  });

  it("rolls over to tomorrow's earliest window when today is exhausted", () => {
    const late = new Date(2026, 6, 15, 22, 5);
    expect(nextPowerWindowSlot(late, HOURS)).toEqual({
      dueDate: "2026-07-16",
      dueTime: "09:00",
      label: "9am tomorrow",
    });
  });

  it("zero-pads morning dueTime", () => {
    const dawn = new Date(2026, 6, 15, 5, 0);
    expect(nextPowerWindowSlot(dawn, HOURS)!.dueTime).toBe("09:00");
  });

  it("null for empty powerHours", () => {
    expect(nextPowerWindowSlot(NOW, [])).toBeNull();
  });
});

describe("inWindowNow", () => {
  it("true when the current local hour is a power hour", () => {
    expect(inWindowNow(new Date(2026, 6, 15, 16, 45), HOURS)).toBe(true);
  });
  it("false otherwise", () => {
    expect(inWindowNow(NOW, HOURS)).toBe(false);
  });
});

describe("showSteeringChip", () => {
  const neutral = "neutral" as BrainMode;

  it("shows for an unscheduled big swing outside the window, confidence ok", () => {
    expect(showSteeringChip(task(), patterns(), NOW, neutral)).toBe(true);
  });

  it("shows for a past-due and a due-today big swing", () => {
    expect(showSteeringChip(task({ dueDate: "2026-07-10" }), patterns(), NOW, neutral)).toBe(true);
    expect(showSteeringChip(task({ dueDate: "2026-07-15" }), patterns(), NOW, neutral)).toBe(true);
  });

  it("never pulls a future-dated quest earlier", () => {
    expect(showSteeringChip(task({ dueDate: "2026-07-20" }), patterns(), NOW, neutral)).toBe(false);
  });

  it("hidden below ok confidence and with empty hours", () => {
    expect(showSteeringChip(task(), patterns({ confidence: "low" }), NOW, neutral)).toBe(false);
    expect(showSteeringChip(task(), patterns({ confidence: "none" }), NOW, neutral)).toBe(false);
    expect(showSteeringChip(task(), patterns({ powerHours: [] }), NOW, neutral)).toBe(false);
    expect(showSteeringChip(task(), undefined, NOW, neutral)).toBe(false);
  });

  it("hidden for non-big-swing, completed, and anchored quests", () => {
    expect(showSteeringChip(task({ bigSwing: false }), patterns(), NOW, neutral)).toBe(false);
    expect(showSteeringChip(task({ completed: true }), patterns(), NOW, neutral)).toBe(false);
    expect(showSteeringChip(task({ isAnchored: true }), patterns(), NOW, neutral)).toBe(false);
  });

  it("hidden inside the window — that's momentum's moment", () => {
    const inWindow = new Date(2026, 6, 15, 16, 10);
    expect(showSteeringChip(task(), patterns(), inWindow, neutral)).toBe(false);
  });

  it("hidden in frozen mode (pressure-free), visible when mode is unknown", () => {
    expect(showSteeringChip(task(), patterns(), NOW, "frozen" as BrainMode)).toBe(false);
    expect(showSteeringChip(task(), patterns(), NOW, undefined)).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @workspace/focusquest test -- steering`
Expected: FAIL — cannot resolve `./steering`.

- [ ] **Step 4: Write the implementation**

Create `artifacts/focusquest/src/lib/steering.ts`:

```ts
import { addDays, format, startOfDay } from "date-fns";
import type { PatternSummary, Task, BrainMode } from "@workspace/api-client-react";
import { hourLabel } from "./rhythms";

export interface PowerWindowSlot {
  dueDate: string;
  dueTime: string;
  label: string;
}

/** Nearest power hour strictly after `now`'s hour today, else the earliest
 * power hour tomorrow. "Today" derives from the `now` argument (never the
 * system clock) so the math is testable and DST-indifferent. */
export function nextPowerWindowSlot(
  now: Date,
  powerHours: { hour: number }[],
): PowerWindowSlot | null {
  const hours = [...new Set(powerHours.map((p) => p.hour))].sort((a, b) => a - b);
  if (hours.length === 0) return null;
  const todayNext = hours.find((h) => h > now.getHours());
  const hour = todayNext ?? hours[0]!;
  const day = todayNext !== undefined ? startOfDay(now) : addDays(startOfDay(now), 1);
  return {
    dueDate: format(day, "yyyy-MM-dd"),
    dueTime: `${String(hour).padStart(2, "0")}:00`,
    label: todayNext !== undefined ? hourLabel(hour) : `${hourLabel(hour)} tomorrow`,
  };
}

/** Is `now` inside a power window? (Per-hour membership; hours may be non-contiguous.) */
export function inWindowNow(now: Date, powerHours: { hour: number }[]): boolean {
  return powerHours.some((p) => p.hour === now.getHours());
}

/** Chip gate (spec §Client): big swing, confidence ok, OUTSIDE the window
 * (in-window is momentum's moment), unscheduled/today/past-due only (never
 * pulls a deliberately future-dated quest earlier), never completed/anchored,
 * and never under a frozen brain (pressure-free). */
export function showSteeringChip(
  task: Pick<Task, "bigSwing" | "completed" | "isAnchored" | "dueDate">,
  patterns: PatternSummary | undefined,
  now: Date,
  mode: BrainMode | undefined,
): boolean {
  if (!patterns || patterns.confidence !== "ok" || patterns.powerHours.length === 0) return false;
  if (!task.bigSwing || task.completed || task.isAnchored) return false;
  if (mode === "frozen") return false;
  if (inWindowNow(now, patterns.powerHours)) return false;
  const todayStr = format(startOfDay(now), "yyyy-MM-dd");
  return task.dueDate == null || task.dueDate <= todayStr;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @workspace/focusquest test -- steering`
Expected: PASS (14 tests). Also run `pnpm --filter @workspace/focusquest test -- rhythms` — Expected: PASS (the export change is behavior-neutral).

- [ ] **Step 6: Commit**

```bash
git add artifacts/focusquest/src/lib/steering.ts artifacts/focusquest/src/lib/steering.test.ts artifacts/focusquest/src/lib/rhythms.ts
git commit -m "feat(web): client steering lib — next-window slot math + chip gate

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Task card chip + reschedule popover button

**Files:**
- Modify: `artifacts/focusquest/src/components/task-item.tsx` (imports ~lines 1–20; component body after `handleReschedule` ~line 243; metadata row ~line 335; reschedule popover ~line 456)

**Interfaces:**
- Consumes: `showSteeringChip`, `nextPowerWindowSlot`, `PowerWindowSlot` from `@/lib/steering` (Task 5); `useGetMyPatterns`, `useGetBrainState` hooks and the `viaSteering` field on TaskUpdate (Task 3); existing `updateMutation` (`useUpdateTask`), `toast`, query-key invalidation helpers already imported in the file.
- Produces: user-visible chip + popover quick button. No new exports.

- [ ] **Step 1: Add imports and data hooks**

(a) Extend the `@workspace/api-client-react` import (line 4) with `useGetMyPatterns, useGetBrainState`:

```ts
import { Task, TaskPriority, useCompleteTask, useDeleteTask, usePatchTaskFocus, useUncompleteTask, useUpdateTask, useGetMyStats, useGetMyPatterns, useGetBrainState } from "@workspace/api-client-react";
```

(b) Add below the reschedule import (line 18):

```ts
import { showSteeringChip, nextPowerWindowSlot, type PowerWindowSlot } from "@/lib/steering";
```

(c) Inside `TaskItem`, after the `const { data: stats } = useGetMyStats(...)` line (react-query dedupes these across the many TaskItem instances — same keys as the rhythms card and brain-mode chip):

```ts
  const { data: patterns } = useGetMyPatterns({ tz: browserTimeZone() });
  const { data: brainState } = useGetBrainState({ tz: browserTimeZone() });
```

- [ ] **Step 2: Add the steer handler and slot values**

After `handleReschedule` (~line 243), add:

```ts
  // Power-window steering (spec: docs/superpowers/specs/2026-07-16-energy-patterns-steering-design.md).
  // Chip: big swings only. Popover quick button: any quest, same confidence gate.
  const steeringOk = patterns?.confidence === "ok" && patterns.powerHours.length > 0;
  const powerSlot: PowerWindowSlot | null = steeringOk
    ? nextPowerWindowSlot(new Date(), patterns!.powerHours)
    : null;
  const chipSlot: PowerWindowSlot | null =
    powerSlot && showSteeringChip(task, patterns, new Date(), brainState?.mode) ? powerSlot : null;

  const handleSteer = (slot: PowerWindowSlot) => {
    if (updateMutation.isPending) return;
    updateMutation.mutate(
      { id: task.id, data: { dueDate: slot.dueDate, dueTime: slot.dueTime, viaSteering: true } },
      {
        onSuccess: () => {
          setRescheduleOpen(false);
          queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetTasksMomentumQueryKey() });
          toast({ title: `Saved for your power window — ${slot.label} ⚡`, className: "border-primary" });
        },
        onError: (err: any) => {
          toast({ title: apiErrorMessage(err, "Could not reschedule quest"), variant: "destructive" });
        },
      },
    );
  };
```

- [ ] **Step 3: Render the chip in the metadata row**

In the metadata row (`<div className="flex items-center gap-3 mt-2 flex-wrap">`), after the category `span` block (~line 339), add:

```tsx
          {chipSlot && (
            <button
              type="button"
              onClick={() => handleSteer(chipSlot)}
              disabled={updateMutation.isPending}
              title="Reschedule into your power window"
              className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
            >
              <Zap className="w-2.5 h-2.5" />
              Best around {chipSlot.label} — save it for then?
            </button>
          )}
```

(`Zap` is already imported from lucide-react in this file.)

- [ ] **Step 4: Add the popover quick button**

Inside the reschedule `PopoverContent`'s `<div className="flex flex-col gap-2">`, after the Today/Tomorrow/Next week `<div className="flex gap-2">…</div>` row and before the `<Calendar`, add:

```tsx
                {powerSlot && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => handleSteer(powerSlot)}
                    disabled={updateMutation.isPending}
                  >
                    <Zap className="w-3 h-3 mr-1" />
                    Power window ({powerSlot.label})
                  </Button>
                )}
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter @workspace/focusquest test`
Expected: PASS (all suites).
Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/focusquest/src/components/task-item.tsx
git commit -m "feat(web): power-window steering chip + reschedule quick button

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Power-window banner on the Today's Focus board

**Files:**
- Modify: `artifacts/focusquest/src/pages/tasks.tsx` (imports ~lines 4, 21; board IIFE ~lines 382–445)

**Interfaces:**
- Consumes: `useGetMyPatterns` (Task 3); `inWindowNow` from `@/lib/steering` (Task 5); `formatPowerHours` from `@/lib/rhythms` (existing); the page's existing `momentum?.mode` and `tz`.
- Produces: user-visible banner line. No new exports.

- [ ] **Step 1: Imports and data**

(a) Extend the `@workspace/api-client-react` import (line 4) with `useGetMyPatterns`.

(b) Add lib imports near line 21:

```ts
import { inWindowNow } from "@/lib/steering";
import { formatPowerHours } from "@/lib/rhythms";
```

(c) Check the lucide-react import in this file: if `Zap` is not already imported, add it.

(d) In the component near the `useGetTasksMomentum` call (~line 145):

```ts
  const { data: patterns } = useGetMyPatterns({ tz });
```

- [ ] **Step 2: Render the banner**

Inside the board IIFE, after `const flavor = ...` (~line 384), compute:

```tsx
        // Power-window banner: confidence-gated, hidden for frozen brains, only
        // while the current hour actually is a window (spec §Client).
        const showPowerBanner =
          patterns?.confidence === "ok" &&
          inWindowNow(new Date(), patterns.powerHours) &&
          momentum?.mode !== BrainMode.frozen;
        const powerBanner = showPowerBanner ? (
          <p className="text-xs text-primary mb-1 flex items-center gap-1">
            <Zap className="w-3 h-3" aria-hidden />
            {formatPowerHours(patterns!.powerHours)} — your power window
          </p>
        ) : null;
```

In the `"suggesting"` branch's JSX (the final `return` of the IIFE), render it directly above the flavor line:

```tsx
            {powerBanner}
            {flavor && <p className="text-xs text-muted-foreground mb-3">{flavor}</p>}
```

Do NOT add it to the `empty` or `all-done` branches — all-done is wind-down, not a push for more.

- [ ] **Step 3: Verify**

Run: `pnpm --filter @workspace/focusquest test`
Expected: PASS.
Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add artifacts/focusquest/src/pages/tasks.tsx
git commit -m "feat(web): power-window banner on Today's Focus board

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Full verification + PR

**Files:** none new — verification and delivery only.

- [ ] **Step 1: Full test pass**

Run all three suites and the typecheck gate:

```bash
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/focusquest test
pnpm --filter @workspace/quick-add test
pnpm typecheck
```

Expected: all PASS.

- [ ] **Step 2: Runtime smoke via dev preview**

Start the dev server (`.claude/launch.json` config) and verify with the browser tools:

- `GET /api/tasks` response items include `bigSwing` (boolean).
- `GET /api/tasks/momentum` returns 200 with suggestions (patterns load doesn't error on a fresh user — empty inputs are valid).
- Task list renders; if the seeded user's patterns are below `ok` confidence, confirm NO chip/banner renders (the gate working is the observable).

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/act5-energy-steering
& "C:\Program Files\GitHub CLI\gh.exe" pr create --title "feat: Energy Patterns steering surface (Act V quest 2)" --body "<summary per repo convention, link spec doc, note invariants: confidence-gated ok-only, boost-only, mode-beats-clock, viaSteering skips struggle. 🤖 Generated with [Claude Code](https://claude.com/claude-code)>"
```

Expected: PR URL printed.

---

## Self-Review Notes (completed)

- **Spec coverage:** big-swing predicate → T1; momentum boost + mode gate + weight + DOMINANCE + reason → T2; `bigSwing`/`viaSteering` contract → T3; formatTask + PATCH gate + momentum route patterns/tz → T4; slot math + chip gate → T5; chip + popover button → T6; banner → T7. Spec's "dashboard momentum board" corrected: the Today's Focus board lives on the tasks page (`pages/tasks.tsx`) — banner lands there.
- **Type consistency:** `rescheduleStruggleDelta(existing, next, viaSteering)` (T1) used in T4; `MomentumTask.difficulty` + `MomentumContext.powerHours?: readonly number[]` (T2) populated in T4; `PowerWindowSlot`/`nextPowerWindowSlot`/`inWindowNow`/`showSteeringChip` (T5) consumed in T6/T7; `hourLabel` exported in T5 before use.
- **No placeholders:** every code step carries the actual code; every run step carries the exact command.
