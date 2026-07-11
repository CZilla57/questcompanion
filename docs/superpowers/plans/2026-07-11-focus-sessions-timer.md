# Focus Sessions & Timer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Pomodoro-style focus timer that runs client-side, records each completed focus interval on the server, and awards XP for time focused.

**Architecture:** A new `focus_sessions` table stores one server-side session per active run, with the Pomodoro config snapshotted at start. The React client renders the countdown from the session's `startedAt` + snapshot, and calls the server at each focus-interval boundary to bank XP (server-computed from validated wall-clock elapsed). Sessions resume across refresh; stale (abandoned) sessions finalize with only banked intervals.

**Tech Stack:** pnpm monorepo · Express 5 + Drizzle + Neon Postgres (`artifacts/api-server`, `lib/db`) · React 19 + Vite + Wouter + TanStack Query (`artifacts/focusquest`) · spec-driven API via `lib/api-spec/openapi.yaml` + orval codegen · vitest.

## Global Constraints

- **API is spec-driven.** Edit `lib/api-spec/openapi.yaml`, then regenerate with `pnpm --filter @workspace/api-spec codegen`. NEVER hand-edit files under `lib/api-client-react/src/generated` or `lib/api-zod/src/generated`.
- **DB has no migrations.** Edit `lib/db/src/schema/*`, then `pnpm --filter @workspace/db push`. `drizzle.config.ts` does NOT load `.env` — export first: `export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)"`. Additive columns/tables apply without a destructive prompt.
- **Tests:** api-server → `pnpm --filter @workspace/api-server test`; focusquest → `pnpm --filter @workspace/focusquest test`. Both are vitest, `environment: node`, `include: src/**/*.test.ts(x)`.
- **Typecheck gate:** `pnpm typecheck` (root).
- **Route auth pattern (verbatim):** every protected route starts with `if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }` then `const userId = req.gameUserId;`.
- **XP rules (exact):** `0.2` XP per focus minute; `+5` per completed focus interval; `+25` when all planned cycles complete; anti-cheat `GRACE_SECONDS = 5`. Focus XP is **flat** (no streak multiplier), does **not** modify `streakDays`/`lastActiveDate`, and **does** add to both `totalPoints` and `weeklyPoints`.
- **Presets (server-owned):** `classic` 25/5, long 15 every 4, 4 cycles · `deep` 50/10, long 20 every 2, 3 cycles · `short` 15/3, long 10 every 4, 4 cycles.
- **Commit trailer:** end every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Work stays on branch `feat/focus-sessions-timer` (already checked out). LF→CRLF warnings and stale-worktree "permission denied" lines are harmless.
- **Spec:** `docs/superpowers/specs/2026-07-11-focus-sessions-timer-design.md`.

---

## File Structure

**Create:**
- `lib/db/src/schema/focus-sessions.ts` — `focus_sessions` table + `FocusSession` type.
- `artifacts/api-server/src/lib/focus-sessions.ts` — pure: preset catalog + XP + elapsed helpers (no `db` import).
- `artifacts/api-server/src/lib/focus-sessions.test.ts` — unit tests for the pure lib.
- `artifacts/api-server/src/routes/focus-sessions.ts` — the 6 endpoints.
- `artifacts/focusquest/src/lib/pomodoro.ts` — pure client timer state machine (no React).
- `artifacts/focusquest/src/lib/pomodoro.test.ts` — unit tests for the state machine.
- `artifacts/focusquest/src/pages/focus.tsx` — the `/focus` page.

**Modify:**
- `lib/db/src/schema/index.ts` — export the new schema.
- `lib/api-spec/openapi.yaml` — 6 paths + 6 schemas.
- `artifacts/api-server/src/routes/index.ts` — mount the router.
- `artifacts/focusquest/src/App.tsx` — add the `/focus` route.
- `artifacts/focusquest/src/components/layout.tsx` — add the nav item.
- `artifacts/focusquest/src/pages/dashboard.tsx` — add a "Start focus" entry point.

---

## Task 1: `focus_sessions` schema

**Files:**
- Create: `lib/db/src/schema/focus-sessions.ts`
- Modify: `lib/db/src/schema/index.ts`

**Interfaces:**
- Produces: `focusSessionsTable` (Drizzle table) and `type FocusSession = typeof focusSessionsTable.$inferSelect`, both re-exported from `@workspace/db`.

- [ ] **Step 1: Create the schema file**

Create `lib/db/src/schema/focus-sessions.ts`:

```ts
import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { tasksTable } from "./tasks";

export const focusSessionsTable = pgTable("focus_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  // Optional link to a quest; focused minutes roll up into the task's actualMinutes.
  taskId: integer("task_id").references(() => tasksTable.id, { onDelete: "set null" }),
  preset: text("preset").notNull(), // 'classic' | 'deep' | 'short'
  // Config snapshotted at start so a later preset change never shifts an in-flight session.
  focusMinutes: integer("focus_minutes").notNull(),
  breakMinutes: integer("break_minutes").notNull(),
  longBreakMinutes: integer("long_break_minutes").notNull(),
  longBreakEvery: integer("long_break_every").notNull(),
  plannedCycles: integer("planned_cycles").notNull(),
  completedIntervals: integer("completed_intervals").notNull().default(0),
  focusedSeconds: integer("focused_seconds").notNull().default(0), // server-derived
  xpAwarded: integer("xp_awarded").notNull().default(0),            // audit only
  status: text("status").notNull().default("active"),              // 'active' | 'completed' | 'stopped'
  startedAt: timestamp("started_at").notNull().defaultNow(),
  lastIntervalAt: timestamp("last_interval_at"),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type FocusSession = typeof focusSessionsTable.$inferSelect;
```

- [ ] **Step 2: Export from the schema barrel**

In `lib/db/src/schema/index.ts`, add after the last `export * from` line:

```ts
export * from "./focus-sessions";
```

- [ ] **Step 3: Push the schema to Neon**

Run:

```bash
export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)"
pnpm --filter @workspace/db push
```

Expected: ends with `[✓] Changes applied` (creates `focus_sessions`; additive, no destructive prompt). If a re-run is blocked by a Neon auto-mode guardrail, the first run is authoritative.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no errors).

- [ ] **Step 5: Commit**

```bash
git add lib/db/src/schema/focus-sessions.ts lib/db/src/schema/index.ts
git commit -m "$(cat <<'EOF'
feat(db): add focus_sessions table

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Pure focus-session lib (presets + XP)

**Files:**
- Create: `artifacts/api-server/src/lib/focus-sessions.ts`
- Test: `artifacts/api-server/src/lib/focus-sessions.test.ts`

**Interfaces:**
- Produces:
  - `type PresetKey = "classic" | "deep" | "short"`
  - `interface PomodoroPreset { key: PresetKey; label: string; focusMinutes: number; breakMinutes: number; longBreakMinutes: number; longBreakEvery: number; plannedCycles: number }`
  - `const PRESETS: Record<PresetKey, PomodoroPreset>`
  - `function getPreset(key: string): PomodoroPreset | undefined`
  - `function computeIntervalXp(focusMinutes: number): number`
  - `function computePartialXp(minutes: number): number`
  - `function expectedElapsedSeconds(focusMinutes: number, intervalIndex: number): number`
  - constants `FULL_SET_BONUS = 25`, `GRACE_SECONDS = 5`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/focus-sessions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  PRESETS, getPreset, computeIntervalXp, computePartialXp,
  expectedElapsedSeconds, FULL_SET_BONUS,
} from "./focus-sessions";

describe("focus-sessions pure lib", () => {
  it("defines the three presets with the agreed numbers", () => {
    expect(getPreset("classic")).toMatchObject({ focusMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4, plannedCycles: 4 });
    expect(getPreset("deep")).toMatchObject({ focusMinutes: 50, breakMinutes: 10, longBreakMinutes: 20, longBreakEvery: 2, plannedCycles: 3 });
    expect(getPreset("short")).toMatchObject({ focusMinutes: 15, breakMinutes: 3, longBreakMinutes: 10, longBreakEvery: 4, plannedCycles: 4 });
    expect(getPreset("nope")).toBeUndefined();
    expect(Object.keys(PRESETS)).toEqual(["classic", "deep", "short"]);
  });

  it("computes per-interval XP as round(min*0.2)+5", () => {
    expect(computeIntervalXp(25)).toBe(10);
    expect(computeIntervalXp(50)).toBe(15);
    expect(computeIntervalXp(15)).toBe(8);
  });

  it("totals a full classic session to 65 XP", () => {
    const total = 4 * computeIntervalXp(25) + FULL_SET_BONUS;
    expect(total).toBe(65);
  });

  it("computes partial XP with no block bonus and rounds", () => {
    expect(computePartialXp(0)).toBe(0);
    expect(computePartialXp(12)).toBe(2); // round(2.4)
    expect(computePartialXp(13)).toBe(3); // round(2.6)
  });

  it("gives a breaks-excluded elapsed lower bound", () => {
    expect(expectedElapsedSeconds(25, 1)).toBe(1500);
    expect(expectedElapsedSeconds(25, 3)).toBe(4500);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/api-server test`
Expected: FAIL — cannot resolve `./focus-sessions`.

- [ ] **Step 3: Write the implementation**

Create `artifacts/api-server/src/lib/focus-sessions.ts`:

```ts
export type PresetKey = "classic" | "deep" | "short";

export interface PomodoroPreset {
  key: PresetKey;
  label: string;
  focusMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  longBreakEvery: number;
  plannedCycles: number;
}

export const PRESETS: Record<PresetKey, PomodoroPreset> = {
  classic: { key: "classic", label: "Classic 25/5", focusMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4, plannedCycles: 4 },
  deep:    { key: "deep",    label: "Deep 50/10",   focusMinutes: 50, breakMinutes: 10, longBreakMinutes: 20, longBreakEvery: 2, plannedCycles: 3 },
  short:   { key: "short",   label: "Short 15/3",   focusMinutes: 15, breakMinutes: 3,  longBreakMinutes: 10, longBreakEvery: 4, plannedCycles: 4 },
};

export function getPreset(key: string): PomodoroPreset | undefined {
  return (PRESETS as Record<string, PomodoroPreset>)[key];
}

export const XP_PER_FOCUS_MINUTE = 0.2;
export const BLOCK_BONUS = 5;
export const FULL_SET_BONUS = 25;
export const GRACE_SECONDS = 5;

/** XP for one completed focus interval: per-minute time reward + block-completion bonus. */
export function computeIntervalXp(focusMinutes: number): number {
  return Math.round(focusMinutes * XP_PER_FOCUS_MINUTE) + BLOCK_BONUS;
}

/** XP for trailing partial focus on a manual stop (no block bonus). */
export function computePartialXp(minutes: number): number {
  return Math.round(minutes * XP_PER_FOCUS_MINUTE);
}

/** Breaks-excluded lower bound on wall-clock seconds to have completed `intervalIndex` focus blocks. */
export function expectedElapsedSeconds(focusMinutes: number, intervalIndex: number): number {
  return intervalIndex * focusMinutes * 60;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @workspace/api-server test`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/focus-sessions.ts artifacts/api-server/src/lib/focus-sessions.test.ts
git commit -m "$(cat <<'EOF'
feat(api): focus-session presets and XP helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Route module — presets, start, active

**Files:**
- Create: `artifacts/api-server/src/routes/focus-sessions.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Interfaces:**
- Consumes: `focusSessionsTable`, `FocusSession`, `usersTable`, `tasksTable`, `activityTable` from `@workspace/db`; `PRESETS`, `getPreset`, `computeIntervalXp`, `computePartialXp`, `expectedElapsedSeconds`, `FULL_SET_BONUS`, `GRACE_SECONDS` from `../lib/focus-sessions`.
- Produces: an Express `IRouter` default export; a module-local `formatSession(s: FocusSession)` shape reused by Tasks 4–5. Routes: `GET /focus-sessions/presets`, `POST /focus-sessions`, `GET /focus-sessions/active`.

- [ ] **Step 1: Create the router with presets, start, and active**

Create `artifacts/api-server/src/routes/focus-sessions.ts`:

```ts
import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, tasksTable, focusSessionsTable, type FocusSession } from "@workspace/db";
import { PRESETS, getPreset } from "../lib/focus-sessions";

const router: IRouter = Router();

function formatSession(s: FocusSession) {
  return {
    id: s.id,
    userId: s.userId,
    taskId: s.taskId ?? null,
    preset: s.preset,
    focusMinutes: s.focusMinutes,
    breakMinutes: s.breakMinutes,
    longBreakMinutes: s.longBreakMinutes,
    longBreakEvery: s.longBreakEvery,
    plannedCycles: s.plannedCycles,
    completedIntervals: s.completedIntervals,
    focusedSeconds: s.focusedSeconds,
    xpAwarded: s.xpAwarded,
    status: s.status,
    startedAt: s.startedAt.toISOString(),
    lastIntervalAt: s.lastIntervalAt ? s.lastIntervalAt.toISOString() : null,
    endedAt: s.endedAt ? s.endedAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
  };
}

// Preset catalog — the client renders its picker and running timer from this so
// labels/durations never drift from the server.
router.get("/focus-sessions/presets", (_req, res): void => {
  res.json(Object.values(PRESETS).map((p) => ({
    key: p.key,
    label: p.label,
    focusMinutes: p.focusMinutes,
    breakMinutes: p.breakMinutes,
    longBreakMinutes: p.longBreakMinutes,
    longBreakEvery: p.longBreakEvery,
    plannedCycles: p.plannedCycles,
  })));
});

// The user's current active session, or null (drives resume-on-load).
router.get("/focus-sessions/active", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const [active] = await db.select().from(focusSessionsTable)
    .where(and(eq(focusSessionsTable.userId, userId), eq(focusSessionsTable.status, "active")))
    .orderBy(desc(focusSessionsTable.startedAt));
  res.json(active ? formatSession(active) : null);
});

// Start a session. 409s if one is already active (client should resume it).
router.post("/focus-sessions", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const { preset, taskId } = req.body as { preset?: string; taskId?: number };
  const config = preset ? getPreset(preset) : undefined;
  if (!config) { res.status(400).json({ error: "Unknown preset" }); return; }

  const [existingActive] = await db.select().from(focusSessionsTable)
    .where(and(eq(focusSessionsTable.userId, userId), eq(focusSessionsTable.status, "active")));
  if (existingActive) {
    res.status(409).json({ error: "A focus session is already active", session: formatSession(existingActive) });
    return;
  }

  if (taskId != null) {
    const [task] = await db.select().from(tasksTable)
      .where(and(eq(tasksTable.id, taskId), eq(tasksTable.userId, userId)));
    if (!task) { res.status(400).json({ error: "Task not found" }); return; }
    if (task.completed) { res.status(400).json({ error: "Cannot focus on a completed quest" }); return; }
  }

  const [session] = await db.insert(focusSessionsTable).values({
    userId,
    taskId: taskId ?? null,
    preset: config.key,
    focusMinutes: config.focusMinutes,
    breakMinutes: config.breakMinutes,
    longBreakMinutes: config.longBreakMinutes,
    longBreakEvery: config.longBreakEvery,
    plannedCycles: config.plannedCycles,
  }).returning();

  res.status(201).json(formatSession(session));
});

export default router;
```

Every import above is used by this task's three routes. Tasks 4–5 extend the import lines as they add endpoints.

- [ ] **Step 2: Mount the router**

In `artifacts/api-server/src/routes/index.ts`, add the import after the `calendarRouter` import:

```ts
import focusSessionsRouter from "./focus-sessions";
```

and add the mount after `router.use(calendarRouter);`:

```ts
router.use(focusSessionsRouter);
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Verify the endpoints live**

Run the API locally, then exercise the read endpoint (auth-free presets):

```bash
pnpm --filter @workspace/api-server dev
```

In a second shell:

```bash
curl -s http://localhost:8080/api/focus-sessions/presets
```

Expected: JSON array of 3 presets (`classic`, `deep`, `short`) with the numbers from Global Constraints. (`/active` and `POST` require an authenticated session and are exercised end-to-end in Task 9.) Stop the dev server afterward.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/focus-sessions.ts artifacts/api-server/src/routes/index.ts
git commit -m "$(cat <<'EOF'
feat(api): focus-session presets/start/active endpoints

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Route — credit a focus interval (transactional core)

**Files:**
- Modify: `artifacts/api-server/src/routes/focus-sessions.ts`

**Interfaces:**
- Consumes: `formatSession`, the pure lib helpers, and `usersTable`/`tasksTable`/`activityTable`.
- Produces: `POST /focus-sessions/:id/interval` returning `{ session, xpDelta }`.

- [ ] **Step 1: Add the interval endpoint**

In `artifacts/api-server/src/routes/focus-sessions.ts`, extend the imports:
- change the `@workspace/db` import to `import { db, usersTable, tasksTable, activityTable, focusSessionsTable, type FocusSession } from "@workspace/db";`
- change the lib import to `import { PRESETS, getPreset, computeIntervalXp, expectedElapsedSeconds, FULL_SET_BONUS, GRACE_SECONDS } from "../lib/focus-sessions";`

Then insert this route immediately before the final `export default router;`:

```ts
// Credit the NEXT completed focus interval. Idempotent on intervalIndex; XP is
// server-computed from validated wall-clock elapsed.
router.post("/focus-sessions/:id/interval", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const intervalIndex = Number((req.body as { intervalIndex?: number }).intervalIndex);
  if (!Number.isInteger(intervalIndex) || intervalIndex < 1) {
    res.status(400).json({ error: "intervalIndex must be a positive integer" });
    return;
  }

  const now = new Date();

  type Outcome =
    | { status: "not_found" }
    | { status: "not_active" }
    | { status: "duplicate"; session: FocusSession }
    | { status: "gap" }
    | { status: "too_early" }
    | { status: "ok"; session: FocusSession; xpDelta: number };

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    // Lock the user row so concurrent credits can't read stale point totals.
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).for("update");
    if (!user) return { status: "not_found" };

    const [session] = await tx.select().from(focusSessionsTable)
      .where(and(eq(focusSessionsTable.id, id), eq(focusSessionsTable.userId, userId)))
      .for("update");
    if (!session) return { status: "not_found" };
    if (session.status !== "active") return { status: "not_active" };

    // Ordering / idempotency.
    if (intervalIndex <= session.completedIntervals) return { status: "duplicate", session };
    if (intervalIndex !== session.completedIntervals + 1) return { status: "gap" };

    // Anti-cheat: breaks-excluded wall-clock lower bound.
    const requiredSec = expectedElapsedSeconds(session.focusMinutes, intervalIndex) - GRACE_SECONDS;
    const elapsedSec = Math.floor((now.getTime() - session.startedAt.getTime()) / 1000);
    if (elapsedSec < requiredSec) return { status: "too_early" };

    const intervalXp = computeIntervalXp(session.focusMinutes);
    const isFinal = intervalIndex === session.plannedCycles;
    const xpDelta = intervalXp + (isFinal ? FULL_SET_BONUS : 0);

    await tx.update(usersTable).set({
      totalPoints: user.totalPoints + xpDelta,
      weeklyPoints: user.weeklyPoints + xpDelta,
    }).where(eq(usersTable.id, userId));

    const [updated] = await tx.update(focusSessionsTable).set({
      completedIntervals: intervalIndex,
      focusedSeconds: session.focusedSeconds + session.focusMinutes * 60,
      xpAwarded: session.xpAwarded + xpDelta,
      lastIntervalAt: now,
      ...(isFinal ? { status: "completed", endedAt: now } : {}),
    }).where(eq(focusSessionsTable.id, id)).returning();

    // Roll the completed focus block into the linked task, if any.
    if (session.taskId != null) {
      const [task] = await tx.select().from(tasksTable)
        .where(and(eq(tasksTable.id, session.taskId), eq(tasksTable.userId, userId)));
      if (task) {
        await tx.update(tasksTable)
          .set({ actualMinutes: (task.actualMinutes ?? 0) + session.focusMinutes })
          .where(eq(tasksTable.id, session.taskId));
      }
    }

    // One activity row per interval keeps points and the feed in agreement even
    // if the session is later abandoned.
    await tx.insert(activityTable).values({
      userId,
      type: "focus_session",
      description: `Focused ${session.focusMinutes} min`,
      points: intervalXp,
    });
    if (isFinal) {
      await tx.insert(activityTable).values({
        userId,
        type: "focus_complete",
        description: `Completed focus session · ${session.plannedCycles} cycles`,
        points: FULL_SET_BONUS,
      });
    }

    return { status: "ok", session: updated, xpDelta };
  });

  switch (outcome.status) {
    case "not_found": res.status(404).json({ error: "Focus session not found" }); return;
    case "not_active": res.status(409).json({ error: "Focus session is not active" }); return;
    case "gap": res.status(409).json({ error: "Interval out of order" }); return;
    case "too_early": res.status(409).json({ error: "Interval not yet elapsed" }); return;
    case "duplicate": res.status(200).json({ session: formatSession(outcome.session), xpDelta: 0 }); return;
    case "ok": res.status(200).json({ session: formatSession(outcome.session), xpDelta: outcome.xpDelta }); return;
  }
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. Every newly-added import (`usersTable`, `activityTable`, `computeIntervalXp`, `expectedElapsedSeconds`, `FULL_SET_BONUS`, `GRACE_SECONDS`) is used by this route.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/routes/focus-sessions.ts
git commit -m "$(cat <<'EOF'
feat(api): credit focus intervals with server-computed XP

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Route — complete and list

**Files:**
- Modify: `artifacts/api-server/src/routes/focus-sessions.ts`

**Interfaces:**
- Consumes: `formatSession`, `computePartialXp`.
- Produces: `POST /focus-sessions/:id/complete` returning `{ session, xpDelta }`; `GET /focus-sessions?limit=` returning `FocusSession[]`.

- [ ] **Step 1: Add the complete and list endpoints**

Add `computePartialXp` to the `../lib/focus-sessions` import (it becomes `import { PRESETS, getPreset, computeIntervalXp, computePartialXp, expectedElapsedSeconds, FULL_SET_BONUS, GRACE_SECONDS } from "../lib/focus-sessions";`). Insert these two routes immediately before `export default router;`:

```ts
// End a session early. Credits trailing partial focus time (clamped to wall-clock),
// then marks the session stopped. Idempotent on an already-ended session.
router.post("/focus-sessions/:id/complete", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const partialClaimRaw = Number((req.body as { partialSeconds?: number }).partialSeconds ?? 0);
  const partialClaim = Number.isFinite(partialClaimRaw) && partialClaimRaw > 0 ? Math.floor(partialClaimRaw) : 0;
  const now = new Date();

  type Outcome =
    | { status: "not_found" }
    | { status: "ok"; session: FocusSession; xpDelta: number };

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).for("update");
    if (!user) return { status: "not_found" };

    const [session] = await tx.select().from(focusSessionsTable)
      .where(and(eq(focusSessionsTable.id, id), eq(focusSessionsTable.userId, userId)))
      .for("update");
    if (!session) return { status: "not_found" };

    // Already ended: idempotent no-op.
    if (session.status !== "active") return { status: "ok", session, xpDelta: 0 };

    // Clamp claimed partial focus to [0, focusMinutes*60] and to real elapsed since last activity.
    const sinceRefSec = Math.floor((now.getTime() - (session.lastIntervalAt ?? session.startedAt).getTime()) / 1000);
    const cappedSeconds = Math.max(0, Math.min(partialClaim, session.focusMinutes * 60, sinceRefSec));
    const partialMinutes = Math.floor(cappedSeconds / 60);
    const xpDelta = computePartialXp(partialMinutes);

    if (xpDelta > 0) {
      await tx.update(usersTable).set({
        totalPoints: user.totalPoints + xpDelta,
        weeklyPoints: user.weeklyPoints + xpDelta,
      }).where(eq(usersTable.id, userId));

      if (session.taskId != null) {
        const [task] = await tx.select().from(tasksTable)
          .where(and(eq(tasksTable.id, session.taskId), eq(tasksTable.userId, userId)));
        if (task) {
          await tx.update(tasksTable)
            .set({ actualMinutes: (task.actualMinutes ?? 0) + partialMinutes })
            .where(eq(tasksTable.id, session.taskId));
        }
      }

      await tx.insert(activityTable).values({
        userId,
        type: "focus_session",
        description: `Focused ${partialMinutes} min`,
        points: xpDelta,
      });
    }

    const [updated] = await tx.update(focusSessionsTable).set({
      status: "stopped",
      endedAt: now,
      focusedSeconds: session.focusedSeconds + partialMinutes * 60,
      xpAwarded: session.xpAwarded + xpDelta,
    }).where(eq(focusSessionsTable.id, id)).returning();

    return { status: "ok", session: updated, xpDelta };
  });

  if (outcome.status === "not_found") { res.status(404).json({ error: "Focus session not found" }); return; }
  res.status(200).json({ session: formatSession(outcome.session), xpDelta: outcome.xpDelta });
});

// Recent sessions for the current user (history / insights surface).
router.get("/focus-sessions", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const limitRaw = Number(req.query.limit ?? 20);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), 100) : 20;

  const sessions = await db.select().from(focusSessionsTable)
    .where(eq(focusSessionsTable.userId, userId))
    .orderBy(desc(focusSessionsTable.startedAt))
    .limit(limit);

  res.json(sessions.map(formatSession));
});
```

- [ ] **Step 2: Confirm all imports are used**

`PRESETS`/`getPreset` (presets/start), `computeIntervalXp`/`expectedElapsedSeconds`/`FULL_SET_BONUS`/`GRACE_SECONDS` (interval), and now `computePartialXp` (complete) are all referenced. No unused imports should remain.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/focus-sessions.ts
git commit -m "$(cat <<'EOF'
feat(api): complete and list focus sessions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: OpenAPI spec + codegen

**Files:**
- Modify: `lib/api-spec/openapi.yaml`

**Interfaces:**
- Produces (via orval): query hooks `useGetFocusPresets`, `useGetActiveFocusSession`, `useListFocusSessions` (+ key helpers `getGetFocusPresetsQueryKey`, `getGetActiveFocusSessionQueryKey`, `getListFocusSessionsQueryKey`); mutation hooks `useStartFocusSession`, `useCreditFocusInterval`, `useCompleteFocusSession`; and types `FocusPreset`, `FocusSession`, `FocusSessionResult`, `StartFocusSessionInput`, `FocusIntervalInput`, `FocusCompleteInput`.

- [ ] **Step 1: Add a `focus` tag**

In `lib/api-spec/openapi.yaml`, under the top-level `tags:` list, add after the `calendar` tag entry:

```yaml
  - name: focus
    description: Focus sessions and Pomodoro timer
```

- [ ] **Step 2: Add the paths**

In the `paths:` section (e.g. immediately after the `/tasks/{id}/focus` block, before the badges paths), add:

```yaml
  /focus-sessions/presets:
    get:
      operationId: getFocusPresets
      tags: [focus]
      summary: List Pomodoro presets
      responses:
        "200":
          description: Preset catalog
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/FocusPreset"

  /focus-sessions:
    get:
      operationId: listFocusSessions
      tags: [focus]
      summary: List recent focus sessions
      parameters:
        - name: limit
          in: query
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 20
      responses:
        "200":
          description: Recent sessions, newest first
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/FocusSession"
    post:
      operationId: startFocusSession
      tags: [focus]
      summary: Start a focus session
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/StartFocusSessionInput"
      responses:
        "201":
          description: Session started
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/FocusSession"
        "409":
          description: A session is already active

  /focus-sessions/active:
    get:
      operationId: getActiveFocusSession
      tags: [focus]
      summary: Get the current active session, or null
      responses:
        "200":
          description: The active session, or null
          content:
            application/json:
              schema:
                anyOf:
                  - $ref: "#/components/schemas/FocusSession"
                  - type: "null"

  /focus-sessions/{id}/interval:
    post:
      operationId: creditFocusInterval
      tags: [focus]
      summary: Credit a completed focus interval
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/FocusIntervalInput"
      responses:
        "200":
          description: Interval credited (xpDelta is 0 for a duplicate)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/FocusSessionResult"

  /focus-sessions/{id}/complete:
    post:
      operationId: completeFocusSession
      tags: [focus]
      summary: End a focus session early
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: false
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/FocusCompleteInput"
      responses:
        "200":
          description: Session ended
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/FocusSessionResult"
```

- [ ] **Step 3: Add the schemas**

Under `components: > schemas:` (e.g. after the `HeatmapResponse` schema at the end), add:

```yaml
    FocusPreset:
      type: object
      required: [key, label, focusMinutes, breakMinutes, longBreakMinutes, longBreakEvery, plannedCycles]
      properties:
        key:
          type: string
          enum: [classic, deep, short]
        label:
          type: string
        focusMinutes:
          type: integer
        breakMinutes:
          type: integer
        longBreakMinutes:
          type: integer
        longBreakEvery:
          type: integer
        plannedCycles:
          type: integer

    FocusSession:
      type: object
      required: [id, userId, taskId, preset, focusMinutes, breakMinutes, longBreakMinutes, longBreakEvery, plannedCycles, completedIntervals, focusedSeconds, xpAwarded, status, startedAt, lastIntervalAt, endedAt, createdAt]
      properties:
        id:
          type: integer
        userId:
          type: integer
        taskId:
          type: ["integer", "null"]
        preset:
          type: string
          enum: [classic, deep, short]
        focusMinutes:
          type: integer
        breakMinutes:
          type: integer
        longBreakMinutes:
          type: integer
        longBreakEvery:
          type: integer
        plannedCycles:
          type: integer
        completedIntervals:
          type: integer
        focusedSeconds:
          type: integer
        xpAwarded:
          type: integer
        status:
          type: string
          enum: [active, completed, stopped]
        startedAt:
          type: string
        lastIntervalAt:
          type: ["string", "null"]
        endedAt:
          type: ["string", "null"]
        createdAt:
          type: string

    FocusSessionResult:
      type: object
      required: [session, xpDelta]
      properties:
        session:
          $ref: "#/components/schemas/FocusSession"
        xpDelta:
          type: integer

    StartFocusSessionInput:
      type: object
      required: [preset]
      properties:
        preset:
          type: string
          enum: [classic, deep, short]
        taskId:
          type: integer
          description: Optional quest to focus on

    FocusIntervalInput:
      type: object
      required: [intervalIndex]
      properties:
        intervalIndex:
          type: integer
          minimum: 1
          description: 1-based index of the focus interval that just completed

    FocusCompleteInput:
      type: object
      properties:
        partialSeconds:
          type: integer
          minimum: 0
          description: Seconds focused in the in-progress interval when stopping mid-focus
```

- [ ] **Step 4: Regenerate the client**

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: completes without error; new hooks appear under `lib/api-client-react/src/generated`.

- [ ] **Step 5: Verify the hooks were generated**

Run:

```bash
grep -rhoE "use(GetFocusPresets|GetActiveFocusSession|ListFocusSessions|StartFocusSession|CreditFocusInterval|CompleteFocusSession)" lib/api-client-react/src/generated | sort -u
```

Expected: all six hook names listed.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react lib/api-zod
git commit -m "$(cat <<'EOF'
feat(api-spec): focus-session endpoints + regenerate client

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Pure client timer state machine

**Files:**
- Create: `artifacts/focusquest/src/lib/pomodoro.ts`
- Test: `artifacts/focusquest/src/lib/pomodoro.test.ts`

**Interfaces:**
- Produces:
  - `type Phase = "focus" | "break" | "longBreak" | "done"`
  - `interface TimerConfig { focusMinutes: number; breakMinutes: number; longBreakMinutes: number; longBreakEvery: number; plannedCycles: number }`
  - `interface TimerState { phase: Phase; cycleIndex: number; remainingSeconds: number; completedIntervals: number }`
  - `function reconstructTimerState(config: TimerConfig, startedAtMs: number, nowMs: number): TimerState`
  - `function isStaleGap(config: TimerConfig, lastActivityMs: number, nowMs: number): boolean`

- [ ] **Step 1: Write the failing test**

Create `artifacts/focusquest/src/lib/pomodoro.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { reconstructTimerState, isStaleGap, type TimerConfig } from "./pomodoro";

const classic: TimerConfig = { focusMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4, plannedCycles: 4 };
const MIN = 60_000;

describe("reconstructTimerState", () => {
  it("is in focus 1 near the start", () => {
    const s = reconstructTimerState(classic, 0, 10 * MIN);
    expect(s).toMatchObject({ phase: "focus", cycleIndex: 1, completedIntervals: 0 });
    expect(s.remainingSeconds).toBe(15 * 60);
  });

  it("is on the short break after focus 1", () => {
    const s = reconstructTimerState(classic, 0, 27 * MIN); // 25 focus + 2 into break
    expect(s).toMatchObject({ phase: "break", cycleIndex: 1, completedIntervals: 1 });
    expect(s.remainingSeconds).toBe(3 * 60);
  });

  it("is in focus 2 after the first break", () => {
    const s = reconstructTimerState(classic, 0, 32 * MIN); // 25 + 5 + 2
    expect(s).toMatchObject({ phase: "focus", cycleIndex: 2, completedIntervals: 1 });
  });

  it("uses the long break after cycle 4's boundary rule", () => {
    // 3 full cycles = 3*(25+5)=90; then focus 4 = 25 -> 115; no break after the last focus.
    const s = reconstructTimerState(classic, 0, 100 * MIN); // during focus 4
    expect(s).toMatchObject({ phase: "focus", cycleIndex: 4, completedIntervals: 3 });
  });

  it("is done past the whole session", () => {
    const s = reconstructTimerState(classic, 0, 999 * MIN);
    expect(s).toMatchObject({ phase: "done", completedIntervals: 4, remainingSeconds: 0 });
  });
});

describe("isStaleGap", () => {
  it("is false for a short gap", () => {
    expect(isStaleGap(classic, 0, 10 * MIN)).toBe(false);
  });
  it("is true past one focus + long break", () => {
    // threshold = (25 + 15) * 60 = 2400s = 40 min
    expect(isStaleGap(classic, 0, 41 * MIN)).toBe(true);
    expect(isStaleGap(classic, 0, 39 * MIN)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/focusquest test`
Expected: FAIL — cannot resolve `./pomodoro`.

- [ ] **Step 3: Write the implementation**

Create `artifacts/focusquest/src/lib/pomodoro.ts`:

```ts
export type Phase = "focus" | "break" | "longBreak" | "done";

export interface TimerConfig {
  focusMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  longBreakEvery: number; // long break after every N focus intervals
  plannedCycles: number;  // total focus intervals
}

export interface TimerState {
  phase: Phase;
  cycleIndex: number;         // 1-based current (or just-finished) focus interval
  remainingSeconds: number;   // seconds left in the current phase (0 when done)
  completedIntervals: number; // focus intervals fully elapsed by now
}

/**
 * Given the session config and wall-clock timestamps, return where the timer is now.
 * Walks focus -> break -> (long break every N) up to plannedCycles; there is no break
 * after the final focus interval.
 */
export function reconstructTimerState(config: TimerConfig, startedAtMs: number, nowMs: number): TimerState {
  let t = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  const focusSec = config.focusMinutes * 60;
  let completed = 0;

  for (let cycle = 1; cycle <= config.plannedCycles; cycle++) {
    if (t < focusSec) {
      return { phase: "focus", cycleIndex: cycle, remainingSeconds: focusSec - t, completedIntervals: completed };
    }
    t -= focusSec;
    completed = cycle;

    if (cycle === config.plannedCycles) break; // no break after the last focus block

    const isLong = cycle % config.longBreakEvery === 0;
    const breakSec = (isLong ? config.longBreakMinutes : config.breakMinutes) * 60;
    if (t < breakSec) {
      return {
        phase: isLong ? "longBreak" : "break",
        cycleIndex: cycle,
        remainingSeconds: breakSec - t,
        completedIntervals: completed,
      };
    }
    t -= breakSec;
  }

  return { phase: "done", cycleIndex: config.plannedCycles, remainingSeconds: 0, completedIntervals: config.plannedCycles };
}

/**
 * True when the time since the last credited interval (or start) exceeds one
 * focus + long-break span — i.e. the user was clearly absent and the session
 * should be finalized with only banked intervals rather than back-credited.
 */
export function isStaleGap(config: TimerConfig, lastActivityMs: number, nowMs: number): boolean {
  const gapSec = Math.floor((nowMs - lastActivityMs) / 1000);
  return gapSec > (config.focusMinutes + config.longBreakMinutes) * 60;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @workspace/focusquest test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/lib/pomodoro.ts artifacts/focusquest/src/lib/pomodoro.test.ts
git commit -m "$(cat <<'EOF'
feat(web): pure Pomodoro timer state machine

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `/focus` page, nav, and dashboard entry

**Files:**
- Create: `artifacts/focusquest/src/pages/focus.tsx`
- Modify: `artifacts/focusquest/src/App.tsx`
- Modify: `artifacts/focusquest/src/components/layout.tsx`
- Modify: `artifacts/focusquest/src/pages/dashboard.tsx`

**Interfaces:**
- Consumes: generated hooks from Task 6 (`useGetFocusPresets`, `useGetActiveFocusSession`, `useStartFocusSession`, `useCreditFocusInterval`, `useCompleteFocusSession`, `useGetTasks`) and `reconstructTimerState`/`isStaleGap` from `@/lib/pomodoro`.
- Produces: a default-exported `Focus` page component mounted at `/focus`.

- [ ] **Step 1: Create the page**

Create `artifacts/focusquest/src/pages/focus.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFocusPresets,
  useGetActiveFocusSession,
  useStartFocusSession,
  useCreditFocusInterval,
  useCompleteFocusSession,
  useGetTasks,
  getGetActiveFocusSessionQueryKey,
  getGetMyStatsQueryKey,
  type FocusPreset,
  type FocusSession,
} from "@workspace/api-client-react";
import { reconstructTimerState, isStaleGap, type TimerConfig } from "@/lib/pomodoro";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Timer, Pause, Play, Square } from "lucide-react";

function configOf(s: FocusSession): TimerConfig {
  return {
    focusMinutes: s.focusMinutes,
    breakMinutes: s.breakMinutes,
    longBreakMinutes: s.longBreakMinutes,
    longBreakEvery: s.longBreakEvery,
    plannedCycles: s.plannedCycles,
  };
}

function fmt(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

const PHASE_LABEL: Record<string, string> = { focus: "Focus", break: "Break", longBreak: "Long break", done: "Done" };

export default function Focus() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const presetsQuery = useGetFocusPresets();
  const activeQuery = useGetActiveFocusSession();
  const tasksQuery = useGetTasks({ completed: false });

  const startMut = useStartFocusSession();
  const intervalMut = useCreditFocusInterval();
  const completeMut = useCompleteFocusSession();

  const active = activeQuery.data ?? null;

  // Idle-form state.
  const [presetKey, setPresetKey] = useState<string>("classic");
  const [taskId, setTaskId] = useState<number | null>(null);

  // Ticking clock + pause accounting (client-only; a reload cancels pause).
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pausedAtMs, setPausedAtMs] = useState<number | null>(null);
  const pausedAccumRef = useRef(0);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Effective "now" excludes accumulated paused time.
  const effectiveNowMs = (pausedAtMs ?? nowMs) - pausedAccumRef.current;

  const state = useMemo(() => {
    if (!active) return null;
    return reconstructTimerState(configOf(active), new Date(active.startedAt).getTime(), effectiveNowMs);
  }, [active, effectiveNowMs]);

  // Track the highest interval index we've asked the server to credit.
  const creditedRef = useRef(0);
  useEffect(() => {
    creditedRef.current = active?.completedIntervals ?? 0;
  }, [active?.id, active?.completedIntervals]);

  // On load: finalize a stale (abandoned) session instead of back-crediting it.
  const staleHandledRef = useRef<number | null>(null);
  useEffect(() => {
    if (!active) return;
    if (staleHandledRef.current === active.id) return;
    const last = new Date(active.lastIntervalAt ?? active.startedAt).getTime();
    if (isStaleGap(configOf(active), last, Date.now())) {
      staleHandledRef.current = active.id;
      completeMut.mutate(
        { id: active.id, data: { partialSeconds: 0 } },
        { onSettled: () => qc.invalidateQueries({ queryKey: getGetActiveFocusSessionQueryKey() }) },
      );
    }
  }, [active, completeMut, qc]);

  // Credit focus intervals as their boundaries pass (works with pause for free,
  // since effectiveNow — and thus completedIntervals — only advances when running).
  useEffect(() => {
    if (!active || !state) return;
    if (intervalMut.isPending) return;
    const next = creditedRef.current + 1;
    if (state.completedIntervals >= next && next <= active.plannedCycles) {
      creditedRef.current = next;
      intervalMut.mutate(
        { id: active.id, data: { intervalIndex: next } },
        {
          onSuccess: (res) => {
            if (res.xpDelta > 0) toast({ title: `+${res.xpDelta} XP`, description: "Focus block banked", className: "border-primary bg-primary/10" });
            qc.invalidateQueries({ queryKey: getGetActiveFocusSessionQueryKey() });
            qc.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
            if (res.session.status === "completed") {
              toast({ title: "Session complete!", description: `Focused ${Math.round(res.session.focusedSeconds / 60)} min`, className: "border-primary bg-primary/10" });
            }
          },
          onError: () => { creditedRef.current = next - 1; }, // allow retry on the next tick
        },
      );
    }
  }, [active, state, intervalMut, qc, toast]);

  function handleStart() {
    startMut.mutate(
      { data: { preset: presetKey, taskId: taskId ?? undefined } },
      {
        onSuccess: () => {
          pausedAccumRef.current = 0;
          setPausedAtMs(null);
          qc.invalidateQueries({ queryKey: getGetActiveFocusSessionQueryKey() });
        },
        onError: () => {
          // A 409 means a session is already active — just refetch and resume it.
          qc.invalidateQueries({ queryKey: getGetActiveFocusSessionQueryKey() });
        },
      },
    );
  }

  function togglePause() {
    if (pausedAtMs == null) {
      setPausedAtMs(Date.now());
    } else {
      pausedAccumRef.current += Date.now() - pausedAtMs;
      setPausedAtMs(null);
    }
  }

  function handleStop() {
    if (!active || !state) return;
    const partialSeconds = state.phase === "focus" ? active.focusMinutes * 60 - state.remainingSeconds : 0;
    completeMut.mutate(
      { id: active.id, data: { partialSeconds: Math.max(0, Math.floor(partialSeconds)) } },
      {
        onSettled: () => {
          qc.invalidateQueries({ queryKey: getGetActiveFocusSessionQueryKey() });
          qc.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
        },
        onSuccess: (res) => {
          toast({ title: "Session ended", description: res.xpDelta > 0 ? `+${res.xpDelta} XP` : undefined, className: "border-primary bg-primary/10" });
        },
      },
    );
  }

  if (activeQuery.isLoading) {
    return <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>;
  }

  // ── Active session view ────────────────────────────────────────────────────
  if (active && state && active.status === "active") {
    const paused = pausedAtMs != null;
    return (
      <div className="max-w-md mx-auto space-y-6">
        <h1 className="text-xl font-bold flex items-center gap-2"><Timer className="w-5 h-5 text-primary" /> Focus Session</h1>
        <Card>
          <CardContent className="pt-6 text-center space-y-4">
            <p className="text-sm uppercase tracking-wide text-muted-foreground">{PHASE_LABEL[state.phase]}</p>
            <p className="text-6xl font-mono font-bold tabular-nums">{fmt(state.remainingSeconds)}</p>
            <div className="flex justify-center gap-1.5" aria-label="Cycle progress">
              {Array.from({ length: active.plannedCycles }).map((_, i) => (
                <span key={i} className={`w-3 h-3 rounded-full ${i < state.completedIntervals ? "bg-primary" : "bg-muted"}`} />
              ))}
            </div>
            {paused && <p className="text-xs text-muted-foreground">Paused</p>}
            <div className="flex justify-center gap-3 pt-2">
              <Button variant="outline" onClick={togglePause}>
                {paused ? <><Play className="w-4 h-4 mr-1" /> Resume</> : <><Pause className="w-4 h-4 mr-1" /> Pause</>}
              </Button>
              <Button variant="destructive" onClick={handleStop} disabled={completeMut.isPending}>
                <Square className="w-4 h-4 mr-1" /> Stop
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Idle view ──────────────────────────────────────────────────────────────
  const presets: FocusPreset[] = presetsQuery.data ?? [];
  const openTasks = tasksQuery.data ?? [];
  return (
    <div className="max-w-md mx-auto space-y-6">
      <h1 className="text-xl font-bold flex items-center gap-2"><Timer className="w-5 h-5 text-primary" /> Focus Session</h1>

      <div className="space-y-2">
        <p className="text-sm font-medium">Choose a rhythm</p>
        <div className="grid grid-cols-1 gap-2">
          {presets.map((p) => (
            <button
              key={p.key}
              onClick={() => setPresetKey(p.key)}
              className={`text-left rounded-md border px-4 py-3 transition-colors ${presetKey === p.key ? "border-primary bg-primary/10" : "border-input hover:bg-muted"}`}
            >
              <span className="font-semibold">{p.label}</span>
              <span className="block text-xs text-muted-foreground">
                {p.plannedCycles} × {p.focusMinutes} min focus · {p.breakMinutes} min breaks
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="focus-task" className="text-sm font-medium">Focus on a quest (optional)</label>
        <select
          id="focus-task"
          value={taskId ?? ""}
          onChange={(e) => setTaskId(e.target.value ? Number(e.target.value) : null)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">Just focus (no quest)</option>
          {openTasks.map((t) => (
            <option key={t.id} value={t.id}>{t.title}</option>
          ))}
        </select>
      </div>

      <Button className="w-full" onClick={handleStart} disabled={startMut.isPending || presets.length === 0}>
        {startMut.isPending ? "Starting…" : "Start Focus"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Add the route in `App.tsx`**

In `artifacts/focusquest/src/App.tsx`, add the import beside the other page imports (after `import DopamineMenu ...`):

```tsx
import Focus from "@/pages/focus";
```

and add the route inside `<Switch>` (after the `/tasks` route):

```tsx
<Route path="/focus" component={Focus} />
```

- [ ] **Step 3: Add the nav item in `layout.tsx`**

In `artifacts/focusquest/src/components/layout.tsx`, add `Timer` to the existing `lucide-react` import, then add this entry to the `navItems` array (after the `/tasks` entry):

```tsx
  { href: "/focus",          label: "Focus",      icon: Timer,       mobileShow: true },
```

- [ ] **Step 4: Add the dashboard entry point**

In `artifacts/focusquest/src/pages/dashboard.tsx`, `Link` and `Button` are already imported. Add `Timer` to the existing `lucide-react` import. Then, in the authenticated content return (the non-skeleton branch), insert this CTA as the first child, immediately before the stat-cards grid (`<div className="grid grid-cols-2 md:grid-cols-4 gap-4">`):

```tsx
<Link href="/focus">
  <Button className="w-full sm:w-auto gap-2">
    <Timer className="w-4 h-4" /> Start focus session
  </Button>
</Link>
```

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/focusquest/src/pages/focus.tsx artifacts/focusquest/src/App.tsx artifacts/focusquest/src/components/layout.tsx artifacts/focusquest/src/pages/dashboard.tsx
git commit -m "$(cat <<'EOF'
feat(web): focus session page, nav, and dashboard entry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Run all tests and the typecheck gate**

Run:

```bash
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/focusquest test
pnpm typecheck
```

Expected: all suites PASS; typecheck clean.

- [ ] **Step 2: Exercise a live session**

Start the app (API + web) and log in. On the dashboard, click **Start focus session**. On `/focus`:

- Pick **Short 15/3** (shortest to observe), optionally link an open quest, click **Start Focus**.
- Confirm the countdown renders, the phase label reads **Focus**, and the cycle dots show `○○○○`.
- Use **Pause/Resume** and confirm the countdown halts and resumes.
- Reload the page mid-focus and confirm the session **resumes** at the right remaining time (via `GET /focus-sessions/active`).
- Let (or fast-path in dev by temporarily shrinking a preset) a focus interval elapse; confirm a **+XP toast** appears, a dot fills, and `GET /users/me/stats` XP increases.
- Click **Stop** mid-focus; confirm the session ends, a partial-XP toast shows, and the page returns to the idle picker.
- If a quest was linked, confirm its `actualMinutes` increased (via the quest in the Quests list / API).

- [ ] **Step 3: Confirm no active-session leak**

After stopping, reload `/focus` and confirm it shows the **idle picker** (no lingering active session), and starting again works.

- [ ] **Step 4: Final commit (if any verification fixes were needed)**

Only if Step 2 surfaced fixes:

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix(web): focus session verification fixes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Pomodoro presets (classic/deep/short) → Task 2 (`PRESETS`), Task 6 (`FocusPreset`), Task 8 (picker). ✓
- Optional task link + `actualMinutes` roll-up → Task 1 (`taskId`), Tasks 4–5 (rollup), Task 8 (selector). ✓
- XP: 0.2/min + 5 block + 25 full-set, server-computed → Task 2 (helpers, tested), Task 4 (crediting). ✓
- Flat XP, no streak side effects, adds to total+weekly → Task 4/5 (only `totalPoints`/`weeklyPoints` updated). ✓
- One active session per user → Task 3 (409 on start). ✓
- Idempotent interval crediting + anti-cheat → Task 4 (ordering + `expectedElapsedSeconds`). ✓
- Complete (partial XP, clamped) + list → Task 5. ✓
- Resume + short-gap catch-up + stale-gap finalize → Task 7 (`reconstructTimerState`, `isStaleGap`), Task 8 (effects). ✓
- One activity row per interval + a completion row → Task 4. ✓
- `/focus` page, nav, dashboard entry → Task 8. ✓
- Edge cases (multiple active, double-fire, too-early, stop mid-break, task deleted, integer rounding) → Tasks 1/4/5. ✓
- Testing (pure server + client helpers) → Tasks 2 & 7. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands include expected output.

**Type consistency:** `FocusSession`, `TimerConfig`, `TimerState`, `computeIntervalXp`, `computePartialXp`, `expectedElapsedSeconds`, `reconstructTimerState`, `isStaleGap`, and the six hook names are used consistently across tasks. The `configOf()` helper maps a `FocusSession` to the `TimerConfig` shape the pure helper expects.

**Note vs spec:** the spec mentioned "toast/confetti"; there is no confetti utility in the repo, so completion feedback uses the existing `toast(...)` pattern only. No functional impact.
