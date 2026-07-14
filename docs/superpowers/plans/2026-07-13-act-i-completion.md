# Act I Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the last two Act I quests — Celebrate Starting (initiation XP for session starts, first steps, questline kickoffs, and the day's first move) and the Pick Three board states — plus the anti-shame copy fixes.

**Architecture:** A new `initiation_awards` ledger table is the source of truth for "already awarded?"; a pure evaluator in `api-server/src/lib/initiation.ts` holds every decision rule (fully unit-tested); a thin transactional orchestrator (`initiation-grant.ts`) gathers state, inserts ledger + activity rows with `onConflictDoNothing`, and bumps user points. Two endpoints call it: `POST /focus-sessions` (already transactional) and `PATCH /tasks/:id/steps/:stepId` (rewritten to be transactional). The web app toasts the awards and gains two new Today's Focus board states.

**Tech Stack:** Drizzle/Neon Postgres, Express, OpenAPI + orval codegen, React + TanStack Query, vitest.

**Spec:** `docs/superpowers/specs/2026-07-13-act-i-completion-design.md`

## Global Constraints

- **Branch:** all work on `feat/celebrate-starting`. Concurrent sessions share this working tree — run `git branch --show-current` and confirm `feat/celebrate-starting` before EVERY commit. Do NOT use git worktrees (repo lives under OneDrive; file locks break checkout/merge).
- **XP constants (verbatim from spec):** session_start +2, first_step +3, questline_kickoff +5, first_move +5, cooldown 10 minutes (≥ 10 min elapsed pays).
- **Anti-Shame law for all new copy:** celebrate what happened; never enumerate what didn't. No guilt, no threat framing, no midnight countdowns.
- **Never hand-edit** files under `*/src/generated` — regenerate with `pnpm --filter @workspace/api-spec codegen`.
- **Testing philosophy:** this repo has NO HTTP-endpoint test harness; all decision logic must live in pure lib functions with vitest coverage. Routes are thin wiring verified by `pnpm typecheck` + review.
- **Test commands:** `pnpm --filter @workspace/api-server test`, `pnpm --filter @workspace/focusquest test`. Single file: append `-- <name>`.
- **Typecheck:** `pnpm typecheck` (root).
- **drizzle push (Bash tool, POSIX):** the config does not load `.env` — export first. Additive changes apply without a destructive prompt. The first run is authoritative (a verification re-run may be blocked by an auto-mode guardrail).

---

### Task 1: `initiation_awards` schema + live push

**Files:**
- Create: `lib/db/src/schema/initiation-awards.ts`
- Modify: `lib/db/src/schema/index.ts`

**Interfaces:**
- Consumes: `usersTable` from `./users`.
- Produces: `initiationAwardsTable` (columns `id, userId, kind, refId, awardedAt`), type `InitiationAward` — exported via the `@workspace/db` barrel; Task 4's orchestrator queries it.

- [ ] **Step 1: Create the branch**

```bash
git branch --show-current   # expect: main
git checkout -b feat/celebrate-starting
```

- [ ] **Step 2: Write the schema file**

Create `lib/db/src/schema/initiation-awards.ts`:

```ts
import { pgTable, serial, integer, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const initiationAwardsTable = pgTable("initiation_awards", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull().references(() => usersTable.id),
  kind:      text("kind").notNull(),  // 'session_start' | 'first_step' | 'questline_kickoff' | 'first_move'
  refId:     integer("ref_id"),       // taskId for first_step, questlineId for questline_kickoff, else NULL
  awardedAt: timestamp("awarded_at").notNull().defaultNow(),
}, (t) => [
  // Race-safe once-ever guard for first_step / questline_kickoff. Postgres
  // treats NULL ref_id as distinct, so the time-window kinds never collide.
  uniqueIndex("initiation_awards_user_kind_ref_idx").on(t.userId, t.kind, t.refId),
  // Serves the cooldown and day-boundary "latest row" lookups.
  index("initiation_awards_user_kind_time_idx").on(t.userId, t.kind, t.awardedAt),
]);

export type InitiationAward = typeof initiationAwardsTable.$inferSelect;
```

- [ ] **Step 3: Export from the barrel**

In `lib/db/src/schema/index.ts` add after the `questlines` line:

```ts
export * from "./initiation-awards";
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (exit 0).

- [ ] **Step 5: Push the table to Neon (Bash tool)**

```bash
export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)"
pnpm --filter @workspace/db push
```

Expected: `[✓] Changes applied` with a new `initiation_awards` table, no destructive prompt.

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # expect: feat/celebrate-starting
git add lib/db/src/schema/initiation-awards.ts lib/db/src/schema/index.ts
git commit -m "feat(db): initiation_awards ledger for Celebrate Starting XP"
```

---

### Task 2: Pure initiation evaluator (TDD)

**Files:**
- Create: `artifacts/api-server/src/lib/initiation.ts`
- Test: `artifacts/api-server/src/lib/initiation.test.ts`

**Interfaces:**
- Consumes: nothing (pure module — no db imports; keeps the test dependency-free).
- Produces (used by Tasks 3–5):
  - constants `SESSION_START_XP = 2`, `FIRST_STEP_XP = 3`, `QUESTLINE_KICKOFF_XP = 5`, `FIRST_MOVE_XP = 5`, `SESSION_START_COOLDOWN_MS = 600_000`
  - types `InitiationKind`, `InitiationEvent`, `InitiationState`, `GrantedAward`, `InitiationXp`
  - `evaluateInitiationAwards(event: InitiationEvent, state: InitiationState, now: Date): GrantedAward[]`
  - `toInitiationXp(granted: GrantedAward[]): InitiationXp`

- [ ] **Step 1: Write the failing tests**

Create `artifacts/api-server/src/lib/initiation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  evaluateInitiationAwards, toInitiationXp,
  SESSION_START_XP, FIRST_STEP_XP, QUESTLINE_KICKOFF_XP, FIRST_MOVE_XP,
  SESSION_START_COOLDOWN_MS,
  type InitiationEvent, type InitiationState,
} from "./initiation";

const NOW = new Date("2026-07-13T18:00:00.000Z");
const DAY_START = new Date("2026-07-13T04:00:00.000Z"); // local midnight (America/New_York)

/** Baseline state: everything already awarded / on cooldown, so nothing fires. */
function quietState(over: Partial<InitiationState> = {}): InitiationState {
  return {
    lastSessionStartAwardAt: new Date(NOW.getTime() - 60_000), // 1 min ago → on cooldown
    taskFirstStepAwarded: true,
    questlineKickoffAwarded: true,
    lastFirstMoveAt: new Date(NOW.getTime() - 3_600_000),      // this local day
    dayStartUtc: DAY_START,
    questlineTitle: null,
    ...over,
  };
}

const sessionEvent = (task?: InitiationEvent["task"]): InitiationEvent =>
  ({ type: "session_start", task: task ?? null });
const stepEvent = (task: NonNullable<InitiationEvent["task"]>, otherStepsAlreadyDone: boolean): InitiationEvent =>
  ({ type: "step_check", task, otherStepsAlreadyDone });

const plainTask = { id: 42, title: "Fold laundry", questlineId: null };
const questlineTask = { id: 43, title: "Draft outline", questlineId: 7 };

describe("session_start cooldown", () => {
  it("awards when no start was ever awarded", () => {
    const g = evaluateInitiationAwards(sessionEvent(), quietState({ lastSessionStartAwardAt: null }), NOW);
    expect(g).toEqual([{ kind: "session_start", points: SESSION_START_XP, refId: null, description: "Started a focus session" }]);
  });
  it("does not award 9m59s after the last awarded start", () => {
    const last = new Date(NOW.getTime() - (SESSION_START_COOLDOWN_MS - 1_000));
    expect(evaluateInitiationAwards(sessionEvent(), quietState({ lastSessionStartAwardAt: last }), NOW)).toEqual([]);
  });
  it("awards at exactly 10 minutes (>= boundary pays)", () => {
    const last = new Date(NOW.getTime() - SESSION_START_COOLDOWN_MS);
    const g = evaluateInitiationAwards(sessionEvent(), quietState({ lastSessionStartAwardAt: last }), NOW);
    expect(g.map((a) => a.kind)).toEqual(["session_start"]);
  });
});

describe("first_step", () => {
  it("awards the first step of a quest once", () => {
    const g = evaluateInitiationAwards(
      stepEvent(plainTask, false),
      quietState({ taskFirstStepAwarded: false }),
      NOW,
    );
    expect(g).toEqual([{ kind: "first_step", points: FIRST_STEP_XP, refId: 42, description: 'Checked the first step of "Fold laundry"' }]);
  });
  it("stays sticky: no re-award after uncheck/recheck (ledger row exists)", () => {
    expect(evaluateInitiationAwards(stepEvent(plainTask, false), quietState(), NOW)).toEqual([]);
  });
  it("never awards when another step was already done (pre-feature progress)", () => {
    const g = evaluateInitiationAwards(stepEvent(plainTask, true), quietState({ taskFirstStepAwarded: false }), NOW);
    expect(g).toEqual([]);
  });
  it("never awards on a session_start event", () => {
    const g = evaluateInitiationAwards(sessionEvent(plainTask), quietState({ taskFirstStepAwarded: false }), NOW);
    expect(g).toEqual([]);
  });
});

describe("questline_kickoff", () => {
  it("fires on a session start on a questline task", () => {
    const g = evaluateInitiationAwards(
      sessionEvent(questlineTask),
      quietState({ questlineKickoffAwarded: false, questlineTitle: "Spring cleaning" }),
      NOW,
    );
    expect(g).toEqual([{ kind: "questline_kickoff", points: QUESTLINE_KICKOFF_XP, refId: 7, description: 'Kicked off "Spring cleaning"' }]);
  });
  it("fires on a step check on a questline task, with a title fallback", () => {
    const g = evaluateInitiationAwards(
      stepEvent(questlineTask, true),
      quietState({ questlineKickoffAwarded: false, questlineTitle: null }),
      NOW,
    );
    expect(g).toEqual([{ kind: "questline_kickoff", points: QUESTLINE_KICKOFF_XP, refId: 7, description: "Kicked off a questline" }]);
  });
  it("only fires once per questline", () => {
    expect(evaluateInitiationAwards(sessionEvent(questlineTask), quietState(), NOW)).toEqual([]);
  });
  it("does not fire for a task without a questline", () => {
    const g = evaluateInitiationAwards(sessionEvent(plainTask), quietState({ questlineKickoffAwarded: false }), NOW);
    expect(g).toEqual([]);
  });
});

describe("first_move", () => {
  it("awards when never awarded", () => {
    const g = evaluateInitiationAwards(sessionEvent(), quietState({ lastFirstMoveAt: null }), NOW);
    expect(g).toEqual([{ kind: "first_move", points: FIRST_MOVE_XP, refId: null, description: "First move of the day" }]);
  });
  it("awards when the last one was before today's local day start", () => {
    const yesterday = new Date(DAY_START.getTime() - 3_600_000);
    const g = evaluateInitiationAwards(sessionEvent(), quietState({ lastFirstMoveAt: yesterday }), NOW);
    expect(g.map((a) => a.kind)).toEqual(["first_move"]);
  });
  it("does not award twice in the same local day", () => {
    expect(evaluateInitiationAwards(sessionEvent(), quietState(), NOW)).toEqual([]);
  });
  it("fires even when session_start is on cooldown", () => {
    const g = evaluateInitiationAwards(sessionEvent(), quietState({ lastFirstMoveAt: null }), NOW);
    expect(g.map((a) => a.kind)).toEqual(["first_move"]);
  });
});

describe("stacking + summary", () => {
  it("morning burst: start on a questline task, fresh day → +12", () => {
    const g = evaluateInitiationAwards(
      sessionEvent(questlineTask),
      quietState({
        lastSessionStartAwardAt: null,
        questlineKickoffAwarded: false,
        questlineTitle: "Spring cleaning",
        lastFirstMoveAt: null,
      }),
      NOW,
    );
    expect(g.map((a) => a.kind)).toEqual(["session_start", "questline_kickoff", "first_move"]);
    const xp = toInitiationXp(g);
    expect(xp.total).toBe(12);
    expect(xp.awards).toEqual([
      { kind: "session_start", points: 2 },
      { kind: "questline_kickoff", points: 5 },
      { kind: "first_move", points: 5 },
    ]);
  });
  it("toInitiationXp of nothing is a zero summary", () => {
    expect(toInitiationXp([])).toEqual({ total: 0, awards: [] });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @workspace/api-server test -- initiation`
Expected: FAIL — cannot resolve `./initiation`.

- [ ] **Step 3: Write the evaluator**

Create `artifacts/api-server/src/lib/initiation.ts`:

```ts
/**
 * Celebrate Starting — pure initiation-XP rules (Act I).
 *
 * The ADHD wall is starting, not finishing: these awards celebrate the moment
 * work begins. Two events exist (a focus session starting, a breakdown step
 * checked to done); four award kinds ride them. This module is pure — routes
 * gather state and apply granted awards via lib/initiation-grant.ts.
 */

export const SESSION_START_XP = 2;
export const FIRST_STEP_XP = 3;
export const QUESTLINE_KICKOFF_XP = 5;
export const FIRST_MOVE_XP = 5;
export const SESSION_START_COOLDOWN_MS = 10 * 60 * 1000;

export type InitiationKind = "session_start" | "first_step" | "questline_kickoff" | "first_move";

export interface InitiationEvent {
  type: "session_start" | "step_check";
  /** The task the event is tied to (step_check always; session_start optionally). */
  task?: { id: number; title: string; questlineId: number | null } | null;
  /** step_check only: some OTHER step of this task was already done. */
  otherStepsAlreadyDone?: boolean;
}

export interface InitiationState {
  /** awarded_at of the newest session_start award, or null. */
  lastSessionStartAwardAt: Date | null;
  /** A first_step award already exists for this task. */
  taskFirstStepAwarded: boolean;
  /** A questline_kickoff award already exists for this task's questline. */
  questlineKickoffAwarded: boolean;
  /** awarded_at of the newest first_move award, or null. */
  lastFirstMoveAt: Date | null;
  /** UTC instant of local midnight today in the user's timezone. */
  dayStartUtc: Date;
  /** Title of the task's questline (kickoff copy), when it has one. */
  questlineTitle?: string | null;
}

export interface GrantedAward {
  kind: InitiationKind;
  points: number;
  refId: number | null;
  description: string;
}

export interface InitiationXp {
  total: number;
  awards: { kind: InitiationKind; points: number }[];
}

export function evaluateInitiationAwards(
  event: InitiationEvent,
  state: InitiationState,
  now: Date,
): GrantedAward[] {
  const granted: GrantedAward[] = [];

  if (event.type === "session_start") {
    const last = state.lastSessionStartAwardAt;
    const offCooldown = last === null || now.getTime() - last.getTime() >= SESSION_START_COOLDOWN_MS;
    if (offCooldown) {
      granted.push({
        kind: "session_start",
        points: SESSION_START_XP,
        refId: null,
        description: "Started a focus session",
      });
    }
  }

  if (event.type === "step_check" && event.task && !event.otherStepsAlreadyDone && !state.taskFirstStepAwarded) {
    granted.push({
      kind: "first_step",
      points: FIRST_STEP_XP,
      refId: event.task.id,
      description: `Checked the first step of "${event.task.title}"`,
    });
  }

  if (event.task?.questlineId != null && !state.questlineKickoffAwarded) {
    const name = state.questlineTitle ? `"${state.questlineTitle}"` : "a questline";
    granted.push({
      kind: "questline_kickoff",
      points: QUESTLINE_KICKOFF_XP,
      refId: event.task.questlineId,
      description: `Kicked off ${name}`,
    });
  }

  if (state.lastFirstMoveAt === null || state.lastFirstMoveAt.getTime() < state.dayStartUtc.getTime()) {
    granted.push({
      kind: "first_move",
      points: FIRST_MOVE_XP,
      refId: null,
      description: "First move of the day",
    });
  }

  return granted;
}

export function toInitiationXp(granted: GrantedAward[]): InitiationXp {
  return {
    total: granted.reduce((sum, g) => sum + g.points, 0),
    awards: granted.map((g) => ({ kind: g.kind, points: g.points })),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workspace/api-server test -- initiation`
Expected: PASS — all tests green. Then run the full package: `pnpm --filter @workspace/api-server test` — no regressions.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # expect: feat/celebrate-starting
git add artifacts/api-server/src/lib/initiation.ts artifacts/api-server/src/lib/initiation.test.ts
git commit -m "feat(api): pure evaluator for Celebrate Starting initiation XP"
```

---

### Task 3: API contract — OpenAPI + codegen

**Files:**
- Modify: `lib/api-spec/openapi.yaml`
- Regenerate: `lib/api-client-react/src/generated/*`, `lib/api-zod/src/generated/*` (via codegen — never by hand)

**Interfaces:**
- Consumes: existing `FocusSession`, `TaskStep` schemas.
- Produces: `InitiationXp` / `InitiationAward` schemas; `POST /focus-sessions` 201 → `FocusSessionCreated`; `PATCH /tasks/{id}/steps/{stepId}` 200 → `StepToggleResponse`; optional `tz` query param on both. Generated client exports `InitiationXp` type and `params: { tz?: string }` on `useStartFocusSession` / `usePatchTaskStep` (Tasks 6–7 consume these).

- [ ] **Step 1: Add the schemas**

In `lib/api-spec/openapi.yaml` under `components.schemas` (near `FocusSession`, ~line 2890), add:

```yaml
    InitiationAward:
      type: object
      required: [kind, points]
      properties:
        kind:
          type: string
          enum: [session_start, first_step, questline_kickoff, first_move]
        points:
          type: integer

    InitiationXp:
      type: object
      required: [total, awards]
      description: Initiation XP granted by this action (Celebrate Starting). Zero/empty when nothing was granted.
      properties:
        total:
          type: integer
        awards:
          type: array
          items:
            $ref: "#/components/schemas/InitiationAward"

    FocusSessionCreated:
      allOf:
        - $ref: "#/components/schemas/FocusSession"
        - type: object
          required: [initiationXp]
          properties:
            initiationXp:
              $ref: "#/components/schemas/InitiationXp"

    StepToggleResponse:
      allOf:
        - $ref: "#/components/schemas/TaskStep"
        - type: object
          required: [initiationXp]
          properties:
            initiationXp:
              $ref: "#/components/schemas/InitiationXp"
```

- [ ] **Step 2: Wire the endpoints**

`POST /focus-sessions` (operationId `startFocusSession`, ~line 980): add a `parameters` block above `requestBody`, and point the 201 at the new schema:

```yaml
      parameters:
        - name: tz
          in: query
          required: false
          description: IANA timezone for local-day boundaries (falls back to UTC)
          schema:
            type: string
```

and change the 201 content schema `$ref` from `#/components/schemas/FocusSession` to `#/components/schemas/FocusSessionCreated`.

`PATCH /tasks/{id}/steps/{stepId}` (operationId `patchTaskStep`, ~line 722): append the same `tz` parameter to the existing `parameters` list, and change the 200 content schema `$ref` from `#/components/schemas/TaskStep` to `#/components/schemas/StepToggleResponse`.

- [ ] **Step 3: Regenerate the clients**

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: orval regenerates `lib/api-client-react` + `lib/api-zod` without errors.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS — existing client call sites still compile (the new response fields are additive; `params` is optional).

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # expect: feat/celebrate-starting
git add lib/api-spec/openapi.yaml lib/api-client-react lib/api-zod
git commit -m "feat(api-spec): initiationXp on session start + step toggle, tz params"
```

---

### Task 4: Grant orchestrator + POST /focus-sessions wiring

**Files:**
- Create: `artifacts/api-server/src/lib/initiation-grant.ts`
- Modify: `artifacts/api-server/src/routes/focus-sessions.ts`

**Interfaces:**
- Consumes: `evaluateInitiationAwards` / `toInitiationXp` / types from `./initiation` (Task 2); `initiationAwardsTable` (Task 1); `resolveTimeZone`, `localDateKey`, `localDayStartUtc` from `./date-buckets`; `questlinesTable`, `activityTable`, `usersTable`, `db`, `type User` from `@workspace/db`.
- Produces: `grantInitiationAwards(tx, user, event, tz): Promise<InitiationXp>` — Task 5 reuses it. The POST /focus-sessions 201 body gains `initiationXp`.

- [ ] **Step 1: Write the orchestrator**

Create `artifacts/api-server/src/lib/initiation-grant.ts`:

```ts
import { and, desc, eq } from "drizzle-orm";
import { db, activityTable, initiationAwardsTable, questlinesTable, usersTable, type User } from "@workspace/db";
import { evaluateInitiationAwards, toInitiationXp, type InitiationEvent, type InitiationXp } from "./initiation";
import { resolveTimeZone, localDateKey, localDayStartUtc } from "./date-buckets";
import { getLevelInfo } from "./gamification";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Evaluate and apply initiation awards inside the caller's transaction.
 *
 * The caller MUST hold the user row FOR UPDATE in `tx` — that serializes the
 * time-window guards (cooldown, first-move). The once-ever kinds are also
 * guarded by the (user_id, kind, ref_id) unique index: the ledger insert uses
 * onConflictDoNothing and only pays when a row was actually inserted, so a
 * lost race can never double-pay or error.
 */
export async function grantInitiationAwards(
  tx: Tx,
  user: User,
  event: InitiationEvent,
  tz: string | undefined,
): Promise<InitiationXp> {
  const now = new Date();
  const timeZone = resolveTimeZone(tz);
  const dayStartUtc = localDayStartUtc(localDateKey(now, timeZone), timeZone);

  const latestOf = async (kind: string) => {
    const [row] = await tx.select().from(initiationAwardsTable)
      .where(and(eq(initiationAwardsTable.userId, user.id), eq(initiationAwardsTable.kind, kind)))
      .orderBy(desc(initiationAwardsTable.awardedAt))
      .limit(1);
    return row ?? null;
  };
  const refAwarded = async (kind: string, refId: number) => {
    const [row] = await tx.select().from(initiationAwardsTable)
      .where(and(
        eq(initiationAwardsTable.userId, user.id),
        eq(initiationAwardsTable.kind, kind),
        eq(initiationAwardsTable.refId, refId),
      ))
      .limit(1);
    return !!row;
  };

  const lastStart = event.type === "session_start" ? await latestOf("session_start") : null;
  const lastFirstMove = await latestOf("first_move");

  let taskFirstStepAwarded = false;
  let questlineKickoffAwarded = false;
  let questlineTitle: string | null = null;
  if (event.task) {
    if (event.type === "step_check") {
      taskFirstStepAwarded = await refAwarded("first_step", event.task.id);
    }
    if (event.task.questlineId != null) {
      questlineKickoffAwarded = await refAwarded("questline_kickoff", event.task.questlineId);
      if (!questlineKickoffAwarded) {
        const [ql] = await tx.select().from(questlinesTable)
          .where(eq(questlinesTable.id, event.task.questlineId))
          .limit(1);
        questlineTitle = ql?.title ?? null;
      }
    }
  }

  const granted = evaluateInitiationAwards(event, {
    lastSessionStartAwardAt: lastStart?.awardedAt ?? null,
    taskFirstStepAwarded,
    questlineKickoffAwarded,
    lastFirstMoveAt: lastFirstMove?.awardedAt ?? null,
    dayStartUtc,
    questlineTitle,
  }, now);

  const applied: typeof granted = [];
  for (const g of granted) {
    const inserted = await tx.insert(initiationAwardsTable)
      .values({ userId: user.id, kind: g.kind, refId: g.refId, awardedAt: now })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) continue; // lost a once-ever race — skip the pay
    await tx.insert(activityTable).values({
      userId: user.id,
      type: "initiation",
      description: g.description,
      points: g.points,
    });
    applied.push(g);
  }

  const total = applied.reduce((sum, g) => sum + g.points, 0);
  if (total > 0) {
    // Keep the stored level in sync, matching the task/gear/battle XP writes.
    const newTotal = user.totalPoints + total;
    await tx.update(usersTable).set({
      totalPoints: newTotal,
      weeklyPoints: user.weeklyPoints + total,
      currentLevel: getLevelInfo(newTotal).level,
    }).where(eq(usersTable.id, user.id));
  }

  return toInitiationXp(applied);
}
```

- [ ] **Step 2: Wire POST /focus-sessions**

In `artifacts/api-server/src/routes/focus-sessions.ts`:

Add imports at the top:

```ts
import { grantInitiationAwards } from "../lib/initiation-grant";
import type { InitiationXp } from "../lib/initiation";
```

In the POST handler (`router.post("/focus-sessions", ...)`), read `tz` after the preset parse:

```ts
  const { preset, taskId } = req.body as { preset?: string; taskId?: number };
  const tz = typeof req.query.tz === "string" ? req.query.tz : undefined;
```

Change the `ok` outcome type to carry the awards:

```ts
    | { status: "ok"; session: FocusSession; initiationXp: InitiationXp };
```

Inside the transaction, capture the task for the event and grant after the insert (full replacement of the block from the `if (taskId != null)` check through `return { status: "ok", session };`):

```ts
    let eventTask: { id: number; title: string; questlineId: number | null } | null = null;
    if (taskId != null) {
      const [task] = await tx.select().from(tasksTable)
        .where(and(eq(tasksTable.id, taskId), eq(tasksTable.userId, userId)));
      if (!task) return { status: "bad_task" };
      if (task.completed) return { status: "completed_task" };
      eventTask = { id: task.id, title: task.title, questlineId: task.questlineId ?? null };
    }

    const [session] = await tx.insert(focusSessionsTable).values({
      userId,
      taskId: taskId ?? null,
      preset: config.key,
      focusMinutes: config.focusMinutes,
      breakMinutes: config.breakMinutes,
      longBreakMinutes: config.longBreakMinutes,
      longBreakEvery: config.longBreakEvery,
      plannedCycles: config.plannedCycles,
    }).returning();

    const initiationXp = await grantInitiationAwards(
      tx, user, { type: "session_start", task: eventTask }, tz,
    );

    return { status: "ok", session, initiationXp };
```

And change the success response (last line of the handler):

```ts
  res.status(201).json({ ...formatSession(outcome.session), initiationXp: outcome.initiationXp });
```

- [ ] **Step 3: Typecheck + tests**

Run: `pnpm typecheck`
Expected: PASS.
Run: `pnpm --filter @workspace/api-server test`
Expected: PASS — no regressions (the evaluator suite from Task 2 stays green).

- [ ] **Step 4: Commit**

```bash
git branch --show-current   # expect: feat/celebrate-starting
git add artifacts/api-server/src/lib/initiation-grant.ts artifacts/api-server/src/routes/focus-sessions.ts
git commit -m "feat(api): grant initiation XP on focus session start"
```

---

### Task 5: PATCH step route — transactional + initiation XP

**Files:**
- Modify: `artifacts/api-server/src/routes/tasks.ts` (the `router.patch("/tasks/:id/steps/:stepId", ...)` handler, ~line 1153)

**Interfaces:**
- Consumes: `grantInitiationAwards` (Task 4), `type InitiationXp` (Task 2). `usersTable`, `taskStepsTable`, `tasksTable`, `db` are already imported in this file.
- Produces: PATCH response body `{ id, text, position, done, initiationXp }` matching `StepToggleResponse` (Task 3).

- [ ] **Step 1: Add imports**

At the top of `artifacts/api-server/src/routes/tasks.ts`, next to the other `../lib/` imports:

```ts
import { grantInitiationAwards } from "../lib/initiation-grant";
import type { InitiationXp } from "../lib/initiation";
```

- [ ] **Step 2: Replace the handler**

Replace the whole `router.patch("/tasks/:id/steps/:stepId", ...)` handler with:

```ts
router.patch("/tasks/:id/steps/:stepId", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rawStepId = Array.isArray(req.params.stepId) ? req.params.stepId[0] : req.params.stepId;
  const id = parseInt(rawId, 10);
  const stepId = parseInt(rawStepId, 10);
  if (isNaN(id) || isNaN(stepId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const done: unknown = req.body?.done;
  if (typeof done !== "boolean") {
    res.status(400).json({ error: "done must be a boolean" });
    return;
  }
  const tz = typeof req.query.tz === "string" ? req.query.tz : undefined;

  type Outcome =
    | { status: "not_found" }
    | { status: "ok"; step: { id: number; text: string; position: number; done: boolean }; initiationXp: InitiationXp };

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    // Lock the user row: initiation awards read and update point totals.
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).for("update");
    if (!user) return { status: "not_found" };

    const [current] = await tx.select().from(taskStepsTable)
      .where(and(
        eq(taskStepsTable.id, stepId),
        eq(taskStepsTable.taskId, id),
        eq(taskStepsTable.userId, userId),
      ));
    if (!current) return { status: "not_found" };

    const [updated] = await tx.update(taskStepsTable)
      .set({ done })
      .where(eq(taskStepsTable.id, current.id))
      .returning();

    // Initiation XP only on a false→true transition; unchecking never refunds.
    let initiationXp: InitiationXp = { total: 0, awards: [] };
    if (done && !current.done) {
      const [task] = await tx.select().from(tasksTable)
        .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)));
      if (task) {
        const siblings = await tx.select().from(taskStepsTable)
          .where(and(eq(taskStepsTable.taskId, id), eq(taskStepsTable.userId, userId)));
        const otherStepsAlreadyDone = siblings.some((s) => s.id !== stepId && s.done);
        initiationXp = await grantInitiationAwards(tx, user, {
          type: "step_check",
          task: { id: task.id, title: task.title, questlineId: task.questlineId ?? null },
          otherStepsAlreadyDone,
        }, tz);
      }
    }

    return {
      status: "ok",
      step: { id: updated.id, text: updated.text, position: updated.position, done: updated.done },
      initiationXp,
    };
  });

  if (outcome.status === "not_found") { res.status(404).json({ error: "Step not found" }); return; }
  res.json({ ...outcome.step, initiationXp: outcome.initiationXp });
});
```

- [ ] **Step 3: Typecheck + tests**

Run: `pnpm typecheck`
Expected: PASS.
Run: `pnpm --filter @workspace/api-server test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git branch --show-current   # expect: feat/celebrate-starting
git add artifacts/api-server/src/routes/tasks.ts
git commit -m "feat(api): initiation XP on first-step checks; step toggle now transactional"
```

---

### Task 6: Web — initiation toast helper (TDD) + session-start wiring + feed icon

**Files:**
- Create: `artifacts/focusquest/src/lib/initiation-toast.ts`
- Test: `artifacts/focusquest/src/lib/initiation-toast.test.ts`
- Modify: `artifacts/focusquest/src/pages/focus.tsx` (the `handleStart` function, ~line 127)
- Modify: `artifacts/focusquest/src/pages/dashboard.tsx` (activity icon list, ~line 445)

**Interfaces:**
- Consumes: `InitiationXp` type + `params: { tz?: string }` on `useStartFocusSession` (Task 3 codegen); `browserTimeZone()` from `@/lib/timezone`; `getGetMyStatsQueryKey` (already imported in focus.tsx).
- Produces: `initiationToast(xp: InitiationXp | undefined | null): { title: string; description: string } | null` — Task 7 reuses it.

- [ ] **Step 1: Write the failing tests**

Create `artifacts/focusquest/src/lib/initiation-toast.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { initiationToast } from "./initiation-toast";

describe("initiationToast", () => {
  it("returns null when nothing was awarded", () => {
    expect(initiationToast(undefined)).toBeNull();
    expect(initiationToast(null)).toBeNull();
    expect(initiationToast({ total: 0, awards: [] })).toBeNull();
  });

  it("celebrates a single award", () => {
    const t = initiationToast({ total: 2, awards: [{ kind: "session_start", points: 2 }] });
    expect(t).toEqual({
      title: "You started — that's the hard part. +2 XP",
      description: "Started +2",
    });
  });

  it("joins a burst with middots", () => {
    const t = initiationToast({
      total: 12,
      awards: [
        { kind: "session_start", points: 2 },
        { kind: "questline_kickoff", points: 5 },
        { kind: "first_move", points: 5 },
      ],
    });
    expect(t?.description).toBe("Started +2 · Questline kickoff +5 · First move today +5");
  });

  it("labels first_step and falls back to the raw kind for unknowns", () => {
    const t = initiationToast({
      total: 4,
      awards: [
        { kind: "first_step", points: 3 },
        { kind: "mystery_kind" as never, points: 1 },
      ],
    });
    expect(t?.description).toBe("First step +3 · mystery_kind +1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @workspace/focusquest test -- initiation-toast`
Expected: FAIL — cannot resolve `./initiation-toast`.

- [ ] **Step 3: Write the helper**

Create `artifacts/focusquest/src/lib/initiation-toast.ts`:

```ts
import type { InitiationXp } from "@workspace/api-client-react";

const KIND_LABELS: Record<string, string> = {
  session_start: "Started",
  first_step: "First step",
  questline_kickoff: "Questline kickoff",
  first_move: "First move today",
};

/**
 * Toast content for an initiation award burst, or null when nothing was
 * awarded. Copy celebrates what happened — never what's left (anti-shame law).
 */
export function initiationToast(
  xp: InitiationXp | undefined | null,
): { title: string; description: string } | null {
  if (!xp || xp.total <= 0) return null;
  return {
    title: `You started — that's the hard part. +${xp.total} XP`,
    description: xp.awards.map((a) => `${KIND_LABELS[a.kind] ?? a.kind} +${a.points}`).join(" · "),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workspace/focusquest test -- initiation-toast`
Expected: PASS.

- [ ] **Step 5: Wire the session-start toast**

In `artifacts/focusquest/src/pages/focus.tsx`, add imports:

```ts
import { initiationToast } from "@/lib/initiation-toast";
import { browserTimeZone } from "@/lib/timezone";
```

Replace `handleStart` with:

```ts
  function handleStart() {
    startMut.mutate(
      { data: { preset: presetKey, taskId: taskId ?? undefined }, params: { tz: browserTimeZone() } },
      {
        onSuccess: (res) => {
          pausedAccumRef.current = 0;
          setPausedAtMs(null);
          const t = initiationToast(res.initiationXp);
          if (t) toast({ ...t, className: "border-primary" });
          qc.invalidateQueries({ queryKey: getGetActiveFocusSessionQueryKey() });
          qc.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
        },
        onError: () => {
          // A 409 means a session is already active — just refetch and resume it.
          qc.invalidateQueries({ queryKey: getGetActiveFocusSessionQueryKey() });
        },
      },
    );
  }
```

(`browserTimeZone` import path: match how `artifacts/focusquest/src/pages/dashboard.tsx` imports it — same alias, same file `src/lib/timezone.ts`.)

- [ ] **Step 6: Activity feed icon**

In `artifacts/focusquest/src/pages/dashboard.tsx`, after the `focus_complete` icon line (~line 453), add:

```tsx
                      {activity.type === 'initiation'           && <Play        className="w-4 h-4 text-primary" />}
```

and add `Play` to the existing `lucide-react` import in that file.

- [ ] **Step 7: Typecheck + web tests**

Run: `pnpm typecheck`
Expected: PASS.
Run: `pnpm --filter @workspace/focusquest test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git branch --show-current   # expect: feat/celebrate-starting
git add artifacts/focusquest/src/lib/initiation-toast.ts artifacts/focusquest/src/lib/initiation-toast.test.ts artifacts/focusquest/src/pages/focus.tsx artifacts/focusquest/src/pages/dashboard.tsx
git commit -m "feat(web): initiation XP toast on session start + feed icon"
```

---

### Task 7: Web — step-check toast + stats invalidation

**Files:**
- Modify: `artifacts/focusquest/src/components/task-steps.tsx`

**Interfaces:**
- Consumes: `initiationToast` (Task 6), `browserTimeZone` from `@/lib/timezone`, `getGetMyStatsQueryKey` from `@workspace/api-client-react`, `params: { tz?: string }` on `usePatchTaskStep` (Task 3).
- Produces: nothing new.

- [ ] **Step 1: Update imports**

In `artifacts/focusquest/src/components/task-steps.tsx`, extend the `@workspace/api-client-react` import with `getGetMyStatsQueryKey`, and add:

```ts
import { initiationToast } from "@/lib/initiation-toast";
import { browserTimeZone } from "@/lib/timezone";
```

- [ ] **Step 2: Rework the toggle handler**

Replace `handleToggle` with:

```ts
  const handleToggle = (stepId: number, done: boolean) => {
    patchStepMutation.mutate(
      { id: task.id, stepId, data: { done }, params: { tz: browserTimeZone() } },
      {
        onSuccess: (res) => {
          invalidate();
          queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
          const t = initiationToast(res.initiationXp);
          if (t) toast({ ...t, className: "border-primary" });
        },
        onError: () =>
          toast({ title: "Couldn't update that step — try again.", variant: "destructive" }),
      },
    );
  };
```

- [ ] **Step 3: Typecheck + tests**

Run: `pnpm typecheck`
Expected: PASS.
Run: `pnpm --filter @workspace/focusquest test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git branch --show-current   # expect: feat/celebrate-starting
git add artifacts/focusquest/src/components/task-steps.tsx
git commit -m "feat(web): initiation XP toast on first-step check"
```

---

### Task 8: Web — Today's Focus board states (TDD)

**Files:**
- Create: `artifacts/focusquest/src/lib/focus-board.ts`
- Test: `artifacts/focusquest/src/lib/focus-board.test.ts`
- Modify: `artifacts/focusquest/src/pages/tasks.tsx` (the Today's Focus IIFE, ~line 491)

**Interfaces:**
- Consumes: `Task` type from `@workspace/api-client-react`.
- Produces: `focusBoardState(tasks: Task[], todayStr: string): FocusBoardState` where `FocusBoardState = { kind: "empty" } | { kind: "active"; focusTasks: Task[]; completedCount: number; totalPinned: number } | { kind: "all-done" }`.

- [ ] **Step 1: Write the failing tests**

Create `artifacts/focusquest/src/lib/focus-board.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { focusBoardState } from "./focus-board";
import type { Task } from "@workspace/api-client-react";

const TODAY = "2026-07-13";

function make(over: Partial<Task>): Task {
  const base = {
    id: 1, title: "Quest", completed: false,
    isDailyFocus: false, focusDate: null,
  };
  return { ...base, ...over } as Task;
}

describe("focusBoardState", () => {
  it("is empty with no tasks at all", () => {
    expect(focusBoardState([], TODAY)).toEqual({ kind: "empty" });
  });

  it("ignores pins from another day and non-pinned tasks", () => {
    const tasks = [
      make({ id: 1, isDailyFocus: true, focusDate: "2026-07-12" }),
      make({ id: 2, isDailyFocus: false, focusDate: TODAY }),
    ];
    expect(focusBoardState(tasks, TODAY)).toEqual({ kind: "empty" });
  });

  it("is active with open pinned quests, counting completed ones", () => {
    const open = make({ id: 1, isDailyFocus: true, focusDate: TODAY });
    const done = make({ id: 2, isDailyFocus: true, focusDate: TODAY, completed: true });
    const state = focusBoardState([open, done], TODAY);
    expect(state).toEqual({ kind: "active", focusTasks: [open], completedCount: 1, totalPinned: 2 });
  });

  it("is all-done when every pinned quest is complete", () => {
    const tasks = [
      make({ id: 1, isDailyFocus: true, focusDate: TODAY, completed: true }),
      make({ id: 2, isDailyFocus: true, focusDate: TODAY, completed: true }),
    ];
    expect(focusBoardState(tasks, TODAY)).toEqual({ kind: "all-done" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @workspace/focusquest test -- focus-board`
Expected: FAIL — cannot resolve `./focus-board`.

- [ ] **Step 3: Write the selector**

Create `artifacts/focusquest/src/lib/focus-board.ts`:

```ts
import type { Task } from "@workspace/api-client-react";

export type FocusBoardState =
  | { kind: "empty" }
  | { kind: "active"; focusTasks: Task[]; completedCount: number; totalPinned: number }
  | { kind: "all-done" };

/** State of the Today's Focus board for the given local day (yyyy-MM-dd). */
export function focusBoardState(tasks: Task[], todayStr: string): FocusBoardState {
  const pinnedToday = tasks.filter((t) => t.isDailyFocus && t.focusDate === todayStr);
  if (pinnedToday.length === 0) return { kind: "empty" };
  const open = pinnedToday.filter((t) => !t.completed);
  if (open.length === 0) return { kind: "all-done" };
  return {
    kind: "active",
    focusTasks: open,
    completedCount: pinnedToday.length - open.length,
    totalPinned: pinnedToday.length,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workspace/focusquest test -- focus-board`
Expected: PASS.

- [ ] **Step 5: Rework the Today's Focus section**

In `artifacts/focusquest/src/pages/tasks.tsx`: add `Pin` to the existing `lucide-react` import, add

```ts
import { focusBoardState } from "@/lib/focus-board";
```

and replace the whole Today's Focus IIFE (from `{/* Today's Focus section */}` through the closing `})()}`) with:

```tsx
      {/* Today's Focus section */}
      {(() => {
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        const board = focusBoardState(tasks ?? [], todayStr);
        const heading = (
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-primary">Today's Focus</h2>
          </div>
        );
        if (board.kind === "empty") {
          return (
            <div className="mb-6">
              <div className="mb-3">{heading}</div>
              <div className="flex items-center gap-3 p-4 rounded-xl border-2 border-dashed border-primary/25 bg-primary/[0.03]">
                <Pin className="w-4 h-4 text-primary/70 flex-shrink-0" aria-hidden />
                <p className="text-sm text-muted-foreground">
                  Pick up to three quests to focus on today — tap the pin on any quest below.
                </p>
              </div>
            </div>
          );
        }
        if (board.kind === "all-done") {
          return (
            <div className="mb-6">
              <div className="mb-3">{heading}</div>
              <p className="text-sm text-primary/90 px-1">Focus cleared for today ✦</p>
            </div>
          );
        }
        return (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              {heading}
              <span className="text-xs text-muted-foreground px-2 py-0.5 rounded-full bg-muted border border-border">
                {board.completedCount} / {board.totalPinned} done · {3 - board.totalPinned} slot{3 - board.totalPinned !== 1 ? "s" : ""} left
              </span>
            </div>
            <div className="space-y-2 pl-1 border-l-2 border-primary/30">
              {board.focusTasks.map(task => (
                <TaskItem key={task.id} task={task} onEdit={handleOpenEdit} />
              ))}
            </div>
          </div>
        );
      })()}
```

- [ ] **Step 6: Typecheck + tests**

Run: `pnpm typecheck`
Expected: PASS.
Run: `pnpm --filter @workspace/focusquest test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git branch --show-current   # expect: feat/celebrate-starting
git add artifacts/focusquest/src/lib/focus-board.ts artifacts/focusquest/src/lib/focus-board.test.ts artifacts/focusquest/src/pages/tasks.tsx
git commit -m "feat(web): Today's Focus empty + all-done board states — Pick Three cleared"
```

---

### Task 9: Anti-shame copy fixes

**Files:**
- Modify: `artifacts/api-server/src/lib/notification-scheduler.ts` (~lines 134, 150–151)
- Modify: `artifacts/api-server/src/lib/nudges.ts` (~line 16)
- Modify: `artifacts/focusquest/src/lib/nudge-reactions.ts` (~line 6)
- Modify: `artifacts/focusquest/src/pages/dashboard.tsx` (decay banner, ~lines 300–325)

The audit already ran (2026-07-13); these are ALL the violations found. Passing surfaces (verdicts for the PR table): hero faint/vignette copy (playful RPG framing, revival is one small action), streak-freeze copy (protective), "Quest Log Waiting" push (momentum framing), streak multiplier chips (positive-only tiers), streak restarts (silent + clean, no "lost streak" messaging anywhere), error toasts (neutral).

- [ ] **Step 1: Evening debrief — drop the threat**

In `artifacts/api-server/src/lib/notification-scheduler.ts` line ~134, change:

```ts
    const streakLine = streakSafe ? ` Streak safe (${streakDays}d).` : " Streak at risk!";
```

to:

```ts
    const streakLine = streakSafe ? ` Streak safe (${streakDays}d).` : " A quick quest keeps the momentum going.";
```

- [ ] **Step 2: Streak push — invitation, not alarm**

Same file, lines ~148–153, change:

```ts
    await notify(
      DEFAULT_USER_ID,
      "Streak Alert! ⚠️",
      `Your ${streakDays}-day streak ends at midnight.${taskLine} Complete one quest to keep it alive!`,
      "daily-summary",
    );
```

to:

```ts
    await notify(
      DEFAULT_USER_ID,
      "Keep the flame going 🔥",
      `Your ${streakDays}-day streak is one small quest away from continuing.${taskLine}`,
      "daily-summary",
    );
```

- [ ] **Step 3: Nudge label — both copies, key unchanged**

In `artifacts/api-server/src/lib/nudges.ts` AND `artifacts/focusquest/src/lib/nudge-reactions.ts`, change:

```ts
  { key: "dont_break_streak", label: "Don't break the streak! 🔥" },
```

to:

```ts
  { key: "dont_break_streak", label: "Keep the streak alive! 🔥" },
```

(The key is stored in `ally_nudges` rows and must NOT change; labels are resolved at render/send time in both codebases.)

- [ ] **Step 4: Dashboard decay banner — welcome back**

In `artifacts/focusquest/src/pages/dashboard.tsx` (~lines 309–325): add `Sunrise` and `Sparkles` to the `lucide-react` import, then change the banner internals:

- The container icon `<TrendingDown className="w-5 h-5 text-amber-400" aria-hidden />` → `<Sunrise className="w-5 h-5 text-amber-400" aria-hidden />`
- `<AlertTriangle className="w-4 h-4 text-amber-400" aria-hidden />` → `<Sparkles className="w-4 h-4 text-amber-400" aria-hidden />`
- The heading span text `XP Ranking Sliding` → `{daysSinceActive >= 999 ? "Ready for quest one?" : "Welcome back"}`
- The away-branch body string (keep the 999 branch as is):

```ts
                : `It's been ${daysSinceActive} day${daysSinceActive === 1 ? "" : "s"} — today starts fresh. One small quest gets your week moving.`
```

- The button label `Get Back on Track →` → `Pick a small quest →`

(If `TrendingDown` / `AlertTriangle` become unused in this file after the swap, remove them from the import.)

- [ ] **Step 5: Full test pass**

Run: `pnpm --filter @workspace/api-server test`
Expected: PASS (the nudges test matches labels by regex `/get moving/i` only — unaffected).
Run: `pnpm --filter @workspace/focusquest test`
Expected: PASS.
Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # expect: feat/celebrate-starting
git add artifacts/api-server/src/lib/notification-scheduler.ts artifacts/api-server/src/lib/nudges.ts artifacts/focusquest/src/lib/nudge-reactions.ts artifacts/focusquest/src/pages/dashboard.tsx
git commit -m "fix(copy): anti-shame audit — welcome-back framing for streak + return copy"
```

---

### Task 10: Full verification + PR

**Files:** none (verification + PR only).

- [ ] **Step 1: Full suites + typecheck**

Run all three:

```
pnpm typecheck
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/focusquest test
pnpm --filter @workspace/quick-add test
```

Expected: all PASS.

- [ ] **Step 2: Push and open the PR**

```bash
git branch --show-current   # expect: feat/celebrate-starting
git push -u origin feat/celebrate-starting
```

Then create the PR with gh (PowerShell: `& "C:\Program Files\GitHub CLI\gh.exe" pr create --base main --title "feat: Celebrate Starting + Pick Three board — Act I complete" --body-file <tmpfile>`). The body must include:

1. Summary of the four pieces (initiation XP engine, endpoints, web toasts/board states, copy fixes) linking the spec.
2. The **anti-shame audit table**:

| Surface | Verdict | Change |
|---|---|---|
| Evening debrief push (`notification-scheduler.ts`) | ❌ threat framing | "Streak at risk!" → "A quick quest keeps the momentum going." |
| Streak push (`notification-scheduler.ts`) | ❌ midnight-countdown alarm | "Streak Alert! ⚠️ … ends at midnight … keep it alive!" → "Keep the flame going 🔥 … one small quest away from continuing." |
| Poke nudge label (server + web) | ❌ loss framing | "Don't break the streak!" → "Keep the streak alive!" (key unchanged) |
| Dashboard decay banner | ❌ competitive guilt on return | "XP Ranking Sliding / every quest you skip lets others pull ahead" → "Welcome back / today starts fresh"; button "Pick a small quest →" |
| Hero faint + vignettes | ✅ pass | playful RPG framing; revival is one small action |
| Streak freeze copy | ✅ pass | protective, neutral |
| "Quest Log Waiting" push | ✅ pass | momentum framing |
| Streak multiplier chips | ✅ pass | positive-only tiers |
| Streak restart behavior | ✅ pass | silent clean restart, no "lost streak" copy |

3. Footer: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`

- [ ] **Step 3: Report**

Post the PR URL. (Post-merge wrap-up — campaign-map artifact refresh and roadmap memory update — is handled by the coordinating session, not a plan task.)
