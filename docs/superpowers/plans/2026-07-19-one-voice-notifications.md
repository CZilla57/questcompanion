# One Voice — Unified Notification Envelope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every push notification flows through one pure, timezone-aware envelope with a daily budget, priority ordering, and per-category user preferences; the legacy user-1 daily summary dies and hero-care stops using server-clock quiet hours.

**Architecture:** The cron passes in `notification-scheduler.ts` become *candidate producers* — they return a would-be push plus a `commit` callback instead of sending directly. A new pure module `notification-envelope.ts` picks at most one winner per user per tick (deep-night floor, class windows, user quiet hours, per-category prefs, 3/day budget, 90-min spacing, priority order). The tick sends the winner, runs its commit (dedup markers), and bumps per-user counters. Prefs + quiet hours are new `users` columns exposed via GET/PUT `/users/me/notification-prefs` and edited in a popover off the existing notification bell.

**Tech Stack:** Express 5 + Drizzle (Neon PG) + generated migrations, OpenAPI (`lib/api-spec/openapi.yaml`) + orval codegen, React 19 + wouter + shadcn/radix + TanStack Query, Vitest (`--pool=threads` on this machine).

## Global Constraints

- Act VII rule: **no new game features** — this is consolidation; copy stays anti-shame (never guilt, never "you didn't").
- Spec: `docs/superpowers/specs/2026-07-19-act7-consolidation-design.md` Quest 1. Budget is a **constant 3/day, not a preference**. Deep-night floor **[2,7) local applies to every class**. Priority: **protection/critical > due-today reminders > reflection > milestone > ambient flavor**.
- `sendDailySummary` (user-1, server-clock) is **deleted**, not migrated.
- One shared `users` fetch per tick — passes must not re-scan the table.
- Producers keep their own dedup markers, but a marker may only be written when that candidate **actually sent** (losers must re-offer next tick). Maintenance writes that must happen regardless (milestone-marker clear on broken streak) stay in the producer body.
- Verify current git branch before every commit (shared working tree). Branch: `feat/one-voice-notifications` off `main`.
- Windows note: run vitest as `npx vitest run --pool=threads` (default fork pool crashes under OneDrive).
- Schema changes: edit `lib/db/src/schema/users.ts`, then `pnpm --filter @workspace/db generate`, **read the generated SQL**, commit SQL + `meta/` together. Migrations auto-apply on deploy; applying to live Neon manually is the session lead's job, not a subagent's.

---

### Task 1: Users schema columns + migration

**Files:**
- Modify: `lib/db/src/schema/users.ts` (after the `recapUnsubscribeToken` line, before `createdAt`)
- Generate: `lib/db/drizzle/0001_one_voice_prefs.sql` + `lib/db/drizzle/meta/*` (via drizzle-kit)

**Interfaces:**
- Produces: `usersTable` columns `notifyProtection`, `notifyReminders`, `notifyReflection`, `notifyHero` (bool, notnull, default true), `quietHoursStart` (int, notnull, default 22), `quietHoursEnd` (int, notnull, default 8), `pushesSentDate` (text, nullable), `pushesSentCount` (int, notnull, default 0), `lastPushAt` (timestamp, nullable). Later tasks read them via `user.notifyProtection` etc.

- [ ] **Step 1: Add the columns to the schema**

In `lib/db/src/schema/users.ts`, insert after the `recapUnsubscribeToken` line:

```ts
  // Act VII One Voice: per-category push preferences + user quiet hours.
  // Categories map to candidate producers (see api-server lib/notification-envelope.ts).
  notifyProtection: boolean("notify_protection").notNull().default(true),
  notifyReminders: boolean("notify_reminders").notNull().default(true),
  notifyReflection: boolean("notify_reflection").notNull().default(true),
  notifyHero: boolean("notify_hero").notNull().default(true),
  // Local-hour ints [0,23]. Quiet window is [start→end) wrapping midnight; start === end
  // means "no quiet hours". Applies to non-critical classes only — the [2,7) deep-night
  // floor in the envelope is absolute and not user-configurable.
  quietHoursStart: integer("quiet_hours_start").notNull().default(22),
  quietHoursEnd: integer("quiet_hours_end").notNull().default(8),
  // Envelope budget state: local-date key the counter belongs to, count sent that day,
  // and the instant of the last envelope push (90-min aggregate spacing).
  pushesSentDate: text("pushes_sent_date"),
  pushesSentCount: integer("pushes_sent_count").notNull().default(0),
  lastPushAt: timestamp("last_push_at"),
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @workspace/db generate`
Expected: writes `lib/db/drizzle/0001_<name>.sql` + updates `meta/`. Open the SQL and confirm it is exactly nine `ALTER TABLE "users" ADD COLUMN ...` statements with the defaults above and nothing else (no drops, no constraint churn).

- [ ] **Step 3: Consistency check**

Run: `pnpm --filter @workspace/db check`
Expected: no collisions or gaps.

- [ ] **Step 4: Typecheck**

Run: `pnpm -w run typecheck:libs`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must print feat/one-voice-notifications
git add lib/db/src/schema/users.ts lib/db/drizzle
git commit -m "feat(db): notification prefs, quiet hours, and envelope counters on users"
```

---

### Task 2: Pure envelope module `notification-envelope.ts` (TDD)

**Files:**
- Create: `artifacts/api-server/src/lib/notification-envelope.ts`
- Test: `artifacts/api-server/src/lib/notification-envelope.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (pure).
- Produces (used verbatim by Task 3):

```ts
export const DAILY_PUSH_BUDGET = 3;
export const PUSH_SPACING_MIN = 90;
export const DEEP_NIGHT_START = 2;  // [2,7) — matches lib/hyperfocus.ts
export const DEEP_NIGHT_END = 7;

export type NotificationCategory = "protection" | "reminders" | "reflection" | "hero";
export type CandidateClass = "critical" | "reminder" | "reflection" | "milestone" | "ambient";

export type CandidateKind =
  | "hyperfocus" | "hunger_warning" | "context_nudge"
  | "reflection_prompt" | "companion_milestone" | "hero_flavor";

export interface KindMeta { category: NotificationCategory; klass: CandidateClass }
export const KIND_META: Record<CandidateKind, KindMeta>;

export interface PushCandidate {
  kind: CandidateKind;
  title: string;
  body: string;
  tag: string;
  url?: string;
}

export interface EnvelopePrefs {
  protection: boolean; reminders: boolean; reflection: boolean; hero: boolean;
  quietHoursStart: number; quietHoursEnd: number;
}

export interface EnvelopeState {
  localHour: number;
  localToday: string;             // user-local YYYY-MM-DD
  prefs: EnvelopePrefs;
  pushesSentDate: string | null;
  pushesSentCount: number;
  lastPushAt: Date | null;
  now: Date;
}

export function inQuietHours(hour: number, start: number, end: number): boolean;
export function selectPush(candidates: PushCandidate[], state: EnvelopeState): PushCandidate | null;
export type PrefsValidation = { ok: true; value: EnvelopePrefs } | { ok: false; error: string };
export function validatePrefsBody(body: unknown): PrefsValidation;
```

**Semantics to implement (each is a test):**
- `KIND_META`: hyperfocus → {protection, critical}; hunger_warning → {hero, reminder}; context_nudge → {reminders, reminder}; reflection_prompt → {reflection, reflection}; companion_milestone → {hero, milestone}; hero_flavor → {hero, ambient}.
- `inQuietHours(h, s, e)`: window `[s→e)` wrapping midnight; `s === e` ⇒ always false.
- `selectPush` filters, then picks by class rank (critical=0 < reminder=1 < reflection=2 < milestone=3 < ambient=4), stable within a class (first offered wins). Filters, in order:
  1. Deep-night floor: `localHour ∈ [2,7)` ⇒ return null (all classes, regardless of prefs).
  2. Spacing: `lastPushAt` non-null and `now − lastPushAt < 90 min` ⇒ null.
  3. Budget: `count = (pushesSentDate === localToday ? pushesSentCount : 0)`; `count >= 3` ⇒ null (applies to critical too — spec: ≤ budget for a maximally-eligible user).
  4. Per candidate: drop if `prefs[category]` is false.
  5. Per candidate: class window — critical: always allowed (floor already handled); reminder and reflection: `localHour ∈ [7,22)`; milestone and ambient: `localHour ∈ [8,22)`.
  6. Per candidate: quiet hours — non-critical candidates dropped when `inQuietHours(localHour, quietHoursStart, quietHoursEnd)`; **critical ignores user quiet hours** (bedtime nudges fire at 23:00 by design).
- `validatePrefsBody`: accepts exactly `{ protection, reminders, reflection, hero: boolean; quietHoursStart, quietHoursEnd: integer 0–23 }`; anything else (missing key, wrong type, out-of-range, non-integer) ⇒ `{ ok: false, error: "<plain message>" }`.

- [ ] **Step 1: Write the failing tests**

Create `artifacts/api-server/src/lib/notification-envelope.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  DAILY_PUSH_BUDGET, PUSH_SPACING_MIN, KIND_META, inQuietHours, selectPush,
  validatePrefsBody, type PushCandidate, type EnvelopeState,
} from "./notification-envelope";

const allOn = {
  protection: true, reminders: true, reflection: true, hero: true,
  quietHoursStart: 22, quietHoursEnd: 8,
};

type StateOver = Partial<Omit<EnvelopeState, "prefs">> & { prefs?: Partial<EnvelopeState["prefs"]> };
function state(over: StateOver = {}): EnvelopeState {
  const { prefs: prefsOver, ...rest } = over;
  return {
    localHour: 12,
    localToday: "2026-07-19",
    pushesSentDate: null,
    pushesSentCount: 0,
    lastPushAt: null,
    now: new Date("2026-07-19T17:00:00Z"),
    ...rest,
    prefs: { ...allOn, ...(prefsOver ?? {}) },
  };
}

function cand(kind: PushCandidate["kind"], title = kind): PushCandidate {
  return { kind, title, body: "b", tag: kind };
}

describe("KIND_META", () => {
  it("maps every kind to its category and class per spec", () => {
    expect(KIND_META.hyperfocus).toEqual({ category: "protection", klass: "critical" });
    expect(KIND_META.hunger_warning).toEqual({ category: "hero", klass: "reminder" });
    expect(KIND_META.context_nudge).toEqual({ category: "reminders", klass: "reminder" });
    expect(KIND_META.reflection_prompt).toEqual({ category: "reflection", klass: "reflection" });
    expect(KIND_META.companion_milestone).toEqual({ category: "hero", klass: "milestone" });
    expect(KIND_META.hero_flavor).toEqual({ category: "hero", klass: "ambient" });
  });
});

describe("inQuietHours", () => {
  it("handles a midnight-wrapping window", () => {
    expect(inQuietHours(23, 22, 8)).toBe(true);
    expect(inQuietHours(3, 22, 8)).toBe(true);
    expect(inQuietHours(8, 22, 8)).toBe(false);  // end exclusive
    expect(inQuietHours(12, 22, 8)).toBe(false);
    expect(inQuietHours(22, 22, 8)).toBe(true);  // start inclusive
  });
  it("handles a same-day window and the empty window", () => {
    expect(inQuietHours(13, 13, 15)).toBe(true);
    expect(inQuietHours(15, 13, 15)).toBe(false);
    expect(inQuietHours(12, 12, 12)).toBe(false); // start === end ⇒ no quiet hours
  });
});

describe("selectPush — global gates", () => {
  it("deep-night floor [2,7) silences every class, even critical", () => {
    for (const hour of [2, 4, 6]) {
      expect(selectPush([cand("hyperfocus")], state({ localHour: hour }))).toBeNull();
    }
    expect(selectPush([cand("hyperfocus")], state({ localHour: 7 }))).not.toBeNull();
  });
  it("90-min spacing blocks all sends; 91 minutes clears it", () => {
    const now = new Date("2026-07-19T17:00:00Z");
    const recent = new Date(now.getTime() - (PUSH_SPACING_MIN - 1) * 60_000);
    const old = new Date(now.getTime() - (PUSH_SPACING_MIN + 1) * 60_000);
    expect(selectPush([cand("hyperfocus")], state({ now, lastPushAt: recent }))).toBeNull();
    expect(selectPush([cand("hyperfocus")], state({ now, lastPushAt: old }))).not.toBeNull();
  });
  it("daily budget caps at 3 for every class, and resets on a new local day", () => {
    const spent = state({ pushesSentDate: "2026-07-19", pushesSentCount: DAILY_PUSH_BUDGET });
    expect(selectPush([cand("hyperfocus")], spent)).toBeNull();
    const newDay = state({ pushesSentDate: "2026-07-18", pushesSentCount: DAILY_PUSH_BUDGET });
    expect(selectPush([cand("hyperfocus")], newDay)).not.toBeNull();
  });
});

describe("selectPush — per-candidate filters", () => {
  it("drops candidates whose category pref is off", () => {
    const s = state({ prefs: { hero: false } });
    expect(selectPush([cand("hero_flavor")], s)).toBeNull();
    expect(selectPush([cand("hero_flavor"), cand("context_nudge")], s)?.kind).toBe("context_nudge");
  });
  it("enforces class windows: ambient [8,22), reminder [7,22)", () => {
    expect(selectPush([cand("hero_flavor")], state({ localHour: 7, prefs: { quietHoursStart: 0, quietHoursEnd: 0 } }))).toBeNull();
    expect(selectPush([cand("context_nudge")], state({ localHour: 7, prefs: { quietHoursStart: 0, quietHoursEnd: 0 } }))).not.toBeNull();
    expect(selectPush([cand("hero_flavor")], state({ localHour: 22 }))).toBeNull();
    expect(selectPush([cand("hyperfocus")], state({ localHour: 23 }))).not.toBeNull();
  });
  it("user quiet hours silence non-critical but never critical", () => {
    const s = state({ localHour: 23 }); // default quiet 22→8
    expect(selectPush([cand("context_nudge")], s)).toBeNull();
    expect(selectPush([cand("hyperfocus")], s)?.kind).toBe("hyperfocus");
  });
  it("default quiet hours push the reminder window start from 7 to 8", () => {
    expect(selectPush([cand("context_nudge")], state({ localHour: 7 }))).toBeNull();
    expect(selectPush([cand("context_nudge")], state({ localHour: 8 }))).not.toBeNull();
  });
});

describe("selectPush — priority", () => {
  it("critical beats reminder beats reflection beats milestone beats ambient", () => {
    const all = [cand("hero_flavor"), cand("companion_milestone"), cand("reflection_prompt"), cand("context_nudge"), cand("hyperfocus")];
    expect(selectPush(all, state({ localHour: 20 }))?.kind).toBe("hyperfocus");
    expect(selectPush(all.slice(0, 4), state({ localHour: 20 }))?.kind).toBe("context_nudge");
    expect(selectPush(all.slice(0, 3), state({ localHour: 20 }))?.kind).toBe("reflection_prompt");
    expect(selectPush(all.slice(0, 2), state({ localHour: 20 }))?.kind).toBe("companion_milestone");
    expect(selectPush(all.slice(0, 1), state({ localHour: 20 }))?.kind).toBe("hero_flavor");
  });
  it("is stable within a class (first offered wins)", () => {
    const a = { ...cand("hunger_warning"), title: "first" };
    const b = { ...cand("context_nudge"), title: "second" };
    expect(selectPush([a, b], state({ localHour: 12 }))?.title).toBe("first");
  });
  it("returns null for no candidates", () => {
    expect(selectPush([], state())).toBeNull();
  });
});

describe("validatePrefsBody", () => {
  const good = { protection: true, reminders: false, reflection: true, hero: true, quietHoursStart: 22, quietHoursEnd: 8 };
  it("accepts a full valid body", () => {
    expect(validatePrefsBody(good)).toEqual({ ok: true, value: good });
  });
  it("rejects missing keys, wrong types, and out-of-range hours", () => {
    expect(validatePrefsBody({ ...good, protection: "yes" }).ok).toBe(false);
    const { hero, ...missing } = good;
    expect(validatePrefsBody(missing).ok).toBe(false);
    expect(validatePrefsBody({ ...good, quietHoursStart: 24 }).ok).toBe(false);
    expect(validatePrefsBody({ ...good, quietHoursEnd: -1 }).ok).toBe(false);
    expect(validatePrefsBody({ ...good, quietHoursEnd: 7.5 }).ok).toBe(false);
    expect(validatePrefsBody(null).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd artifacts/api-server && npx vitest run --pool=threads src/lib/notification-envelope.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `artifacts/api-server/src/lib/notification-envelope.ts`:

```ts
// Act VII One Voice: the single decision point for every push notification.
// Producers offer candidates; this module picks at most one per user per tick.
// Pure — all state comes in via EnvelopeState so the rules are exhaustively testable.

export const DAILY_PUSH_BUDGET = 3;
export const PUSH_SPACING_MIN = 90;
// Absolute floor, matching lib/hyperfocus.ts DEEP_NIGHT_START/MORNING — no push
// of any class in [2,7) local, and it is not user-configurable.
export const DEEP_NIGHT_START = 2;
export const DEEP_NIGHT_END = 7;

export type NotificationCategory = "protection" | "reminders" | "reflection" | "hero";
export type CandidateClass = "critical" | "reminder" | "reflection" | "milestone" | "ambient";

export type CandidateKind =
  | "hyperfocus"
  | "hunger_warning"
  | "context_nudge"
  | "reflection_prompt"
  | "companion_milestone"
  | "hero_flavor";

export interface KindMeta { category: NotificationCategory; klass: CandidateClass }

// Category = which user pref toggle governs it. Class = when it may fire and
// how it ranks. hunger_warning is a care warning, but it keeps daytime manners
// (reminder class) — only hyperfocus protection may speak at night, because
// bedtime nudges exist to fire at 23:00+.
export const KIND_META: Record<CandidateKind, KindMeta> = {
  hyperfocus:          { category: "protection", klass: "critical" },
  hunger_warning:      { category: "hero",       klass: "reminder" },
  context_nudge:       { category: "reminders",  klass: "reminder" },
  reflection_prompt:   { category: "reflection", klass: "reflection" },
  companion_milestone: { category: "hero",       klass: "milestone" },
  hero_flavor:         { category: "hero",       klass: "ambient" },
};

const CLASS_RANK: Record<CandidateClass, number> = {
  critical: 0, reminder: 1, reflection: 2, milestone: 3, ambient: 4,
};

// Local-hour windows per class. Critical has no window here — the deep-night
// floor above is its only constraint. Reminder starts at 7 to preserve the
// context-nudge envelope (ENVELOPE_START = 7); ambient/milestone start at 8,
// carrying hero-care's old daytime intent into the user's own timezone.
const CLASS_WINDOW: Record<Exclude<CandidateClass, "critical">, [number, number]> = {
  reminder:   [7, 22],
  reflection: [7, 22],
  milestone:  [8, 22],
  ambient:    [8, 22],
};

export interface PushCandidate {
  kind: CandidateKind;
  title: string;
  body: string;
  tag: string;
  url?: string;
}

export interface EnvelopePrefs {
  protection: boolean;
  reminders: boolean;
  reflection: boolean;
  hero: boolean;
  quietHoursStart: number;
  quietHoursEnd: number;
}

export interface EnvelopeState {
  localHour: number;
  localToday: string;
  prefs: EnvelopePrefs;
  pushesSentDate: string | null;
  pushesSentCount: number;
  lastPushAt: Date | null;
  now: Date;
}

/** Quiet window is [start→end) and may wrap midnight; start === end means none. */
export function inQuietHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

export function selectPush(candidates: PushCandidate[], state: EnvelopeState): PushCandidate | null {
  const { localHour, prefs } = state;

  if (localHour >= DEEP_NIGHT_START && localHour < DEEP_NIGHT_END) return null;

  if (state.lastPushAt) {
    const elapsedMin = (state.now.getTime() - state.lastPushAt.getTime()) / 60_000;
    if (elapsedMin < PUSH_SPACING_MIN) return null;
  }

  const sentToday = state.pushesSentDate === state.localToday ? state.pushesSentCount : 0;
  if (sentToday >= DAILY_PUSH_BUDGET) return null;

  const allowed = candidates.filter((c) => {
    const meta = KIND_META[c.kind];
    if (!prefs[meta.category]) return false;
    if (meta.klass !== "critical") {
      const [start, end] = CLASS_WINDOW[meta.klass];
      if (localHour < start || localHour >= end) return false;
      if (inQuietHours(localHour, prefs.quietHoursStart, prefs.quietHoursEnd)) return false;
    }
    return true;
  });
  if (allowed.length === 0) return null;

  // Stable: sort is by class rank only, and Array.prototype.sort is stable,
  // so ties keep producer order (first offered wins).
  return [...allowed].sort((a, b) => CLASS_RANK[KIND_META[a.kind].klass] - CLASS_RANK[KIND_META[b.kind].klass])[0];
}

export type PrefsValidation = { ok: true; value: EnvelopePrefs } | { ok: false; error: string };

export function validatePrefsBody(body: unknown): PrefsValidation {
  if (body === null || typeof body !== "object") return { ok: false, error: "Body must be an object" };
  const b = body as Record<string, unknown>;
  for (const key of ["protection", "reminders", "reflection", "hero"] as const) {
    if (typeof b[key] !== "boolean") return { ok: false, error: `${key} must be a boolean` };
  }
  for (const key of ["quietHoursStart", "quietHoursEnd"] as const) {
    const v = b[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 23) {
      return { ok: false, error: `${key} must be an integer between 0 and 23` };
    }
  }
  return {
    ok: true,
    value: {
      protection: b.protection as boolean,
      reminders: b.reminders as boolean,
      reflection: b.reflection as boolean,
      hero: b.hero as boolean,
      quietHoursStart: b.quietHoursStart as number,
      quietHoursEnd: b.quietHoursEnd as number,
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd artifacts/api-server && npx vitest run --pool=threads src/lib/notification-envelope.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must print feat/one-voice-notifications
git add artifacts/api-server/src/lib/notification-envelope.ts artifacts/api-server/src/lib/notification-envelope.test.ts
git commit -m "feat(notifications): pure envelope — budget, windows, quiet hours, priority"
```

---

### Task 3: Scheduler refactor — producers + envelope dispatch, legacy passes die

**Files:**
- Modify: `artifacts/api-server/src/routes/../lib/notification-scheduler.ts` (path: `artifacts/api-server/src/lib/notification-scheduler.ts`)

**Interfaces:**
- Consumes (Task 2): `selectPush`, `KIND_META`, `DAILY_PUSH_BUDGET` from `./notification-envelope`; (Task 1) new `usersTable` columns.
- Produces: `tick()` behavior relied on by cron route (unchanged signature). Internal type `ProducedCandidate = PushCandidate & { commit: () => Promise<void> }`.

**What changes, precisely:**
1. **Delete** `sendDailySummary` and the `DEFAULT_USER_ID` constant entirely (and its `ran.push("daily-summary")`).
2. Each per-user pass becomes a producer returning candidates instead of notifying:
   - `contextNudgeCandidate(user, now)` — body of today's `checkContextNudges` loop minus the users fetch, minus `notify`, minus the users update; those last two become the candidate + `commit`.
   - `heroCareCandidates(user, now, tz)` — hero-care logic **loses its server-clock `if (hour < 7 || hour >= 22) return` gate entirely** (the envelope owns windows now, in user-local time). Mutual exclusion warning ⟩ milestone ⟩ flavor is kept by returning at most one candidate. The milestone-marker clear on a broken streak stays as a direct DB write in the producer (it must run even when nothing sends).
   - `hyperfocusCandidate(user, now, tz)` — same conversion; `selectProtectionNudge` still applies its own cadence/kind rotation, and the envelope adds the aggregate gates on top.
   - `reflectionCandidate(user, now, tz)` — same conversion.
3. `tick()` fetches users **once** and runs one per-user loop: gather candidates from all four producers (each wrapped in its own try/catch), build `EnvelopeState` from the user row, `selectPush`, and if there's a winner: `notify(...)`, `await winner.commit()`, then one `users` update setting `pushesSentDate: localToday`, `pushesSentCount: sentToday + 1`, `lastPushAt: now`.
4. `checkWeeklyRecaps(users)` and `spawnRecurringTasks()` keep their behavior but `checkWeeklyRecaps` takes the shared users array instead of re-fetching.

- [ ] **Step 1: Rewrite the pass sections**

Replace the imports block addition and the four passes. New/changed code (complete):

```ts
import {
  selectPush, KIND_META,
  type PushCandidate, type EnvelopeState,
} from "./notification-envelope";
import type { User } from "@workspace/db";
```

(`User` is already exported from `@workspace/db` schema barrel; `db, usersTable, …` imports stay.)

```ts
type ProducedCandidate = PushCandidate & { commit: () => Promise<void> };

async function contextNudgeCandidate(user: User, now: Date): Promise<ProducedCandidate | null> {
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
  if (kinds.length === 0) return null;

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
  if (openQuests.length === 0) return null;

  const needsPatterns = kinds.includes("power_window") || kinds.includes("quick_win");
  const patterns = needsPatterns
    ? derivePatterns(await loadPatternInputs(user.id, tz, now))
    : null;

  const nudge = selectContextNudge({ ...gate, patterns, openQuests });
  if (!nudge) return null;

  return {
    kind: "context_nudge",
    title: nudge.title, body: nudge.body, tag: nudge.tag, url: nudge.url,
    commit: async () => {
      const dateColumn =
        nudge.kind === "due_today" ? { nudgeDueTodayDate: localToday }
        : nudge.kind === "power_window" ? { nudgePowerWindowDate: localToday }
        : { nudgeQuickWinDate: localToday };
      await db.update(usersTable)
        .set({ ...dateColumn, contextNudgedAt: now })
        .where(eq(usersTable.id, user.id));
    },
  };
}

async function heroCareCandidate(user: User, now: Date): Promise<ProducedCandidate | null> {
  // No hour gate here: the envelope enforces windows in the user's own timezone.
  const stage = hungerStage(user.lastFedAt, now);

  const warning = hungerWarning(stage, user.hungerNotifiedStage);
  if (warning) {
    return {
      kind: "hunger_warning",
      title: warning.title, body: warning.body, tag: warning.tag,
      commit: async () => {
        await db.update(usersTable)
          .set({ hungerNotifiedStage: stage })
          .where(eq(usersTable.id, user.id));
      },
    };
  }

  const milestone = companionMilestonePush(user.streakDays, user.companionMilestoneNotified);
  if (milestone.push) {
    const push = milestone.push;
    return {
      kind: "companion_milestone",
      title: push.title, body: push.body, tag: push.tag,
      commit: async () => {
        await db.update(usersTable)
          .set({ companionMilestoneNotified: milestone.marker })
          .where(eq(usersTable.id, user.id));
      },
    };
  }
  if (milestone.marker !== user.companionMilestoneNotified) {
    // Maintenance, not a send: streak broke — clear so it can re-celebrate later.
    await db.update(usersTable)
      .set({ companionMilestoneNotified: milestone.marker })
      .where(eq(usersTable.id, user.id));
  }

  if (shouldSendFlavorPush({ userId: user.id, stage, lastFlavorPushAt: user.lastFlavorPushAt, now })) {
    const vignette = currentVignette(user.id, stage, user.avatarClass, now);
    return {
      kind: "hero_flavor",
      title: "Word from your hero", body: `Your hero is ${vignette.text}.`, tag: "hero-flavor",
      commit: async () => {
        await db.update(usersTable)
          .set({ lastFlavorPushAt: now })
          .where(eq(usersTable.id, user.id));
      },
    };
  }
  return null;
}

async function hyperfocusCandidate(user: User, now: Date): Promise<ProducedCandidate | null> {
  const tz = resolveTimeZone(user.timezone ?? "");
  const [latest] = await db.select().from(brainCheckinsTable)
    .where(eq(brainCheckinsTable.userId, user.id))
    .orderBy(desc(brainCheckinsTable.createdAt), desc(brainCheckinsTable.id))
    .limit(1);
  const state = deriveBrainState(latest, now, tz);

  const sessions = await db.select().from(focusSessionsTable)
    .where(and(eq(focusSessionsTable.userId, user.id), eq(focusSessionsTable.status, "active")));

  const stretch = protectedStretch({
    activeSessions: sessions.map((s) => ({ startedAt: s.startedAt, lastIntervalAt: s.lastIntervalAt })),
    mode: state.mode,
    hyperfocusSince: state.mode === "hyperfocus" ? state.since : null,
    now,
  });

  const chosen = selectProtectionNudge({
    stretch, now, localHour: localHour(now, tz),
    lastNudgedAt: user.hyperfocusNudgedAt,
    lastKind: user.hyperfocusLastKind as NudgeKind | null,
    hungerStage: hungerStage(user.lastFedAt, now),
    pausedUntil: user.hyperfocusPausedUntil,
  });
  if (!chosen) return null;

  return {
    kind: "hyperfocus",
    title: chosen.title, body: chosen.body, tag: chosen.tag,
    commit: async () => {
      await db.update(usersTable)
        .set({ hyperfocusNudgedAt: now, hyperfocusLastKind: chosen.kind })
        .where(eq(usersTable.id, user.id));
    },
  };
}

async function reflectionCandidate(user: User, now: Date): Promise<ProducedCandidate | null> {
  if (!user.timezone) return null;
  const tz = resolveTimeZone(user.timezone);
  const hour = localHour(now, tz);
  const localToday = localDateKey(now, tz);
  if (hour < 19 || hour >= 22 || user.reflectionPromptedDate === localToday) return null;

  const dayStart = localDayStartUtc(localToday, tz);

  const [todayReflection] = await db.select({ answeredAt: reflectionsTable.answeredAt })
    .from(reflectionsTable)
    .where(and(eq(reflectionsTable.userId, user.id), eq(reflectionsTable.localDate, localToday)));

  const [completion] = await db.select({ id: tasksTable.id }).from(tasksTable)
    .where(and(
      eq(tasksTable.userId, user.id), eq(tasksTable.completed, true),
      isNotNull(tasksTable.completedAt), gte(tasksTable.completedAt, dayStart),
    )).limit(1);
  const [focus] = await db.select({ id: focusSessionsTable.id }).from(focusSessionsTable)
    .where(and(
      eq(focusSessionsTable.userId, user.id),
      gte(focusSessionsTable.startedAt, dayStart),
      gte(focusSessionsTable.completedIntervals, 1),
    )).limit(1);
  const [checkin] = await db.select({ id: brainCheckinsTable.id }).from(brainCheckinsTable)
    .where(and(eq(brainCheckinsTable.userId, user.id), gte(brainCheckinsTable.createdAt, dayStart)))
    .limit(1);

  const should = shouldPromptReflection({
    localHour: hour,
    promptedToday: user.reflectionPromptedDate === localToday,
    answeredToday: todayReflection?.answeredAt != null,
    hadSignalToday: Boolean(completion || focus || checkin),
    hasTimezone: true,
  });
  if (!should) return null;

  return {
    kind: "reflection_prompt",
    title: "🌙 How did today feel?",
    body: "1-minute reflection — what worked today?",
    tag: "reflection-prompt",
    url: "/reflection",
    commit: async () => {
      await db.update(usersTable)
        .set({ reflectionPromptedDate: localToday })
        .where(eq(usersTable.id, user.id));
    },
  };
}

async function runEnvelopePass(users: User[], now: Date) {
  for (const user of users) {
    try {
      const candidates: ProducedCandidate[] = [];
      // Producer order = tie-break order within a class (envelope sort is stable):
      // protection first, then care warning, context, reflection, milestone, flavor.
      const producers = [hyperfocusCandidate, heroCareCandidate, contextNudgeCandidate, reflectionCandidate];
      for (const produce of producers) {
        try {
          const c = await produce(user, now);
          if (c) candidates.push(c);
        } catch (err) {
          logger.error({ err, userId: user.id }, "Notification producer failed for user");
        }
      }
      if (candidates.length === 0) continue;

      const tz = resolveTimeZone(user.timezone ?? "");
      const localToday = localDateKey(now, tz);
      const state: EnvelopeState = {
        localHour: localHour(now, tz),
        localToday,
        prefs: {
          protection: user.notifyProtection,
          reminders: user.notifyReminders,
          reflection: user.notifyReflection,
          hero: user.notifyHero,
          quietHoursStart: user.quietHoursStart,
          quietHoursEnd: user.quietHoursEnd,
        },
        pushesSentDate: user.pushesSentDate,
        pushesSentCount: user.pushesSentCount,
        lastPushAt: user.lastPushAt,
        now,
      };
      const winner = selectPush(candidates, state);
      if (!winner) continue;

      const produced = candidates.find((c) => c === winner)!;
      await notify(user.id, produced.title, produced.body, produced.tag, produced.url ? { url: produced.url } : undefined);
      await produced.commit();
      const sentToday = user.pushesSentDate === localToday ? user.pushesSentCount : 0;
      await db.update(usersTable)
        .set({ pushesSentDate: localToday, pushesSentCount: sentToday + 1, lastPushAt: now })
        .where(eq(usersTable.id, user.id));
    } catch (err) {
      logger.error({ err, userId: user.id }, "Envelope pass failed for user");
    }
  }
}
```

- [ ] **Step 2: Rewrite `tick()` and `checkWeeklyRecaps` signature**

```ts
export async function tick() {
  const ran: string[] = [];
  const now = new Date();

  await spawnRecurringTasks();
  ran.push("recurring-tasks");

  // One shared users fetch per tick — passes must not re-scan the table.
  const users = await db.select().from(usersTable);

  await runEnvelopePass(users, now);
  ran.push("notification-envelope");

  await checkWeeklyRecaps(users);
  ran.push("weekly-recaps");

  return ran;
}
```

`checkWeeklyRecaps` becomes `async function checkWeeklyRecaps(users: User[])` and its first two lines change from fetching users to using the parameter (the `const now = new Date()` inside it stays). Delete `checkContextNudges`, `sendDailySummary`, `checkHeroCare`, `checkHyperfocusProtection`, `checkReflectionPrompts` (their bodies now live in the producers), and the `DEFAULT_USER_ID` constant. The `activityTable` import becomes unused only if nothing else references it — `loadWeekStatsInputs` still uses it; keep. Remove imports that go unused after the deletion (`gt` stays — used by weekly stats; check with typecheck).

- [ ] **Step 3: Typecheck + full API suite**

Run: `pnpm -w run typecheck && cd artifacts/api-server && npx vitest run --pool=threads`
Expected: typecheck clean; all existing tests pass (pure libs untouched). If `gt` or other imports are now unused, remove them.

- [ ] **Step 4: Commit**

```bash
git branch --show-current   # must print feat/one-voice-notifications
git add artifacts/api-server/src/lib/notification-scheduler.ts
git commit -m "feat(notifications): producers + envelope dispatch; delete user-1 daily summary and server-clock gates"
```

---

### Task 4: Prefs API — OpenAPI, route, codegen

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (paths after `/users/me/recap-emails`; schemas near `RecapEmailSettingsResponse`)
- Modify: `artifacts/api-server/src/routes/notifications.ts`

**Interfaces:**
- Consumes (Task 2): `validatePrefsBody` from `../lib/notification-envelope`; (Task 1) users columns.
- Produces: operations `getNotificationPrefs` / `updateNotificationPrefs` → orval hooks `useGetNotificationPrefs`, `useUpdateNotificationPrefs`, type `NotificationPrefs` (used by Task 5).

- [ ] **Step 1: Add the OpenAPI path + schema**

In `lib/api-spec/openapi.yaml`, after the `/users/me/recap-emails` path block:

```yaml
  /users/me/notification-prefs:
    get:
      operationId: getNotificationPrefs
      tags: [notifications]
      summary: Per-category push preferences and quiet hours
      responses:
        "200":
          description: Current preferences
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/NotificationPrefs"
        "401":
          description: Unauthorized
    put:
      operationId: updateNotificationPrefs
      tags: [notifications]
      summary: Replace push preferences and quiet hours
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/NotificationPrefs"
      responses:
        "200":
          description: Updated preferences
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/NotificationPrefs"
        "400":
          description: Invalid body
        "401":
          description: Unauthorized
```

And in `components.schemas` (alongside the recap schemas):

```yaml
    NotificationPrefs:
      type: object
      required: [protection, reminders, reflection, hero, quietHoursStart, quietHoursEnd]
      additionalProperties: false
      properties:
        protection:
          type: boolean
          description: Hyperfocus self-care nudges (may fire late by design)
        reminders:
          type: boolean
          description: Context nudges — due today, power window, quick win
        reflection:
          type: boolean
          description: Evening reflection prompt
        hero:
          type: boolean
          description: Hero care — hunger warnings, milestones, flavor
        quietHoursStart:
          type: integer
          minimum: 0
          maximum: 23
        quietHoursEnd:
          type: integer
          minimum: 0
          maximum: 23
```

- [ ] **Step 2: Add the route handlers**

Append to `artifacts/api-server/src/routes/notifications.ts` (before `export default router;`), adding imports `db, usersTable` (already partially imported — extend) , `eq` from drizzle, and `validatePrefsBody` from `../lib/notification-envelope`:

```ts
function prefsShape(u: {
  notifyProtection: boolean; notifyReminders: boolean; notifyReflection: boolean;
  notifyHero: boolean; quietHoursStart: number; quietHoursEnd: number;
}) {
  return {
    protection: u.notifyProtection,
    reminders: u.notifyReminders,
    reflection: u.notifyReflection,
    hero: u.notifyHero,
    quietHoursStart: u.quietHoursStart,
    quietHoursEnd: u.quietHoursEnd,
  };
}

router.get("/users/me/notification-prefs", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.gameUserId));
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  res.json(prefsShape(user));
});

router.put("/users/me/notification-prefs", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = validatePrefsBody(req.body);
  if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
  const v = parsed.value;
  const [updated] = await db.update(usersTable)
    .set({
      notifyProtection: v.protection,
      notifyReminders: v.reminders,
      notifyReflection: v.reflection,
      notifyHero: v.hero,
      quietHoursStart: v.quietHoursStart,
      quietHoursEnd: v.quietHoursEnd,
    })
    .where(eq(usersTable.id, req.gameUserId))
    .returning();
  if (!updated) { res.status(401).json({ error: "Unauthorized" }); return; }
  res.json(prefsShape(updated));
});
```

- [ ] **Step 3: Codegen + typecheck**

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: regenerates `lib/api-client-react` + `lib/api-zod`; typecheck (bundled in the codegen script) passes; `useGetNotificationPrefs` / `useUpdateNotificationPrefs` exist in the generated client.

- [ ] **Step 4: API suite still green**

Run: `cd artifacts/api-server && npx vitest run --pool=threads`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must print feat/one-voice-notifications
git add lib/api-spec lib/api-client-react lib/api-zod artifacts/api-server/src/routes/notifications.ts
git commit -m "feat(api): GET/PUT /users/me/notification-prefs"
```

---

### Task 5: Bell popover prefs panel (web, TDD)

**Files:**
- Create: `artifacts/focusquest/src/components/notification-prefs.tsx`
- Test: `artifacts/focusquest/src/components/notification-prefs.test.tsx`
- Modify: `artifacts/focusquest/src/components/layout.tsx` (NotificationBell)

**Interfaces:**
- Consumes (Task 4): `useGetNotificationPrefs`, `useUpdateNotificationPrefs`, `getGetNotificationPrefsQueryKey`, type `NotificationPrefs` from `@workspace/api-client-react`.
- Produces: `<NotificationPrefsPanel />` — self-contained panel rendered inside the bell popover.

**Design:** The bell keeps its subscribe/unsubscribe toggle as the panel's master switch; below it, four category switches and two quiet-hour selects, disabled while unsubscribed. Copy is calm and label-like; no nag states. Every control mutates immediately (PUT full body) and invalidates the GET key. Orval mutation hooks require the full replacement body — build it from current data with one field flipped.

- [ ] **Step 1: Write the failing component test**

Create `artifacts/focusquest/src/components/notification-prefs.test.tsx` (follow the house pattern used by existing component tests — MSW-free, mock the client hooks):

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mutateAsync = vi.fn().mockResolvedValue({});
const prefs = {
  protection: true, reminders: true, reflection: false, hero: true,
  quietHoursStart: 22, quietHoursEnd: 8,
};

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...actual,
    useGetNotificationPrefs: () => ({ data: prefs, isLoading: false }),
    useUpdateNotificationPrefs: () => ({ mutateAsync, isPending: false }),
    getGetNotificationPrefsQueryKey: () => ["/users/me/notification-prefs"],
  };
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NotificationPrefsPanel } from "./notification-prefs";

function renderPanel(subscribed = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NotificationPrefsPanel subscribed={subscribed} />
    </QueryClientProvider>
  );
}

beforeEach(() => mutateAsync.mockClear());

describe("NotificationPrefsPanel", () => {
  it("renders one switch per category reflecting server state", () => {
    renderPanel();
    expect(screen.getByRole("switch", { name: /self-care/i })).toBeChecked();
    expect(screen.getByRole("switch", { name: /reminders/i })).toBeChecked();
    expect(screen.getByRole("switch", { name: /reflection/i })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: /hero/i })).toBeChecked();
  });

  it("PUTs the full body with the toggled field flipped", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("switch", { name: /reminders/i }));
    expect(mutateAsync).toHaveBeenCalledWith({
      data: { ...prefs, reminders: false },
    });
  });

  it("PUTs updated quiet hours from the selects", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(/quiet from/i), { target: { value: "21" } });
    expect(mutateAsync).toHaveBeenCalledWith({
      data: { ...prefs, quietHoursStart: 21 },
    });
  });

  it("disables category controls while unsubscribed", () => {
    renderPanel(false);
    expect(screen.getByRole("switch", { name: /reminders/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd artifacts/focusquest && npx vitest run --pool=threads src/components/notification-prefs.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the panel**

Create `artifacts/focusquest/src/components/notification-prefs.tsx`:

```tsx
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetNotificationPrefs, useUpdateNotificationPrefs,
  getGetNotificationPrefsQueryKey, type NotificationPrefs,
} from "@workspace/api-client-react";
import { Switch } from "@/components/ui/switch";

const CATEGORIES: { key: keyof Pick<NotificationPrefs, "protection" | "reminders" | "reflection" | "hero">; label: string; hint: string }[] = [
  { key: "protection", label: "Self-care nudges", hint: "Water, food, wind-down during long focus" },
  { key: "reminders",  label: "Quest reminders",  hint: "Due today, power window, quick wins" },
  { key: "reflection", label: "Evening reflection", hint: "One gentle prompt, evenings only" },
  { key: "hero",       label: "Hero & world",     hint: "Hunger, milestones, flavor" },
];

function hourLabel(h: number): string {
  const period = h < 12 ? "AM" : "PM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${period}`;
}

export function NotificationPrefsPanel({ subscribed }: { subscribed: boolean }) {
  const qc = useQueryClient();
  const { data: prefs, isLoading } = useGetNotificationPrefs();
  const update = useUpdateNotificationPrefs();

  if (isLoading || !prefs) {
    return <div className="p-3 text-xs text-muted-foreground">Loading preferences…</div>;
  }

  const put = async (next: NotificationPrefs) => {
    await update.mutateAsync({ data: next });
    qc.invalidateQueries({ queryKey: getGetNotificationPrefsQueryKey() });
  };

  return (
    <div className="w-64 space-y-3">
      <div className="space-y-2.5">
        {CATEGORIES.map(({ key, label, hint }) => (
          <div key={key} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">{label}</div>
              <div className="text-[11px] text-muted-foreground leading-snug">{hint}</div>
            </div>
            <Switch
              aria-label={label}
              checked={prefs[key]}
              disabled={!subscribed || update.isPending}
              onCheckedChange={(checked) => put({ ...prefs, [key]: checked })}
            />
          </div>
        ))}
      </div>

      <div className="border-t border-border pt-3">
        <div className="text-sm font-medium text-foreground mb-1.5">Quiet hours</div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <label className="flex items-center gap-1.5">
            <span>Quiet from</span>
            <select
              aria-label="Quiet from"
              className="rounded-md border border-input bg-background px-1.5 py-1 text-xs"
              value={prefs.quietHoursStart}
              disabled={!subscribed || update.isPending}
              onChange={(e) => put({ ...prefs, quietHoursStart: Number(e.target.value) })}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{hourLabel(h)}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <span>until</span>
            <select
              aria-label="Quiet until"
              className="rounded-md border border-input bg-background px-1.5 py-1 text-xs"
              value={prefs.quietHoursEnd}
              disabled={!subscribed || update.isPending}
              onChange={(e) => put({ ...prefs, quietHoursEnd: Number(e.target.value) })}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{hourLabel(h)}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5 leading-snug">
          Self-care nudges may still arrive late — that's when they matter. Nothing ever sends 2–7 AM.
        </p>
      </div>
    </div>
  );
}
```

(If `@/components/ui/switch` does not exist in this app, check `src/components/ui/` — the shadcn switch is present in the ui kit; if it is genuinely absent, add it following the neighboring ui components' pattern.)

- [ ] **Step 4: Wire the bell into a popover**

In `artifacts/focusquest/src/components/layout.tsx`, change `NotificationBell` so the bell opens a Popover instead of toggling directly. Imports to add: `Popover, PopoverContent, PopoverTrigger` from `@/components/ui/popover`, `Switch` from `@/components/ui/switch`, and `NotificationPrefsPanel` from `./notification-prefs`. Replace the returned JSX of `NotificationBell` (keep `handleToggle` exactly as is):

```tsx
  return (
    <Popover>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Notification settings"
                className={`relative ${isSubscribed ? "text-primary" : "text-muted-foreground"}`}
              >
                {isSubscribed ? (
                  <Bell className="w-5 h-5 drop-shadow-[0_0_4px_rgba(0,255,255,0.8)]" />
                ) : (
                  <BellOff className="w-5 h-5" />
                )}
                {isSubscribed && (
                  <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-primary rounded-full" />
                )}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">Notifications</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent align="end" className="w-auto p-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-foreground">Push notifications</div>
            <div className="text-[11px] text-muted-foreground">
              {state === "denied" ? "Blocked in browser settings" : isSubscribed ? "On for this device" : "Off"}
            </div>
          </div>
          <Switch
            aria-label={isSubscribed ? "Disable notifications" : "Enable notifications"}
            checked={isSubscribed}
            disabled={loading || state === "denied"}
            onCheckedChange={handleToggle}
          />
        </div>
        <NotificationPrefsPanel subscribed={isSubscribed} />
      </PopoverContent>
    </Popover>
  );
```

- [ ] **Step 5: Run the web suite**

Run: `cd artifacts/focusquest && npx vitest run --pool=threads`
Expected: new tests PASS; existing 162 stay green (if a layout test asserted the old bell aria-label "Enable notifications" on the button, update it to "Notification settings").

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # must print feat/one-voice-notifications
git add artifacts/focusquest/src/components/notification-prefs.tsx artifacts/focusquest/src/components/notification-prefs.test.tsx artifacts/focusquest/src/components/layout.tsx
git commit -m "feat(web): notification prefs panel in the bell popover"
```

---

### Task 6: Full verification + PR

**Files:** none new.

- [ ] **Step 1: Full monorepo typecheck + both suites**

```bash
pnpm -w run typecheck
cd artifacts/api-server && npx vitest run --pool=threads
cd ../focusquest && npx vitest run --pool=threads
```
Expected: all green.

- [ ] **Step 2: Migration dry-run confirmation**

Session lead (not subagent) applies the migration to live Neon per `lib/db/README.md` and confirms `✓ migrations up to date`.

- [ ] **Step 3: Push + PR**

```bash
git push -u origin feat/one-voice-notifications
gh pr create --title "feat(notifications): One Voice — unified tz-aware envelope (Act VII q1)" --body "<summary per repo convention>"
```

- [ ] **Step 4: After merge** — refresh campaign map (One Voice → cleared, tallies 28/38) and roadmap memory.

## Self-review notes

- Spec coverage: delete legacy summary ✓ (Task 3), hero-care tz ✓ (envelope windows, Task 2+3), envelope + budget + priority ✓ (Task 2), prefs + quiet hours + sheet ✓ (Tasks 1/4/5), single users fetch ✓ (Task 3), pure + unit-tested like context-nudges ✓ (Task 2).
- The reflection producer's 19–22 gate stays producer-side (it is that feature's semantic, not a delivery rule); the envelope's [7,22) reflection window is deliberately wider so the two cannot disagree.
- `checkWeeklyRecaps(users)` keeps its own `now` — recap timing is not envelope business.
