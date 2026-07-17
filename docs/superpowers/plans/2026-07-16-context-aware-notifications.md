# Context-Aware Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy fixed-time reminder pass (`checkDueTasks`) with per-user, timezone-aware, pattern-timed push nudges — due-today / power-window / quick-win — under a strict anti-shame envelope (max 2/day, 7–22 local, 90-min spacing).

**Architecture:** House pattern (mirrors Hyperfocus Protection): a pure decision engine in `lib/context-nudges.ts` (`eligibleKinds` pre-gate + `selectContextNudge` authority, exhaustively unit-tested) + a thin `checkContextNudges()` per-user pass in `notification-scheduler.ts` + four dedup columns on `usersTable`. Patterns come from the existing `derivePatterns`/`loadPatternInputs` (PR #47); quest selection reuses `isBigSwing`/`inPowerWindow` from `steering.ts` (PR #48). No new API endpoints, no OpenAPI/orval changes, no client UI.

**Tech Stack:** TypeScript, Express (`@workspace/api-server`), Drizzle + Postgres (`@workspace/db`), web-push via the scheduler's `notify`, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-16-context-aware-notifications-design.md`

## Global Constraints

- **Anti-shame copy law:** no "warning", no guilt, quest titles quoted, real numbers only. Learned copy may claim a rhythm ("usually your strongest hour", "usually take you ~N min") **only** at `ok` confidence; default copy makes no pattern claims. Copy is fixed in Tasks 2–4 — do not reword.
- **Envelope (pure-function authority):** local hour in **[7, 22)**; **max 2** context nudges per user per local day; **each kind once** per local day; **≥ 90 min** since `contextNudgedAt`. Spacing is chronological and MAY suppress a later higher-priority kind — intended.
- **One nudge per tick** per user, priority `due_today` > `power_window` > `quick_win`.
- **Tunable consts live in one block** in `lib/context-nudges.ts`: `ENVELOPE_START=7`, `ENVELOPE_END=22`, `MAX_PER_DAY=2`, `SPACING_MIN=90`, `DUE_TODAY_HOUR=19`, `DEFAULT_POWER_HOUR=9`, `QUICK_WIN_START=16`, `QUICK_WIN_END=18`, `QUICK_WIN_MEDIAN_MAX=10`, `QUICK_WIN_MIN_COUNT=3`, `QUICK_WIN_ESTIMATE_MAX=10`.
- **Local-time correctness:** all timing uses `localHour(now, tz)` / `localDateKey(now, tz)` with `resolveTimeZone(user.timezone ?? "")` — **UTC fallback**, never skip tz-less users (these replace the core reminders; matches hero-care, NOT the reflection pass's skip rule).
- **Reuse, don't duplicate:** `loadPatternInputs` (`routes/patterns.ts` — already exported; `reflections.ts` imports it, precedent for scheduler→routes imports via `spawnRecurringTasksForToday`), `derivePatterns` (`lib/patterns.ts`), `isBigSwing`/`inPowerWindow` (`lib/steering.ts`), `notify` + per-user try/catch pass shape (`lib/notification-scheduler.ts`, follow `checkReflectionPrompts`).
- **Dedup write AFTER successful `notify()`** — a failed write risks one duplicate next tick; the accepted house tradeoff.
- **Test strategy (repo convention):** NO supertest harness, NO RTL/jsdom. Decision logic in pure `lib/*.ts` with unit tests; the scheduler pass is thin and verified by typecheck + full suite + boot. Do not add test infra.
- **`lib/db` composite-dist gotcha:** after a schema edit, run `pnpm run typecheck:libs` first if an api-server typecheck shows phantom missing-field errors.
- **Push tag/url:** every context nudge uses tag `context-nudge` and `data.url: "/"`.

**Test commands** (from repo root):
- api-server tests: `pnpm --filter @workspace/api-server test <filter>` · typecheck: `pnpm --filter @workspace/api-server typecheck`
- schema push (controller-run): `pnpm --filter @workspace/db push` (needs `DATABASE_URL` exported; drizzle.config does not load `.env`)

---

## File Structure

**Create:**
- `artifacts/api-server/src/lib/context-nudges.ts` — pure engine: consts, types, `eligibleKinds`, `selectContextNudge`.
- `artifacts/api-server/src/lib/context-nudges.test.ts`

**Modify:**
- `lib/db/src/schema/users.ts` — 4 columns.
- `artifacts/api-server/src/lib/notification-scheduler.ts` — delete `checkDueTasks()`, add `checkContextNudges()`, update `tick()`.

---

## Task 1: Schema — context-nudge dedup columns

**Files:** Modify `lib/db/src/schema/users.ts`

**Interfaces:**
- Produces columns on `usersTable`: `nudgeDueTodayDate` (`string | null`), `nudgePowerWindowDate` (`string | null`), `nudgeQuickWinDate` (`string | null`), `contextNudgedAt` (`Date | null`).

- [ ] **Step 1: Add the columns**

In `lib/db/src/schema/users.ts`, after `reflectionPromptedDate` (line 47), before `createdAt`:

```ts
  // Context-aware nudges (Act V q3): per-kind once-per-day dedup gates. Local-date
  // strings (YYYY-MM-DD); today's sent-count for the 2/day cap is derived by
  // comparing them to the user's localToday — no separate counter.
  nudgeDueTodayDate: text("nudge_due_today_date"),
  nudgePowerWindowDate: text("nudge_power_window_date"),
  nudgeQuickWinDate: text("nudge_quick_win_date"),
  // Instant of the last context nudge of any kind — enforces 90-min spacing.
  contextNudgedAt: timestamp("context_nudged_at"),
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @workspace/api-server typecheck`
Expected: PASS (run `pnpm run typecheck:libs` first if phantom missing-field errors appear).

- [ ] **Step 3: (Controller) push to Neon**

Controller runs `pnpm --filter @workspace/db push` (additive nullable columns; no data loss). Implementer: do NOT run this — note it as controller-run.

- [ ] **Step 4: Commit**

```bash
git add lib/db/src/schema/users.ts
git commit -m "feat(db): context-nudge dedup columns on users"
```

---

## Task 2: Pure engine — gates + due-today nudge

**Files:**
- Create: `artifacts/api-server/src/lib/context-nudges.ts`
- Test: `artifacts/api-server/src/lib/context-nudges.test.ts`

**Interfaces:**
- Consumes: `PatternSummary` type from `./patterns`; `isBigSwing`, `inPowerWindow` from `./steering` (used from Task 3 on).
- Produces (used by Tasks 3–5): all consts from Global Constraints; `type ContextNudgeKind = "due_today" | "power_window" | "quick_win"`; `interface ContextNudge { kind: ContextNudgeKind; title: string; body: string; tag: "context-nudge"; url: "/" }`; `interface OpenQuestLite { id: number; title: string; dueDate: string | null; category: string; estimatedMinutes: number | null; difficulty: string; priority: string }`; `interface NudgeGateState { now: Date; localHour: number; localToday: string; sentDates: { dueToday: string | null; powerWindow: string | null; quickWin: string | null }; contextNudgedAt: Date | null }`; `interface ContextNudgeInputs extends NudgeGateState { patterns: PatternSummary | null; openQuests: OpenQuestLite[] }`; `eligibleKinds(gate: NudgeGateState): ContextNudgeKind[]` (priority-ordered); `selectContextNudge(inputs: ContextNudgeInputs): ContextNudge | null`.

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/context-nudges.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  eligibleKinds, selectContextNudge,
  SPACING_MIN,
  type NudgeGateState, type ContextNudgeInputs, type OpenQuestLite,
} from "./context-nudges";

const NOW = new Date("2026-07-16T12:00:00Z"); // wall-clock time is irrelevant; localHour is supplied explicitly
const TODAY = "2026-07-16";
const minAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function gate(over: Partial<NudgeGateState> = {}): NudgeGateState {
  return {
    now: NOW, localHour: 10, localToday: TODAY,
    sentDates: { dueToday: null, powerWindow: null, quickWin: null },
    contextNudgedAt: null,
    ...over,
  };
}

function quest(over: Partial<OpenQuestLite> = {}): OpenQuestLite {
  return {
    id: 1, title: "Pay bills", dueDate: TODAY, category: "errands",
    estimatedMinutes: null, difficulty: "medium", priority: "medium",
    ...over,
  };
}

function inputs(over: Partial<ContextNudgeInputs> = {}): ContextNudgeInputs {
  return { ...gate(), patterns: null, openQuests: [quest()], ...over };
}

describe("eligibleKinds — global envelope", () => {
  it("is empty outside waking hours (6 and 22), non-empty at the 7 and 21 boundaries", () => {
    expect(eligibleKinds(gate({ localHour: 6 }))).toEqual([]);
    expect(eligibleKinds(gate({ localHour: 22 }))).toEqual([]);
    expect(eligibleKinds(gate({ localHour: 7 }))).toContain("power_window");
    expect(eligibleKinds(gate({ localHour: 21 }))).toContain("power_window");
  });

  it("is empty once 2 kinds have been sent today", () => {
    expect(eligibleKinds(gate({
      localHour: 19,
      sentDates: { dueToday: null, powerWindow: TODAY, quickWin: TODAY },
    }))).toEqual([]);
  });

  it("counts only TODAY's sends toward the cap", () => {
    expect(eligibleKinds(gate({
      sentDates: { dueToday: "2026-07-15", powerWindow: "2026-07-15", quickWin: null },
    }))).toContain("power_window");
  });

  it("enforces 90-min spacing: 89 min ago blocks, 91 min ago does not", () => {
    expect(eligibleKinds(gate({ contextNudgedAt: minAgo(SPACING_MIN - 1) }))).toEqual([]);
    expect(eligibleKinds(gate({ contextNudgedAt: minAgo(SPACING_MIN + 1) }))).toContain("power_window");
  });
});

describe("eligibleKinds — per-kind windows and dedup", () => {
  it("due_today only appears at hour 19", () => {
    expect(eligibleKinds(gate({ localHour: 18 }))).not.toContain("due_today");
    expect(eligibleKinds(gate({ localHour: 19 }))).toContain("due_today");
    expect(eligibleKinds(gate({ localHour: 20 }))).not.toContain("due_today");
  });

  it("quick_win only appears in [16, 18)", () => {
    expect(eligibleKinds(gate({ localHour: 15 }))).not.toContain("quick_win");
    expect(eligibleKinds(gate({ localHour: 16 }))).toContain("quick_win");
    expect(eligibleKinds(gate({ localHour: 17 }))).toContain("quick_win");
    expect(eligibleKinds(gate({ localHour: 18 }))).not.toContain("quick_win");
  });

  it("power_window appears at any envelope hour (learned hour unknown pre-patterns)", () => {
    expect(eligibleKinds(gate({ localHour: 7 }))).toContain("power_window");
    expect(eligibleKinds(gate({ localHour: 13 }))).toContain("power_window");
  });

  it("a kind already sent today drops out; others remain", () => {
    const kinds = eligibleKinds(gate({
      localHour: 19,
      sentDates: { dueToday: TODAY, powerWindow: null, quickWin: null },
    }));
    expect(kinds).not.toContain("due_today");
    expect(kinds).toContain("power_window");
  });

  it("returns kinds in priority order due_today > power_window > quick_win", () => {
    // hour 19 can never include quick_win; verify relative order of the other two.
    expect(eligibleKinds(gate({ localHour: 19 }))).toEqual(["due_today", "power_window"]);
    expect(eligibleKinds(gate({ localHour: 16 }))).toEqual(["power_window", "quick_win"]);
  });
});

describe("selectContextNudge — due_today", () => {
  it("fires at 19 with a singular body naming the quest", () => {
    const n = selectContextNudge(inputs({ localHour: 19, openQuests: [quest({ title: "Water plants" })] }));
    expect(n?.kind).toBe("due_today");
    expect(n?.title).toBe("Still time for a win 🌙");
    expect(n?.body).toBe("'Water plants' is due today and still open — one small push keeps the momentum. Daily bonus if you clear it!");
    expect(n?.tag).toBe("context-nudge");
    expect(n?.url).toBe("/");
  });

  it("fires at 19 with a plural count body", () => {
    const n = selectContextNudge(inputs({
      localHour: 19,
      openQuests: [quest({ id: 1 }), quest({ id: 2, title: "Dishes" })],
    }));
    expect(n?.body).toBe("2 quests due today are still open — even one keeps the momentum. Clear them all for the daily bonus!");
  });

  it("ignores anchored (null dueDate) and overdue quests for due_today", () => {
    const n = selectContextNudge(inputs({
      localHour: 19,
      openQuests: [quest({ dueDate: null }), quest({ id: 2, dueDate: "2026-07-15" })],
    }));
    expect(n?.kind).not.toBe("due_today");
  });

  it("returns null with no open quests at all", () => {
    expect(selectContextNudge(inputs({ localHour: 19, openQuests: [] }))).toBeNull();
  });

  it("returns null when spacing blocks, even with due-today quests waiting", () => {
    expect(selectContextNudge(inputs({ localHour: 19, contextNudgedAt: minAgo(30) }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server test context-nudges`
Expected: FAIL — cannot resolve `./context-nudges`.

- [ ] **Step 3: Write the implementation**

Create `artifacts/api-server/src/lib/context-nudges.ts`:

```ts
import type { PatternSummary } from "./patterns";

// Anti-shame envelope + per-kind windows (spec §3). All hours are the USER's
// local hours; the scheduler resolves them per user before calling in.
export const ENVELOPE_START = 7;
export const ENVELOPE_END = 22; // exclusive
export const MAX_PER_DAY = 2;
export const SPACING_MIN = 90;
export const DUE_TODAY_HOUR = 19;
export const DEFAULT_POWER_HOUR = 9;
export const QUICK_WIN_START = 16;
export const QUICK_WIN_END = 18; // exclusive — latest send (17:59) clears SPACING_MIN before hour 19
export const QUICK_WIN_MEDIAN_MAX = 10;
export const QUICK_WIN_MIN_COUNT = 3;
export const QUICK_WIN_ESTIMATE_MAX = 10;

export type ContextNudgeKind = "due_today" | "power_window" | "quick_win";

export interface ContextNudge {
  kind: ContextNudgeKind;
  title: string;
  body: string;
  tag: "context-nudge";
  url: "/";
}

export interface OpenQuestLite {
  id: number;
  title: string;
  dueDate: string | null; // YYYY-MM-DD; null = anchored
  category: string;
  estimatedMinutes: number | null;
  difficulty: string;
  priority: string;
}

export interface NudgeGateState {
  now: Date;
  localHour: number;
  localToday: string; // YYYY-MM-DD in the user's zone
  sentDates: { dueToday: string | null; powerWindow: string | null; quickWin: string | null };
  contextNudgedAt: Date | null;
}

export interface ContextNudgeInputs extends NudgeGateState {
  patterns: PatternSummary | null;
  /** completed == false AND (dueDate <= localToday OR dueDate IS NULL) — caller-filtered. */
  openQuests: OpenQuestLite[];
}

/**
 * Which kinds could still fire this tick, in priority order — the scheduler's
 * cheap pre-gate (no patterns, no quest rows). selectContextNudge re-runs this;
 * it is the authority, this is the optimization.
 */
export function eligibleKinds(gate: NudgeGateState): ContextNudgeKind[] {
  const { localHour, localToday, sentDates, contextNudgedAt, now } = gate;
  if (localHour < ENVELOPE_START || localHour >= ENVELOPE_END) return [];
  const sentToday = [sentDates.dueToday, sentDates.powerWindow, sentDates.quickWin]
    .filter((d) => d === localToday).length;
  if (sentToday >= MAX_PER_DAY) return [];
  if (contextNudgedAt && (now.getTime() - contextNudgedAt.getTime()) / 60_000 < SPACING_MIN) return [];

  const kinds: ContextNudgeKind[] = [];
  if (sentDates.dueToday !== localToday && localHour === DUE_TODAY_HOUR) kinds.push("due_today");
  // The learned power hour is unknown until patterns load, so any envelope hour
  // qualifies here; selectContextNudge applies the real target hour.
  if (sentDates.powerWindow !== localToday) kinds.push("power_window");
  if (sentDates.quickWin !== localToday && localHour >= QUICK_WIN_START && localHour < QUICK_WIN_END) {
    kinds.push("quick_win");
  }
  return kinds;
}

function lowestId<T extends { id: number }>(quests: T[]): T | undefined {
  return quests.reduce<T | undefined>((best, q) => (!best || q.id < best.id ? q : best), undefined);
}

function dueTodayNudge(inputs: ContextNudgeInputs): ContextNudge | null {
  const due = inputs.openQuests.filter((q) => q.dueDate === inputs.localToday);
  if (due.length === 0) return null;
  const body = due.length === 1
    ? `'${due[0]!.title}' is due today and still open — one small push keeps the momentum. Daily bonus if you clear it!`
    : `${due.length} quests due today are still open — even one keeps the momentum. Clear them all for the daily bonus!`;
  return { kind: "due_today", title: "Still time for a win 🌙", body, tag: "context-nudge", url: "/" };
}

// Implemented in later tasks.
function powerWindowNudge(_inputs: ContextNudgeInputs): ContextNudge | null {
  return null;
}
function quickWinNudge(_inputs: ContextNudgeInputs): ContextNudge | null {
  return null;
}

/** At most ONE nudge per tick, or null. Pure; the full anti-shame envelope lives here. */
export function selectContextNudge(inputs: ContextNudgeInputs): ContextNudge | null {
  if (inputs.openQuests.length === 0) return null;
  for (const kind of eligibleKinds(inputs)) {
    const nudge =
      kind === "due_today" ? dueTodayNudge(inputs)
      : kind === "power_window" ? powerWindowNudge(inputs)
      : quickWinNudge(inputs);
    if (nudge) return nudge;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server test context-nudges`
Expected: PASS (all Task 2 tests).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/context-nudges.ts artifacts/api-server/src/lib/context-nudges.test.ts
git commit -m "feat(api): context-nudge engine — envelope gates + due-today kind"
```

---

## Task 3: Pure engine — power-window nudge

**Files:**
- Modify: `artifacts/api-server/src/lib/context-nudges.ts` (replace the `powerWindowNudge` stub)
- Test: `artifacts/api-server/src/lib/context-nudges.test.ts` (append)

**Interfaces:**
- Consumes: `isBigSwing(t: { difficulty: string; priority: string; estimatedMinutes: number | null }): boolean` and `inPowerWindow(localHour: number, powerHours: { hour: number }[]): boolean` from `./steering`; `PatternSummary.confidence` (`"none" | "low" | "ok"`) and `PatternSummary.powerHours` (`{ hour: number; score: number }[]`, sorted score desc then hour asc by `derivePatterns`).
- Produces: `powerWindowNudge` behavior inside `selectContextNudge` (no new exports).

- [ ] **Step 1: Write the failing tests**

Append to `artifacts/api-server/src/lib/context-nudges.test.ts`:

```ts
import type { PatternSummary } from "./patterns";

function patterns(over: Partial<PatternSummary> = {}): PatternSummary {
  return {
    windowDays: 28,
    sampleSize: { completions: 20, focusMinutes: 300, checkins: 5, reflections: 4 },
    confidence: "ok",
    powerHours: [{ hour: 14, score: 8 }, { hour: 9, score: 5 }, { hour: 20, score: 3 }],
    bestDay: null,
    medianQuestMinutes: null,
    categoryMinutes: [],
    modeByBlock: [],
    topHelpers: [],
    topBlockers: [],
    ...over,
  };
}

describe("selectContextNudge — power_window", () => {
  it("fires at the top learned power hour with learned copy at ok confidence", () => {
    const n = selectContextNudge(inputs({ localHour: 14, patterns: patterns() }));
    expect(n?.kind).toBe("power_window");
    expect(n?.title).toBe("Power window open ⚡");
    expect(n?.body).toBe("This is usually your strongest hour. 'Pay bills' would fit great right now.");
  });

  it("does NOT fire at a lower-scored power hour", () => {
    expect(selectContextNudge(inputs({ localHour: 20, patterns: patterns() }))).toBeNull();
  });

  it("falls back to 9:00 default with default copy below ok confidence", () => {
    const low = patterns({ confidence: "low" });
    expect(selectContextNudge(inputs({ localHour: 14, patterns: low }))).toBeNull();
    const n = selectContextNudge(inputs({ localHour: 9, patterns: low }));
    expect(n?.kind).toBe("power_window");
    expect(n?.title).toBe("Fresh start ☀️");
    expect(n?.body).toBe("'Pay bills' is ready when you are — mornings are for momentum.");
  });

  it("falls back to 9:00 default when patterns are null or powerHours empty", () => {
    expect(selectContextNudge(inputs({ localHour: 9, patterns: null }))?.kind).toBe("power_window");
    const empty = patterns({ powerHours: [] });
    expect(selectContextNudge(inputs({ localHour: 9, patterns: empty }))?.kind).toBe("power_window");
  });

  it("skips an out-of-envelope top hour and uses the next-best in-envelope power hour, still learned", () => {
    const night = patterns({ powerHours: [{ hour: 23, score: 9 }, { hour: 10, score: 4 }] });
    const n = selectContextNudge(inputs({ localHour: 10, patterns: night }));
    expect(n?.kind).toBe("power_window");
    expect(n?.title).toBe("Power window open ⚡");
    expect(selectContextNudge(inputs({ localHour: 23, patterns: night }))).toBeNull(); // envelope
  });

  it("uses the 9:00 default when ALL power hours are out of envelope", () => {
    const allNight = patterns({ powerHours: [{ hour: 23, score: 9 }, { hour: 2, score: 4 }] });
    const n = selectContextNudge(inputs({ localHour: 9, patterns: allNight }));
    expect(n?.title).toBe("Fresh start ☀️");
  });

  it("prefers the big-swing quest (hard difficulty), tie-broken by lowest id", () => {
    const quests = [
      quest({ id: 3, title: "Fold laundry" }),
      quest({ id: 5, title: "Write report", difficulty: "hard" }),
      quest({ id: 9, title: "Tax forms", difficulty: "hard" }),
    ];
    const n = selectContextNudge(inputs({ localHour: 14, patterns: patterns(), openQuests: quests }));
    expect(n?.body).toContain("'Write report'");
  });

  it("treats high priority and ≥25-min estimates as big swings too", () => {
    const byPriority = [quest({ id: 2 }), quest({ id: 4, title: "Call landlord", priority: "high" })];
    expect(selectContextNudge(inputs({ localHour: 14, patterns: patterns(), openQuests: byPriority }))?.body)
      .toContain("'Call landlord'");
    const byEstimate = [quest({ id: 2 }), quest({ id: 4, title: "Deep clean", estimatedMinutes: 30 })];
    expect(selectContextNudge(inputs({ localHour: 14, patterns: patterns(), openQuests: byEstimate }))?.body)
      .toContain("'Deep clean'");
  });

  it("falls back to the lowest-id open quest when nothing is a big swing", () => {
    const quests = [quest({ id: 7, title: "Water plants" }), quest({ id: 3, title: "Dishes" })];
    const n = selectContextNudge(inputs({ localHour: 14, patterns: patterns(), openQuests: quests }));
    expect(n?.body).toContain("'Dishes'");
  });

  it("counts anchored (null dueDate) quests as nudgeable", () => {
    const n = selectContextNudge(inputs({
      localHour: 14, patterns: patterns(),
      openQuests: [quest({ dueDate: null })],
    }));
    expect(n?.kind).toBe("power_window");
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm --filter @workspace/api-server test context-nudges`
Expected: FAIL — the new `power_window` tests get `null` from the stub; Task 2 tests still PASS.

- [ ] **Step 3: Implement `powerWindowNudge`**

In `artifacts/api-server/src/lib/context-nudges.ts`, add the steering import at the top:

```ts
import { isBigSwing, inPowerWindow } from "./steering";
```

Replace the `powerWindowNudge` stub with:

```ts
/** Learned target only at ok confidence; powerHours arrive sorted score desc,
 * hour asc, so the first in-envelope entry is the best eligible one. */
function powerWindowTarget(patterns: PatternSummary | null): { hour: number; learned: boolean } {
  if (!patterns || patterns.confidence !== "ok" || patterns.powerHours.length === 0) {
    return { hour: DEFAULT_POWER_HOUR, learned: false };
  }
  const best = patterns.powerHours.find((p) => p.hour >= ENVELOPE_START && p.hour < ENVELOPE_END);
  return best ? { hour: best.hour, learned: true } : { hour: DEFAULT_POWER_HOUR, learned: false };
}

function powerWindowNudge(inputs: ContextNudgeInputs): ContextNudge | null {
  const target = powerWindowTarget(inputs.patterns);
  if (!inPowerWindow(inputs.localHour, [{ hour: target.hour }])) return null;
  const quest = lowestId(inputs.openQuests.filter(isBigSwing)) ?? lowestId(inputs.openQuests);
  if (!quest) return null;
  return target.learned
    ? {
        kind: "power_window", title: "Power window open ⚡",
        body: `This is usually your strongest hour. '${quest.title}' would fit great right now.`,
        tag: "context-nudge", url: "/",
      }
    : {
        kind: "power_window", title: "Fresh start ☀️",
        body: `'${quest.title}' is ready when you are — mornings are for momentum.`,
        tag: "context-nudge", url: "/",
      };
}
```

Delete the now-unused `_inputs` stub parameter naming (the function above replaces the stub entirely).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workspace/api-server test context-nudges`
Expected: PASS (Tasks 2 + 3 tests).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/context-nudges.ts artifacts/api-server/src/lib/context-nudges.test.ts
git commit -m "feat(api): power-window context nudge — learned timing + big-swing pick"
```

---

## Task 4: Pure engine — quick-win nudge + cross-kind interactions

**Files:**
- Modify: `artifacts/api-server/src/lib/context-nudges.ts` (replace the `quickWinNudge` stub)
- Test: `artifacts/api-server/src/lib/context-nudges.test.ts` (append)

**Interfaces:**
- Consumes: `PatternSummary.categoryMinutes` (`{ category: string; medianActual: number; count: number }[]`).
- Produces: `quickWinNudge` behavior inside `selectContextNudge` (no new exports). Completes the engine.

- [ ] **Step 1: Write the failing tests**

Append to `artifacts/api-server/src/lib/context-nudges.test.ts`:

```ts
describe("selectContextNudge — quick_win", () => {
  const fastErrands = patterns({
    powerHours: [{ hour: 9, score: 5 }], // keep power_window away from hours 16–17
    categoryMinutes: [{ category: "errands", medianActual: 6, count: 4 }],
  });

  it("fires in [16,18) with learned category-median copy", () => {
    const n = selectContextNudge(inputs({ localHour: 16, patterns: fastErrands }));
    expect(n?.kind).toBe("quick_win");
    expect(n?.title).toBe("Quick win nearby ⏱️");
    expect(n?.body).toBe("'Pay bills' — errands quests usually take you ~6 min. Sneak it in before dinner?");
  });

  it("requires count ≥ 3: a 2-sample category falls through to the estimate branch", () => {
    const thin = patterns({
      powerHours: [{ hour: 9, score: 5 }],
      categoryMinutes: [{ category: "errands", medianActual: 6, count: 2 }],
    });
    const n = selectContextNudge(inputs({
      localHour: 16, patterns: thin,
      openQuests: [quest({ estimatedMinutes: 8 })],
    }));
    expect(n?.body).toBe("'Pay bills' is only ~8 min by your estimate. Sneak it in before dinner?");
  });

  it("requires median ≤ 10: a slow category does not qualify", () => {
    const slow = patterns({
      powerHours: [{ hour: 9, score: 5 }],
      categoryMinutes: [{ category: "errands", medianActual: 11, count: 5 }],
    });
    expect(selectContextNudge(inputs({ localHour: 16, patterns: slow }))).toBeNull();
  });

  it("picks the smallest category median across quests, tie-broken by lowest id", () => {
    const two = patterns({
      powerHours: [{ hour: 9, score: 5 }],
      categoryMinutes: [
        { category: "errands", medianActual: 6, count: 4 },
        { category: "self_care", medianActual: 4, count: 3 },
      ],
    });
    const n = selectContextNudge(inputs({
      localHour: 16, patterns: two,
      openQuests: [quest({ id: 1 }), quest({ id: 2, title: "Stretch break", category: "self_care" })],
    }));
    expect(n?.body).toContain("'Stretch break'");
    expect(n?.body).toContain("~4 min");
  });

  it("equal medians tie-break by lowest quest id", () => {
    const tied = patterns({
      powerHours: [{ hour: 9, score: 5 }],
      categoryMinutes: [
        { category: "errands", medianActual: 5, count: 4 },
        { category: "self_care", medianActual: 5, count: 3 },
      ],
    });
    const n = selectContextNudge(inputs({
      localHour: 16, patterns: tied,
      openQuests: [quest({ id: 8, category: "self_care", title: "Stretch break" }), quest({ id: 3 })],
    }));
    expect(n?.body).toContain("'Pay bills'");
  });

  it("estimate branch: fires only for estimates ≤ 10, lowest id first", () => {
    const none = patterns({ powerHours: [{ hour: 9, score: 5 }], categoryMinutes: [] });
    expect(selectContextNudge(inputs({
      localHour: 16, patterns: none,
      openQuests: [quest({ estimatedMinutes: 15 })],
    }))).toBeNull();
    const n = selectContextNudge(inputs({
      localHour: 16, patterns: none,
      openQuests: [quest({ id: 4, estimatedMinutes: 9 }), quest({ id: 2, title: "Take out trash", estimatedMinutes: 5 })],
    }));
    expect(n?.body).toBe("'Take out trash' is only ~5 min by your estimate. Sneak it in before dinner?");
  });

  it("null patterns → estimate branch still works", () => {
    const n = selectContextNudge(inputs({
      localHour: 17, patterns: null,
      openQuests: [quest({ estimatedMinutes: 7 })],
    }));
    expect(n?.kind).toBe("quick_win");
  });

  it("silent when neither branch qualifies", () => {
    expect(selectContextNudge(inputs({ localHour: 16, patterns: null }))).toBeNull();
  });
});

describe("selectContextNudge — cross-kind priority and spacing", () => {
  it("hour 19 collision: due_today beats a learned power hour of 19", () => {
    const nineteen = patterns({ powerHours: [{ hour: 19, score: 9 }] });
    const n = selectContextNudge(inputs({ localHour: 19, patterns: nineteen }));
    expect(n?.kind).toBe("due_today");
  });

  it("hour 19 with no due-today quests falls through to a learned power hour of 19", () => {
    const nineteen = patterns({ powerHours: [{ hour: 19, score: 9 }] });
    const n = selectContextNudge(inputs({
      localHour: 19, patterns: nineteen,
      openQuests: [quest({ dueDate: null })],
    }));
    expect(n?.kind).toBe("power_window");
  });

  it("power_window beats quick_win when the learned hour is 16", () => {
    const sixteen = patterns({
      powerHours: [{ hour: 16, score: 9 }],
      categoryMinutes: [{ category: "errands", medianActual: 6, count: 4 }],
    });
    const n = selectContextNudge(inputs({ localHour: 16, patterns: sixteen }));
    expect(n?.kind).toBe("power_window");
  });

  it("an 18:30 send suppresses due_today for all of hour 19 (chronological spacing)", () => {
    const n = selectContextNudge(inputs({ localHour: 19, contextNudgedAt: minAgo(30) }));
    expect(n).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm --filter @workspace/api-server test context-nudges`
Expected: FAIL — quick_win tests get `null` from the stub (cross-kind tests may partially pass); Tasks 2–3 tests still PASS.

- [ ] **Step 3: Implement `quickWinNudge`**

In `artifacts/api-server/src/lib/context-nudges.ts`, replace the `quickWinNudge` stub with:

```ts
function quickWinNudge(inputs: ContextNudgeInputs): ContextNudge | null {
  // Learned: this category reliably takes ≤10 real minutes (≥3 timed completions).
  if (inputs.patterns) {
    const fastCats = new Map(
      inputs.patterns.categoryMinutes
        .filter((c) => c.count >= QUICK_WIN_MIN_COUNT && c.medianActual <= QUICK_WIN_MEDIAN_MAX)
        .map((c) => [c.category, c.medianActual]),
    );
    const candidates = inputs.openQuests
      .filter((q) => fastCats.has(q.category))
      .sort((a, b) => fastCats.get(a.category)! - fastCats.get(b.category)! || a.id - b.id);
    const quest = candidates[0];
    if (quest) {
      const median = fastCats.get(quest.category)!;
      return {
        kind: "quick_win", title: "Quick win nearby ⏱️",
        body: `'${quest.title}' — ${quest.category} quests usually take you ~${median} min. Sneak it in before dinner?`,
        tag: "context-nudge", url: "/",
      };
    }
  }
  // Default: the user's own estimate says it's short.
  const quest = lowestId(
    inputs.openQuests.filter((q) => q.estimatedMinutes != null && q.estimatedMinutes <= QUICK_WIN_ESTIMATE_MAX),
  );
  if (!quest) return null;
  return {
    kind: "quick_win", title: "Quick win nearby ⏱️",
    body: `'${quest.title}' is only ~${quest.estimatedMinutes} min by your estimate. Sneak it in before dinner?`,
    tag: "context-nudge", url: "/",
  };
}
```

- [ ] **Step 4: Run the full engine test file**

Run: `pnpm --filter @workspace/api-server test context-nudges`
Expected: PASS (all Tasks 2–4 tests).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/context-nudges.ts artifacts/api-server/src/lib/context-nudges.test.ts
git commit -m "feat(api): quick-win context nudge + cross-kind priority tests"
```

---

## Task 5: Scheduler — replace checkDueTasks with checkContextNudges

**Files:**
- Modify: `artifacts/api-server/src/lib/notification-scheduler.ts`

**Interfaces:**
- Consumes: `eligibleKinds`, `selectContextNudge`, types from `./context-nudges` (Task 2–4); `loadPatternInputs` from `../routes/patterns`; `derivePatterns` from `./patterns`; columns from Task 1.
- Produces: `tick()`'s `ran[]` reports `"context-nudges"` instead of `"check-due-tasks"`. `sendDailySummary` untouched.

- [ ] **Step 1: Update imports**

In `artifacts/api-server/src/lib/notification-scheduler.ts`, extend the drizzle import (line 1) to include `or`, `isNull`, `lte`:

```ts
import { eq, and, gt, desc, gte, isNotNull, or, isNull, lte } from "drizzle-orm";
```

Add after the existing lib imports (below the `shouldPromptReflection` import, line 11):

```ts
import { eligibleKinds, selectContextNudge } from "./context-nudges";
import { derivePatterns } from "./patterns";
import { loadPatternInputs } from "../routes/patterns";
```

- [ ] **Step 2: Delete `checkDueTasks` and add `checkContextNudges`**

Delete the entire `checkDueTasks` function (lines 36–86: the 8:00 "Morning Quest Check", 12:00 "Midday Check-in", and 19:00 "Evening Quest Warning" blocks). Keep `sendDailySummary` untouched.

In its place, add:

```ts
async function checkContextNudges() {
  const now = new Date();
  const users = await db.select().from(usersTable);
  for (const user of users) {
    // One user's failure must not abort the pass; dedup gates make retries safe.
    try {
      const tz = resolveTimeZone(user.timezone ?? "");
      const localToday = localDateKey(now, tz);
      const gate = {
        now,
        localHour: localHour(now, tz),
        localToday,
        sentDates: {
          dueToday: user.nudgeDueTodayDate,
          powerWindow: user.nudgePowerWindowDate,
          quickWin: user.nudgeQuickWinDate,
        },
        contextNudgedAt: user.contextNudgedAt,
      };
      const kinds = eligibleKinds(gate);
      if (kinds.length === 0) continue;

      // Every kind needs an open quest — cheapest real query, gates the rest.
      const openQuests = await db
        .select({
          id: tasksTable.id,
          title: tasksTable.title,
          dueDate: tasksTable.dueDate,
          category: tasksTable.category,
          estimatedMinutes: tasksTable.estimatedMinutes,
          difficulty: tasksTable.difficulty,
          priority: tasksTable.priority,
        })
        .from(tasksTable)
        .where(and(
          eq(tasksTable.userId, user.id),
          eq(tasksTable.completed, false),
          or(isNull(tasksTable.dueDate), lte(tasksTable.dueDate, localToday)),
        ));
      if (openQuests.length === 0) continue;

      // due_today alone needs no patterns; skip the 4 pattern queries then.
      const needsPatterns = kinds.includes("power_window") || kinds.includes("quick_win");
      const patterns = needsPatterns
        ? derivePatterns(await loadPatternInputs(user.id, tz, now))
        : null;

      const nudge = selectContextNudge({ ...gate, patterns, openQuests });
      if (!nudge) continue;

      await notify(user.id, nudge.title, nudge.body, nudge.tag, { url: nudge.url });
      const dateColumn =
        nudge.kind === "due_today" ? { nudgeDueTodayDate: localToday }
        : nudge.kind === "power_window" ? { nudgePowerWindowDate: localToday }
        : { nudgeQuickWinDate: localToday };
      await db.update(usersTable)
        .set({ ...dateColumn, contextNudgedAt: now })
        .where(eq(usersTable.id, user.id));
    } catch (err) {
      logger.error({ err, userId: user.id }, "Context-nudge pass failed for user");
    }
  }
}
```

- [ ] **Step 3: Swap the pass in `tick()`**

In `tick()`, replace:

```ts
  await checkDueTasks();
  ran.push("check-due-tasks");
```

with:

```ts
  await checkContextNudges();
  ran.push("context-nudges");
```

- [ ] **Step 4: Verify nothing else references the legacy pass**

Run: `grep -rn "checkDueTasks\|check-due-tasks" artifacts/ lib/`
Expected: no matches.

- [ ] **Step 5: Typecheck + full api-server suite**

Run: `pnpm --filter @workspace/api-server typecheck`
Expected: PASS.

Run: `pnpm --filter @workspace/api-server test`
Expected: PASS — full suite, no regressions.

- [ ] **Step 6: Boot check**

Start the api server (background): `pnpm --filter @workspace/api-server dev`
Expected: startup/listen log line, no throw on module load (the new imports wire `routes/patterns` into the scheduler — this catches any circular-import surprise). Stop it after.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/lib/notification-scheduler.ts
git commit -m "feat(api): context-aware nudge pass replaces legacy fixed-time reminders"
```

---

## Final verification (controller)

- Full gates: `pnpm --filter @workspace/api-server test`, `pnpm --filter @workspace/focusquest test`, `pnpm typecheck`, boot.
- Schema push done (Task 1, controller-run).
- PR via `superpowers:finishing-a-development-branch`.
