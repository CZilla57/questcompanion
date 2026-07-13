# Questlines (Projects & Goals Hierarchy) — Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single grouping tier — **Questlines** — above quests: create/edit/delete a questline, assign one-off quests to it, watch derived progress, and manually claim a one-time XP reward once every quest is done.

**Architecture:** New `questlines` table + a nullable `questlineId` FK on `tasks`. All branchable logic (progress rollup, ready-to-claim detection, reward math, assignability) lives in a pure, unit-tested lib (`questlines.ts`), mirroring `anchored-tasks.ts`. Thin Express handlers wire it up; the XP-award + activity-emit path reuses the exact pattern in `focus-sessions.ts`. The React client is generated from `openapi.yaml` via orval; two new pages (list + detail) and small Quest-Log edits consume the generated hooks.

**Tech Stack:** TypeScript, Express, Drizzle ORM (Postgres/Neon), drizzle-zod, Vitest, React 19 + wouter + TanStack Query, orval codegen, Tailwind + shadcn/ui.

## Global Constraints

- Reward is **XP only** (no coins/gear in v1); bonus XP = `min(total, 8) * 25`.
- A quest belongs to **0 or 1** questlines; `category` stays orthogonal and untouched.
- **Only one-off quests** may join a questline — reject assignment when `recurringTaskId != null`.
- A completed questline never re-opens; no un-claim/reopen endpoint in v1.
- No server-side quest-log filtering; the Quest Log filters the already-fetched list client-side.
- **No HTTP/route test harness exists** in api-server — every test is a pure-function unit test (`lib/*.test.ts`). Push guard/reward logic into `questlines.ts` and unit-test it there; verify handlers via `pnpm typecheck` and the end-to-end preview in Task 9.
- API contract flow: edit `lib/api-spec/openapi.yaml` → `pnpm --filter @workspace/api-spec codegen`. Never hand-edit `*/src/generated`.
- DB flow: edit `lib/db/src/schema/*` → `pnpm --filter @workspace/db push`. `drizzle.config.ts` does NOT load `.env` — export `DATABASE_URL` first (see Task 1). Additive columns apply without a destructive prompt.
- Typecheck gate: `pnpm typecheck` (root). Windows `LF will be replaced by CRLF` warnings on commit are harmless.
- Branch: `feat/questlines` (already created). Verify you are on it before each commit (`git rev-parse --abbrev-ref HEAD`) — concurrent sessions share this working tree.

---

### Task 1: Database schema — `questlines` table + `tasks.questlineId`

**Files:**
- Create: `lib/db/src/schema/questlines.ts`
- Modify: `lib/db/src/schema/index.ts` (add one export line)
- Modify: `lib/db/src/schema/tasks.ts` (add `questlineId` column + import)

**Interfaces:**
- Produces: `questlinesTable`, `Questline` (`= typeof questlinesTable.$inferSelect`), `insertQuestlineSchema`, `InsertQuestline`. Adds `questlineId: number | null` to `Task`.

- [ ] **Step 1: Create the schema file**

Create `lib/db/src/schema/questlines.ts`:

```ts
import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const questlinesTable = pgTable("questlines", {
  id: serial("id").primaryKey(),
  // Denormalized ownership check, matching task_steps / focus_sessions.
  userId: integer("user_id").notNull().references(() => usersTable.id),
  title: text("title").notNull(),
  description: text("description"),
  color: text("color"),
  // 'active' -> 'completed'. 'ready-to-claim' is derived, never stored.
  status: text("status").notNull().default("active"),
  // Snapshot written at claim so the payout is auditable/reversible, mirroring tasks.pointsAwarded.
  rewardXpAwarded: integer("reward_xp_awarded"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertQuestlineSchema = createInsertSchema(questlinesTable).omit({
  id: true,
  createdAt: true,
  completedAt: true,
  status: true,
  rewardXpAwarded: true,
});
export type InsertQuestline = z.infer<typeof insertQuestlineSchema>;
export type Questline = typeof questlinesTable.$inferSelect;
```

- [ ] **Step 2: Register the schema**

In `lib/db/src/schema/index.ts`, add after the `./task-steps` line:

```ts
export * from "./questlines";
```

- [ ] **Step 3: Add the membership column to `tasks`**

In `lib/db/src/schema/tasks.ts`, add the import at the top (after the `./users` import):

```ts
import { questlinesTable } from "./questlines";
```

Then add this column inside the `tasksTable` definition, immediately after the `isAnchored` line (line ~37):

```ts
  questlineId: integer("questline_id").references(() => questlinesTable.id, { onDelete: "set null" }),
```

- [ ] **Step 4: Typecheck the db package**

Run: `pnpm --filter @workspace/db build` (or `pnpm typecheck`)
Expected: PASS — no type errors. (A circular import between `tasks.ts` and `questlines.ts` is avoided because `questlines.ts` imports only `users`, not `tasks`.)

- [ ] **Step 5: Push the schema to Neon**

Run (Git Bash):
```bash
export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)"
pnpm --filter @workspace/db push
```
Expected: `[✓] Changes applied` — adds the `questlines` table and the `tasks.questline_id` column additively (no destructive prompt).

- [ ] **Step 6: Commit**

```bash
git add lib/db/src/schema/questlines.ts lib/db/src/schema/index.ts lib/db/src/schema/tasks.ts
git commit -m "feat(db): add questlines table and tasks.questlineId"
```

---

### Task 2: `questlines.ts` lib — pure logic + tests (TDD)

**Files:**
- Create: `artifacts/api-server/src/lib/questlines.ts`
- Test: `artifacts/api-server/src/lib/questlines.test.ts`

**Interfaces:**
- Produces:
  - `computeProgress(quests: { completed: boolean }[]) => { total: number; done: number }`
  - `isReadyToClaim(questline: { status: string }, progress: { total: number; done: number }) => boolean`
  - `computeRewardXp(total: number) => number` (`min(total, 8) * 25`)
  - `isQuestlineAssignable(task: { recurringTaskId: number | null }) => boolean`

- [ ] **Step 1: Write the failing tests**

Create `artifacts/api-server/src/lib/questlines.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  computeProgress,
  isReadyToClaim,
  computeRewardXp,
  isQuestlineAssignable,
} from "./questlines";

describe("computeProgress", () => {
  it("counts total and done", () => {
    expect(computeProgress([{ completed: true }, { completed: false }, { completed: true }]))
      .toEqual({ total: 3, done: 2 });
  });
  it("returns zeros for an empty questline", () => {
    expect(computeProgress([])).toEqual({ total: 0, done: 0 });
  });
});

describe("isReadyToClaim", () => {
  it("is ready when active with >=1 quest all done", () => {
    expect(isReadyToClaim({ status: "active" }, { total: 3, done: 3 })).toBe(true);
  });
  it("is not ready when quests remain", () => {
    expect(isReadyToClaim({ status: "active" }, { total: 3, done: 2 })).toBe(false);
  });
  it("is not ready when empty (total 0)", () => {
    expect(isReadyToClaim({ status: "active" }, { total: 0, done: 0 })).toBe(false);
  });
  it("is not ready when already completed", () => {
    expect(isReadyToClaim({ status: "completed" }, { total: 3, done: 3 })).toBe(false);
  });
});

describe("computeRewardXp", () => {
  it("scales 25 XP per quest", () => {
    expect(computeRewardXp(3)).toBe(75);
  });
  it("caps at 8 quests (200 XP)", () => {
    expect(computeRewardXp(8)).toBe(200);
    expect(computeRewardXp(40)).toBe(200);
  });
  it("is 0 for an empty questline", () => {
    expect(computeRewardXp(0)).toBe(0);
  });
});

describe("isQuestlineAssignable", () => {
  it("allows a one-off quest", () => {
    expect(isQuestlineAssignable({ recurringTaskId: null })).toBe(true);
  });
  it("rejects a recurring-spawned quest", () => {
    expect(isQuestlineAssignable({ recurringTaskId: 7 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @workspace/api-server test -- questlines`
Expected: FAIL — cannot find module `./questlines`.

- [ ] **Step 3: Write the minimal implementation**

Create `artifacts/api-server/src/lib/questlines.ts`:

```ts
/** Roll up quest completion counts for a questline. */
export function computeProgress(quests: { completed: boolean }[]): { total: number; done: number } {
  const total = quests.length;
  const done = quests.reduce((n, q) => n + (q.completed ? 1 : 0), 0);
  return { total, done };
}

/**
 * A questline is claimable only while still active, holding at least one quest,
 * with every quest completed. The "ready" state is derived, never stored.
 */
export function isReadyToClaim(
  questline: { status: string },
  progress: { total: number; done: number },
): boolean {
  return questline.status === "active" && progress.total >= 1 && progress.done === progress.total;
}

/** One-time XP payout: 25 per quest, capped at 8 quests (200 XP). */
export function computeRewardXp(total: number): number {
  return Math.min(total, 8) * 25;
}

/** Only one-off quests may join a questline; recurring-spawned quests never finish. */
export function isQuestlineAssignable(task: { recurringTaskId: number | null }): boolean {
  return task.recurringTaskId == null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @workspace/api-server test -- questlines`
Expected: PASS — all 11 assertions green.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/questlines.ts artifacts/api-server/src/lib/questlines.test.ts
git commit -m "feat(api): add questlines progress/claim/reward pure logic with tests"
```

---

### Task 3: API contract — questline schemas, paths, and `questlineId` on tasks

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (add paths + schemas; extend `Task`, `TaskInput`, `TaskUpdate`)
- Regenerates: `lib/api-client-react/src/generated/*`, `lib/api-zod/src/generated/*` (via codegen — do not hand-edit)

**Interfaces:**
- Produces generated hooks + query-key helpers used by Tasks 4–9:
  - `useGetQuestlines`, `getGetQuestlinesQueryKey`
  - `useCreateQuestline`
  - `useGetQuestline`, `getGetQuestlineQueryKey`
  - `useUpdateQuestline`
  - `useDeleteQuestline`
  - `useClaimQuestline`
  - Types: `Questline`, `QuestlineInput`, `QuestlineDetail`, `QuestlineClaimResult`; `Task.questlineId`, `TaskInput.questlineId`, `TaskUpdate.questlineId`.

- [ ] **Step 1: Add the questline paths**

In `lib/api-spec/openapi.yaml`, in the `paths:` section (after the `/tasks/{id}/steps` block — anywhere among the task paths is fine), add:

```yaml
  /questlines:
    get:
      operationId: getQuestlines
      tags: [questlines]
      summary: List the current user's questlines with derived progress
      parameters:
        - name: status
          in: query
          schema:
            type: string
            enum: [active, completed]
          description: Optional status filter
      responses:
        "200":
          description: Questline list
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/Questline"
    post:
      operationId: createQuestline
      tags: [questlines]
      summary: Create a questline
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/QuestlineInput"
      responses:
        "201":
          description: Created questline
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Questline"

  /questlines/{id}:
    get:
      operationId: getQuestline
      tags: [questlines]
      summary: Get one questline with its quests
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Questline with quests
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/QuestlineDetail"
        "404":
          description: Not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
    patch:
      operationId: updateQuestline
      tags: [questlines]
      summary: Update a questline's title/description/color
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
              $ref: "#/components/schemas/QuestlineInput"
      responses:
        "200":
          description: Updated questline
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Questline"
    delete:
      operationId: deleteQuestline
      tags: [questlines]
      summary: Delete a questline (its quests are unlinked, not deleted)
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "204":
          description: Deleted

  /questlines/{id}/claim:
    post:
      operationId: claimQuestline
      tags: [questlines]
      summary: Claim the reward for a fully-completed questline
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Reward claimed
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/QuestlineClaimResult"
        "404":
          description: Not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
        "409":
          description: Not ready to claim, or already completed
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
```

- [ ] **Step 2: Add the questline schemas**

In `lib/api-spec/openapi.yaml`, in `components.schemas`, after the `TaskCompletionResult` schema, add:

```yaml
    Questline:
      type: object
      required: [id, userId, title, status, total, done, ready, createdAt]
      properties:
        id:
          type: integer
        userId:
          type: integer
        title:
          type: string
        description:
          type: ["string", "null"]
        color:
          type: ["string", "null"]
        status:
          type: string
          enum: [active, completed]
        total:
          type: integer
          description: Number of quests in this questline
        done:
          type: integer
          description: Number of completed quests
        ready:
          type: boolean
          description: True when active, non-empty, and every quest is done
        rewardXpAwarded:
          type: ["integer", "null"]
        completedAt:
          type: ["string", "null"]
        createdAt:
          type: string

    QuestlineInput:
      type: object
      required: [title]
      properties:
        title:
          type: string
          minLength: 1
          maxLength: 120
        description:
          type: ["string", "null"]
        color:
          type: ["string", "null"]

    QuestlineDetail:
      type: object
      required: [questline, quests]
      properties:
        questline:
          $ref: "#/components/schemas/Questline"
        quests:
          type: array
          items:
            $ref: "#/components/schemas/Task"

    QuestlineClaimResult:
      type: object
      required: [questline, xpAwarded, totalPoints, currentLevel, levelName, leveledUp]
      properties:
        questline:
          $ref: "#/components/schemas/Questline"
        xpAwarded:
          type: integer
        totalPoints:
          type: integer
        currentLevel:
          type: integer
        levelName:
          type: string
        leveledUp:
          type: boolean
```

- [ ] **Step 3: Add `questlineId` to the Task schemas**

In `lib/api-spec/openapi.yaml`:

In the `Task` schema (after the `steps` property, ~line 1575), add:

```yaml
        questlineId:
          type: ["integer", "null"]
          description: The questline this quest belongs to, or null
```

In `TaskInput` (after the `isAnchored` property, ~line 1670), add:

```yaml
        questlineId:
          type: ["integer", "null"]
          description: Assign the new quest to a questline (one-off quests only)
```

In `TaskUpdate` (after the `isAnchored` property, ~line 1708), add:

```yaml
        questlineId:
          type: ["integer", "null"]
          description: Reassign the quest to a questline, or null to unlink (one-off quests only)
```

- [ ] **Step 4: Register the `questlines` tag** (keeps the generated client grouped)

In `lib/api-spec/openapi.yaml`, in the top-level `tags:` list (starts ~line 9), add an entry:

```yaml
  - name: questlines
    description: Grouping quests into goal-oriented questlines
```

- [ ] **Step 5: Run codegen**

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: completes without error; new hooks appear in `lib/api-client-react/src/generated/api.ts` (grep for `useClaimQuestline`).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. (Generated hooks reference endpoints not yet implemented server-side — that is fine, they are just types.)

- [ ] **Step 7: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react lib/api-zod
git commit -m "feat(api): add questlines endpoints + questlineId to task schemas (codegen)"
```

---

### Task 4: Questlines CRUD route — list, create, detail, update, delete

**Files:**
- Create: `artifacts/api-server/src/routes/questlines.ts`
- Modify: `artifacts/api-server/src/routes/index.ts` (import + `router.use`)

**Interfaces:**
- Consumes: `computeProgress`, `isReadyToClaim` from `../lib/questlines` (Task 2); `questlinesTable`, `tasksTable` from `@workspace/db`; the `formatTask` shape from `tasks.ts` (re-implemented minimally here — see note).
- Produces: an Express router mounted at root, serving `GET/POST /questlines`, `GET/PATCH/DELETE /questlines/:id`. Provides an exported `formatQuestline(row, progress)` used by Task 5.

> **Note on `formatTask`:** `formatTask` in `tasks.ts` is not exported. For the detail endpoint's `quests` array, import and reuse the existing formatter by exporting it. Step 1 exports it; if a merge conflict makes that awkward, inline an equivalent. Keeping one formatter avoids drift.

- [ ] **Step 1: Export `formatTask` from the tasks route**

In `artifacts/api-server/src/routes/tasks.ts`, change the `formatTask` declaration (line ~37) from:

```ts
function formatTask(
```

to:

```ts
export function formatTask(
```

- [ ] **Step 2: Create the questlines router**

Create `artifacts/api-server/src/routes/questlines.ts`:

```ts
import { Router, type IRouter } from "express";
import { eq, and, desc, inArray } from "drizzle-orm";
import { db, questlinesTable, tasksTable, taskStepsTable, type Questline } from "@workspace/db";
import { computeProgress, isReadyToClaim } from "../lib/questlines";
import { formatTask } from "./tasks";

const router: IRouter = Router();

/** Serialize a questline row plus its derived progress for the client. */
export function formatQuestline(row: Questline, progress: { total: number; done: number }) {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    description: row.description,
    color: row.color,
    status: row.status,
    total: progress.total,
    done: progress.done,
    ready: isReadyToClaim(row, progress),
    rewardXpAwarded: row.rewardXpAwarded ?? null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function parseId(raw: string | string[] | undefined): number | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const id = parseInt(s ?? "", 10);
  return isNaN(id) ? null : id;
}

// List questlines with derived progress. One extra query pulls all member quests,
// then progress is grouped in-memory (no N+1).
router.get("/questlines", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
  const where = statusFilter === "active" || statusFilter === "completed"
    ? and(eq(questlinesTable.userId, userId), eq(questlinesTable.status, statusFilter))
    : eq(questlinesTable.userId, userId);

  const rows = await db.select().from(questlinesTable)
    .where(where)
    .orderBy(desc(questlinesTable.createdAt));

  const ids = rows.map((r) => r.id);
  const members = ids.length
    ? await db.select({ questlineId: tasksTable.questlineId, completed: tasksTable.completed })
        .from(tasksTable)
        .where(inArray(tasksTable.questlineId, ids))
    : [];

  const byQuestline = new Map<number, { completed: boolean }[]>();
  for (const m of members) {
    if (m.questlineId == null) continue;
    const arr = byQuestline.get(m.questlineId) ?? [];
    arr.push({ completed: m.completed });
    byQuestline.set(m.questlineId, arr);
  }

  res.json(rows.map((r) => formatQuestline(r, computeProgress(byQuestline.get(r.id) ?? []))));
});

// Create a questline.
router.post("/questlines", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const { title, description, color } = req.body as {
    title?: string; description?: string | null; color?: string | null;
  };
  if (!title || !title.trim()) { res.status(400).json({ error: "title is required" }); return; }

  const [row] = await db.insert(questlinesTable).values({
    userId,
    title: title.trim(),
    description: description ?? null,
    color: color ?? null,
  }).returning();

  res.status(201).json(formatQuestline(row, { total: 0, done: 0 }));
});

// One questline with its quests (focus view).
router.get("/questlines/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db.select().from(questlinesTable)
    .where(and(eq(questlinesTable.id, id), eq(questlinesTable.userId, userId)));
  if (!row) { res.status(404).json({ error: "Questline not found" }); return; }

  const quests = await db.select().from(tasksTable)
    .where(and(eq(tasksTable.questlineId, id), eq(tasksTable.userId, userId)))
    .orderBy(desc(tasksTable.createdAt));

  const questIds = quests.map((q) => q.id);
  const steps = questIds.length
    ? await db.select().from(taskStepsTable)
        .where(inArray(taskStepsTable.taskId, questIds))
        .orderBy(taskStepsTable.position)
    : [];
  const stepsByTask = new Map<number, (typeof taskStepsTable.$inferSelect)[]>();
  for (const s of steps) {
    const arr = stepsByTask.get(s.taskId) ?? [];
    arr.push(s);
    stepsByTask.set(s.taskId, arr);
  }

  const progress = computeProgress(quests.map((q) => ({ completed: q.completed })));
  res.json({
    questline: formatQuestline(row, progress),
    quests: quests.map((q) => formatTask(q, stepsByTask.get(q.id) ?? [])),
  });
});

// Update title/description/color.
router.patch("/questlines/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid id" }); return; }

  const { title, description, color } = req.body as {
    title?: string; description?: string | null; color?: string | null;
  };
  const updates: Partial<typeof questlinesTable.$inferInsert> = {};
  if (title != null) {
    if (!title.trim()) { res.status(400).json({ error: "title cannot be empty" }); return; }
    updates.title = title.trim();
  }
  if (description !== undefined) updates.description = description;
  if (color !== undefined) updates.color = color;

  const [row] = await db.update(questlinesTable).set(updates)
    .where(and(eq(questlinesTable.id, id), eq(questlinesTable.userId, userId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Questline not found" }); return; }

  const members = await db.select({ completed: tasksTable.completed }).from(tasksTable)
    .where(and(eq(tasksTable.questlineId, id), eq(tasksTable.userId, userId)));
  res.json(formatQuestline(row, computeProgress(members)));
});

// Delete a questline; the FK's ON DELETE SET NULL unlinks its quests.
router.delete("/questlines/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db.delete(questlinesTable)
    .where(and(eq(questlinesTable.id, id), eq(questlinesTable.userId, userId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Questline not found" }); return; }

  res.sendStatus(204);
});

export default router;
```

- [ ] **Step 3: Mount the router**

In `artifacts/api-server/src/routes/index.ts`:

Add the import after the `focusSessionsRouter` import (line ~17):

```ts
import questlinesRouter from "./questlines";
```

Add the mount after `router.use(focusSessionsRouter);` (line ~36):

```ts
router.use(questlinesRouter);
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/questlines.ts artifacts/api-server/src/routes/index.ts artifacts/api-server/src/routes/tasks.ts
git commit -m "feat(api): add questlines CRUD route"
```

---

### Task 5: Claim endpoint — grant XP, emit activity, complete the questline

**Files:**
- Modify: `artifacts/api-server/src/routes/questlines.ts` (add the claim handler)

**Interfaces:**
- Consumes: `computeProgress`, `isReadyToClaim`, `computeRewardXp` (Task 2); `formatQuestline` (Task 4); `getLevelInfo` from `../lib/gamification`; `usersTable`, `activityTable` from `@workspace/db`.
- Produces: `POST /questlines/:id/claim` returning `QuestlineClaimResult`.

- [ ] **Step 1: Extend the imports**

In `artifacts/api-server/src/routes/questlines.ts`, update the top imports to add `usersTable`, `activityTable`, `computeRewardXp`, and `getLevelInfo`:

```ts
import { db, questlinesTable, tasksTable, taskStepsTable, usersTable, activityTable, type Questline } from "@workspace/db";
import { computeProgress, isReadyToClaim, computeRewardXp } from "../lib/questlines";
import { getLevelInfo } from "../lib/gamification";
```

(Leave the existing `import { formatTask } from "./tasks";` line as-is.)

- [ ] **Step 2: Add the claim handler**

In `artifacts/api-server/src/routes/questlines.ts`, add this handler immediately before `export default router;`:

```ts
// Claim the one-time XP reward for a fully-completed questline.
router.post("/questlines/:id/claim", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid id" }); return; }

  type Outcome =
    | { status: "not_found" }
    | { status: "not_ready" }
    | { status: "ok"; row: Questline; progress: { total: number; done: number }; xp: number; totalPoints: number; level: number; levelName: string; leveledUp: boolean };

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    // Lock the user row so concurrent claims can't double-award or read stale totals.
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).for("update");
    if (!user) return { status: "not_found" };

    const [row] = await tx.select().from(questlinesTable)
      .where(and(eq(questlinesTable.id, id), eq(questlinesTable.userId, userId)))
      .for("update");
    if (!row) return { status: "not_found" };

    const members = await tx.select({ completed: tasksTable.completed }).from(tasksTable)
      .where(and(eq(tasksTable.questlineId, id), eq(tasksTable.userId, userId)));
    const progress = computeProgress(members);

    if (!isReadyToClaim(row, progress)) return { status: "not_ready" };

    const xp = computeRewardXp(progress.total);
    const newTotal = user.totalPoints + xp;
    const beforeLevel = getLevelInfo(user.totalPoints).level;
    const afterLevel = getLevelInfo(newTotal);

    await tx.update(usersTable).set({
      totalPoints: newTotal,
      weeklyPoints: user.weeklyPoints + xp,
      currentLevel: afterLevel.level,
    }).where(eq(usersTable.id, userId));

    const [updated] = await tx.update(questlinesTable).set({
      status: "completed",
      completedAt: new Date(),
      rewardXpAwarded: xp,
    }).where(eq(questlinesTable.id, id)).returning();

    await tx.insert(activityTable).values({
      userId,
      type: "questline_complete",
      description: `Completed questline · ${row.title}`,
      points: xp,
    });

    return {
      status: "ok",
      row: updated,
      progress,
      xp,
      totalPoints: newTotal,
      level: afterLevel.level,
      levelName: afterLevel.name,
      leveledUp: afterLevel.level > beforeLevel,
    };
  });

  if (outcome.status === "not_found") { res.status(404).json({ error: "Questline not found" }); return; }
  if (outcome.status === "not_ready") { res.status(409).json({ error: "Questline is not ready to claim" }); return; }

  res.status(200).json({
    questline: formatQuestline(outcome.row, outcome.progress),
    xpAwarded: outcome.xp,
    totalPoints: outcome.totalPoints,
    currentLevel: outcome.level,
    levelName: outcome.levelName,
    leveledUp: outcome.leveledUp,
  });
});
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/questlines.ts
git commit -m "feat(api): add questline claim endpoint (XP + activity + completion)"
```

---

### Task 6: Task membership — accept `questlineId` on create/update, expose it on read

**Files:**
- Modify: `artifacts/api-server/src/routes/tasks.ts` (`formatTask`, `POST /tasks`, `PATCH /tasks/:id`)

**Interfaces:**
- Consumes: `isQuestlineAssignable` from `../lib/questlines` (Task 2); `questlinesTable` from `@workspace/db`.
- Produces: `formatTask` now includes `questlineId`; create/update honor and validate `questlineId`.

- [ ] **Step 1: Import the guard and the questlines table**

In `artifacts/api-server/src/routes/tasks.ts`:

Add to the existing `@workspace/db` import (line 4) — append `questlinesTable`:

```ts
import { db, usersTable, tasksTable, badgesTable, userBadgesTable, activityTable, userGearTable, taskStepsTable, questlinesTable } from "@workspace/db";
```

Add a new import near the other lib imports (after the `anchored-tasks` import, line ~18):

```ts
import { isQuestlineAssignable } from "../lib/questlines";
```

- [ ] **Step 2: Expose `questlineId` on read**

In `formatTask` (line ~59), add after the `isAnchored: task.isAnchored,` line:

```ts
    questlineId: task.questlineId ?? null,
```

- [ ] **Step 3: Add a shared assignment validator**

In `artifacts/api-server/src/routes/tasks.ts`, add this helper just below `formatTask` (before the first `router.get`):

```ts
// Resolve a client-supplied questlineId for a create/update. Returns:
//  - { ok: true, value }  -> use `value` (a number to link, or null to unlink)
//  - { ok: false, error } -> reject with a 422
// A quest may only join a questline the user owns, and only if it is one-off.
async function resolveQuestlineId(
  userId: number,
  questlineId: number | null | undefined,
  task: { recurringTaskId: number | null },
): Promise<{ ok: true; value: number | null } | { ok: false; error: string }> {
  if (questlineId === undefined) return { ok: true, value: null };
  if (questlineId === null) return { ok: true, value: null };
  if (!isQuestlineAssignable(task)) {
    return { ok: false, error: "Recurring quests can't join a questline" };
  }
  const [ql] = await db.select({ id: questlinesTable.id }).from(questlinesTable)
    .where(and(eq(questlinesTable.id, questlineId), eq(questlinesTable.userId, userId)));
  if (!ql) return { ok: false, error: "Questline not found" };
  return { ok: true, value: questlineId };
}
```

- [ ] **Step 4: Honor `questlineId` on create**

In `POST /tasks` (line ~253), add `questlineId` to the destructured body and its type:

```ts
  const { title, description, dueDate, dueTime, priority = "medium", estimatedMinutes, category, isAnchored, questlineId } = req.body as {
    title?: string;
    description?: string;
    dueDate?: string;
    dueTime?: string;
    priority?: string;
    estimatedMinutes?: number;
    category?: string;
    isAnchored?: boolean;
    questlineId?: number | null;
  };
```

Then, immediately before the `const [task] = await db.insert(tasksTable)` call, resolve it (new tasks are never recurring, so pass `recurringTaskId: null`):

```ts
  const qlResult = await resolveQuestlineId(userId, questlineId, { recurringTaskId: null });
  if (!qlResult.ok) { res.status(422).json({ error: qlResult.error }); return; }
```

And add `questlineId: qlResult.value,` to the `.values({ ... })` object (e.g. after `isAnchored: anchored,`):

```ts
    isAnchored: anchored,
    questlineId: qlResult.value,
```

- [ ] **Step 5: Honor `questlineId` on update**

In `PATCH /tasks/:id`, the upfront ownership fetch (line ~379) currently selects only `completed`. Widen it to also fetch `recurringTaskId`:

```ts
  const [existing] = await db.select({ completed: tasksTable.completed, recurringTaskId: tasksTable.recurringTaskId })
    .from(tasksTable)
    .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)));
```

Add `questlineId` to the destructured body and its type (line ~385):

```ts
  const { title, description, dueDate, dueTime, priority, estimatedMinutes, actualMinutes, category, isAnchored, questlineId } = req.body as {
    title?: string;
    description?: string;
    dueDate?: string;
    dueTime?: string;
    priority?: string;
    estimatedMinutes?: number;
    actualMinutes?: number;
    category?: string;
    isAnchored?: boolean;
    questlineId?: number | null;
  };
```

Then in the **incomplete-task** branch (after the `if (category != null ...)` line, ~line 432), add:

```ts
  if (questlineId !== undefined) {
    const qlResult = await resolveQuestlineId(userId, questlineId, { recurringTaskId: existing.recurringTaskId });
    if (!qlResult.ok) { res.status(422).json({ error: qlResult.error }); return; }
    updates.questlineId = qlResult.value;
  }
```

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/routes/tasks.ts
git commit -m "feat(api): assign quests to questlines on task create/update"
```

---

### Task 7: Frontend — Questlines list page, route, nav, create dialog

**Files:**
- Create: `artifacts/focusquest/src/pages/questlines.tsx`
- Modify: `artifacts/focusquest/src/App.tsx` (import + `<Route>`)
- Modify: `artifacts/focusquest/src/components/layout.tsx` (nav item + icon import)

**Interfaces:**
- Consumes: `useGetQuestlines`, `useCreateQuestline`, `getGetQuestlinesQueryKey`, type `Questline` (Task 3).
- Produces: a `/questlines` page listing questlines with progress bars + a create dialog; a nav entry.

- [ ] **Step 1: Create the list page**

Create `artifacts/focusquest/src/pages/questlines.tsx`:

```tsx
import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Scroll, Plus, Trophy, ChevronRight } from "lucide-react";
import {
  Questline,
  useGetQuestlines,
  useCreateQuestline,
  getGetQuestlinesQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="mt-3">
      <div className="flex justify-between text-xs text-muted-foreground mb-1">
        <span>{done} / {total} quests</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function QuestlineCard({ ql }: { ql: Questline }) {
  const completed = ql.status === "completed";
  return (
    <Link href={`/questlines/${ql.id}`}>
      <a className={`block p-5 rounded-xl border transition-all cursor-pointer ${
        ql.ready
          ? "border-primary bg-primary/5 shadow-[0_0_15px_rgba(0,255,255,0.15)]"
          : completed
            ? "border-muted bg-muted/20 opacity-75"
            : "border-border bg-card hover:border-primary/50"
      }`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Scroll className="w-4 h-4 flex-shrink-0" style={ql.color ? { color: ql.color } : undefined} />
            <h3 className={`font-semibold truncate ${completed ? "text-muted-foreground" : "text-foreground"}`}>
              {ql.title}
            </h3>
          </div>
          {ql.ready && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border border-primary text-primary uppercase tracking-wider whitespace-nowrap">
              <Trophy className="w-3 h-3" /> Ready
            </span>
          )}
          {completed && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 uppercase tracking-wider">
              Done
            </span>
          )}
        </div>
        {ql.description && <p className="text-sm text-muted-foreground mt-1 truncate">{ql.description}</p>}
        <ProgressBar done={ql.done} total={ql.total} />
        <div className="flex justify-end mt-2 text-xs text-muted-foreground">
          <ChevronRight className="w-4 h-4" />
        </div>
      </a>
    </Link>
  );
}

export default function Questlines() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: questlines, isLoading } = useGetQuestlines();
  const createMutation = useCreateQuestline();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const handleCreate = () => {
    if (!title.trim()) return;
    createMutation.mutate(
      { data: { title: title.trim(), description: description.trim() || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetQuestlinesQueryKey() });
          setTitle("");
          setDescription("");
          setIsCreateOpen(false);
          toast({ title: "Questline created", className: "border-primary" });
        },
        onError: (err: any) => {
          toast({ title: err?.response?.data?.error ?? "Could not create questline", variant: "destructive" });
        },
      },
    );
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Scroll className="w-6 h-6 text-primary" /> Questlines</h1>
          <p className="text-sm text-muted-foreground mt-1">Chain related quests toward a bigger goal.</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} className="gap-1">
          <Plus className="w-4 h-4" /> New
        </Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !questlines || questlines.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border rounded-xl">
          <Scroll className="w-10 h-10 mx-auto text-muted-foreground/50" />
          <p className="mt-3 text-muted-foreground">No questlines yet. Start one to group quests toward a goal.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {questlines.map((ql) => <QuestlineCard key={ql.id} ql={ql} />)}
        </div>
      )}

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Questline</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Title (e.g. Run a 5K)" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }} />
            <Textarea placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={!title.trim() || createMutation.isPending}>
                {createMutation.isPending ? "Creating…" : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

> If `@/components/ui/textarea` does not exist, run `pnpm dlx shadcn@latest add textarea` in `artifacts/focusquest`, or replace `<Textarea>` with `<Input>`. Verify by checking `artifacts/focusquest/src/components/ui/` for `textarea.tsx` before writing.

- [ ] **Step 2: Register the routes**

In `artifacts/focusquest/src/App.tsx`, add the import alongside the other page imports (near the top, matching the existing import style):

```tsx
import Questlines from "@/pages/questlines";
import QuestlineDetail from "@/pages/questline-detail";
```

Add two routes inside the `<Switch>`/router block, after the `/tasks` route (line ~154):

```tsx
        <Route path="/questlines/:id" component={QuestlineDetail} />
        <Route path="/questlines" component={Questlines} />
```

> `QuestlineDetail` is created in Task 8. Adding both routes now keeps App.tsx edited once; the import will fail typecheck until Task 8 creates the file — so **run Step 4's typecheck after Task 8**, or temporarily create an empty `questline-detail.tsx` stub. To keep this task independently green, create the stub now:
> ```tsx
> // artifacts/focusquest/src/pages/questline-detail.tsx (stub, replaced in Task 8)
> export default function QuestlineDetail() { return null; }
> ```

- [ ] **Step 3: Add the nav item**

In `artifacts/focusquest/src/components/layout.tsx`:

Add `Scroll` to the existing `lucide-react` import (find the import line with `Timer`, `Repeat`, etc. and add `Scroll`).

Add to the `NAV_ITEMS` array (after the `/tasks` entry, line ~143):

```tsx
  { href: "/questlines",     label: "Questlines", icon: Scroll,       mobileShow: false },
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (with the Task 8 stub in place).

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/pages/questlines.tsx artifacts/focusquest/src/pages/questline-detail.tsx artifacts/focusquest/src/App.tsx artifacts/focusquest/src/components/layout.tsx
git commit -m "feat(web): add questlines list page, route, and nav"
```

---

### Task 8: Frontend — Questline detail (focus view) with claim + celebration

**Files:**
- Modify (replace stub): `artifacts/focusquest/src/pages/questline-detail.tsx`

**Interfaces:**
- Consumes: `useGetQuestline`, `useClaimQuestline`, `getGetQuestlineQueryKey`, `getGetQuestlinesQueryKey`, `getGetMyStatsQueryKey` (Task 3 + existing); `TaskItem` component; `dispatchQuestCompleted` from `@/components/dopamine-overlay`; `useRoute` from wouter.
- Produces: `/questlines/:id` focus view with a Claim button.

- [ ] **Step 1: Implement the detail page**

Replace `artifacts/focusquest/src/pages/questline-detail.tsx` with:

```tsx
import { useRoute, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Scroll, Trophy } from "lucide-react";
import {
  useGetQuestline,
  useClaimQuestline,
  getGetQuestlineQueryKey,
  getGetQuestlinesQueryKey,
  getGetMyStatsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { TaskItem } from "@/components/task-item";
import { dispatchQuestCompleted } from "@/components/dopamine-overlay";
import { useToast } from "@/hooks/use-toast";

export default function QuestlineDetail() {
  const [, params] = useRoute("/questlines/:id");
  const id = params?.id ? parseInt(params.id, 10) : NaN;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useGetQuestline(id, { query: { enabled: !isNaN(id) } });
  const claimMutation = useClaimQuestline();

  const handleClaim = () => {
    claimMutation.mutate({ id }, {
      onSuccess: (res) => {
        queryClient.invalidateQueries({ queryKey: getGetQuestlineQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getGetQuestlinesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
        dispatchQuestCompleted();
        toast({
          title: `Questline complete! +${res.xpAwarded} XP`,
          description: res.leveledUp ? `Level up! You're now ${res.levelName}.` : undefined,
          className: "border-primary bg-primary text-primary-foreground",
        });
      },
      onError: (err: any) => {
        toast({ title: err?.response?.data?.error ?? "Could not claim reward", variant: "destructive" });
      },
    });
  };

  if (isLoading) return <div className="max-w-3xl mx-auto px-4 py-6 text-muted-foreground">Loading…</div>;
  if (!data) return <div className="max-w-3xl mx-auto px-4 py-6 text-muted-foreground">Questline not found.</div>;

  const { questline, quests } = data;
  const pct = questline.total > 0 ? Math.round((questline.done / questline.total) * 100) : 0;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <Link href="/questlines">
        <a className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="w-4 h-4" /> Questlines
        </a>
      </Link>

      <div className="p-5 rounded-xl border border-border bg-card mb-6">
        <div className="flex items-center gap-2">
          <Scroll className="w-5 h-5 text-primary" style={questline.color ? { color: questline.color } : undefined} />
          <h1 className="text-xl font-bold">{questline.title}</h1>
        </div>
        {questline.description && <p className="text-sm text-muted-foreground mt-1">{questline.description}</p>}

        <div className="mt-4">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>{questline.done} / {questline.total} quests</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {questline.ready && (
          <Button onClick={handleClaim} disabled={claimMutation.isPending} className="mt-4 w-full gap-1">
            <Trophy className="w-4 h-4" />
            {claimMutation.isPending ? "Claiming…" : "Claim reward"}
          </Button>
        )}
        {questline.status === "completed" && (
          <p className="mt-4 text-sm text-emerald-400 flex items-center gap-1">
            <Trophy className="w-4 h-4" /> Completed — {questline.rewardXpAwarded} XP claimed
          </p>
        )}
      </div>

      {quests.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">
          No quests yet. Assign quests to this questline from the Quest Log.
        </p>
      ) : (
        <div className="space-y-3">
          {quests.map((task) => <TaskItem key={task.id} task={task} />)}
        </div>
      )}
    </div>
  );
}
```

> **Verify hook signature before writing:** confirm `useGetQuestline`'s generated signature in `lib/api-client-react/src/generated/api.ts` — orval typically generates `useGetQuestline(id, options?)`. Adjust the call in Step 1 if the generated arg shape differs (e.g. an object param).

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/focusquest/src/pages/questline-detail.tsx
git commit -m "feat(web): add questline detail focus view with claim + celebration"
```

---

### Task 9: Frontend — Quest Log integration (chip, selector, filter) + end-to-end verify

**Files:**
- Modify: `artifacts/focusquest/src/components/task-item.tsx` (questline chip)
- Modify: `artifacts/focusquest/src/pages/tasks.tsx` (questline selector in create/edit dialog + filter control)

**Interfaces:**
- Consumes: `useGetQuestlines`, type `Questline` (Task 3); the create/update task mutations already accept `questlineId` (Task 3 schema + Task 6 backend).

- [ ] **Step 1: Add a questline chip to the task card**

In `artifacts/focusquest/src/components/task-item.tsx`, add `Scroll` to the `lucide-react` import (line 2). Then, in the badge row (immediately after the category badge block that ends at line ~310), add:

```tsx
          {task.questlineId != null && (
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary font-medium">
              <Scroll className="w-2.5 h-2.5" /> Questline
            </span>
          )}
```

- [ ] **Step 2: Load questlines in the Quest Log page**

In `artifacts/focusquest/src/pages/tasks.tsx`:

Add to the api-client import (line 4):

```tsx
import { Task, useGetTasks, useCreateTask, useUpdateTask, useBreakdownTask, TaskPriority, useGetQuestlines } from "@workspace/api-client-react";
```

Inside the component (near the other query hooks, ~line 254), add:

```tsx
  const { data: questlines } = useGetQuestlines({ status: "active" });
```

Add filter + create/edit selection state alongside the existing `useState` block (near line 194 / 200):

```tsx
  const [questlineFilter, setQuestlineFilter] = useState<string>("all");
  const [newTaskQuestlineId, setNewTaskQuestlineId] = useState<string>("none");
  const [editQuestlineId, setEditQuestlineId] = useState<string>("none");
```

- [ ] **Step 3: Send `questlineId` on create**

In the create handler (`handleCreate`/`createMutation.mutate`, ~line 279), add `questlineId` to the `data` object:

```tsx
        ...(newTaskQuestlineId !== "none" ? { questlineId: parseInt(newTaskQuestlineId, 10) } : {}),
```

Reset it on success alongside the other field resets (set `setNewTaskQuestlineId("none")`).

- [ ] **Step 4: Add the questline selector to the create dialog**

In the create dialog's form (near the category `<Select>`), add a questline selector. Insert:

```tsx
          <div>
            <label className="text-sm text-muted-foreground">Questline (optional)</label>
            <Select value={newTaskQuestlineId} onValueChange={setNewTaskQuestlineId}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {(questlines ?? []).map((ql) => (
                  <SelectItem key={ql.id} value={String(ql.id)}>{ql.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
```

- [ ] **Step 5: Wire the edit dialog**

When opening the edit dialog (the handler that seeds `editTitle`, `editCategory`, etc. from a task), also seed:

```tsx
    setEditQuestlineId(task.questlineId != null ? String(task.questlineId) : "none");
```

In the edit-save mutation's `data`, add:

```tsx
      questlineId: editQuestlineId !== "none" ? parseInt(editQuestlineId, 10) : null,
```

And add the same `<Select>` markup from Step 4 to the edit dialog, bound to `editQuestlineId` / `setEditQuestlineId`.

- [ ] **Step 6: Add the client-side questline filter**

Where the visible task list is derived (the code that already applies `filter`/`categoryFilter`), add a questline filter pass. If tasks are rendered from a `tasks` array, filter before mapping:

```tsx
  const visibleTasks = (tasks ?? []).filter((t) =>
    questlineFilter === "all" ? true : String(t.questlineId ?? "") === questlineFilter,
  );
```

Render `visibleTasks` instead of `tasks` in the list. Add a filter control next to the existing category filter:

```tsx
        <Select value={questlineFilter} onValueChange={setQuestlineFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="All questlines" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All questlines</SelectItem>
            {(questlines ?? []).map((ql) => (
              <SelectItem key={ql.id} value={String(ql.id)}>{ql.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
```

> Read the existing filter/render block in `tasks.tsx` first and match its exact variable names (the list may already be named differently). Keep the existing category/status filters working.

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: End-to-end verification in the preview**

Start the app and drive the full flow (create a launch config if none exists — see `.claude/launch.json`). Verify, using the browser preview tools:

1. Navigate to `/questlines` → create a questline "Run a 5K".
2. Go to the Quest Log → create two one-off quests, both assigned to "Run a 5K" via the new selector. Confirm each card shows the Questline chip.
3. Back on `/questlines`, the card shows `0/2` then updates as you complete quests. Filter the Quest Log by the questline and confirm only its quests show.
4. Complete both quests → open the questline detail → the **Claim reward** button appears. Click it → XP toast (`+50 XP` for 2 quests) + dopamine overlay fires, and the card flips to **Done**.
5. Try assigning a recurring quest to a questline (from `/recurring`-spawned instance, if reachable) — confirm it is rejected with the 422 message (or is not offered).
6. Check `read_console_messages` and `preview_logs` for errors; capture a screenshot of the completed questline.

- [ ] **Step 9: Run the full test + typecheck gate**

Run:
```bash
pnpm --filter @workspace/api-server test
pnpm typecheck
```
Expected: all tests PASS, typecheck PASS.

- [ ] **Step 10: Commit**

```bash
git add artifacts/focusquest/src/components/task-item.tsx artifacts/focusquest/src/pages/tasks.tsx
git commit -m "feat(web): assign/filter quests by questline in the Quest Log"
```

---

## Self-Review

**Spec coverage** — every spec section maps to a task:
- `questlines` table + `tasks.questlineId` (schema, membership, delete-unlink) → Task 1.
- Derived progress, ready-state, reward math, recurring-exclusion (pure logic) → Task 2.
- Endpoints (GET list/create/detail/patch/delete, claim, task membership) + contract → Tasks 3–6.
- Claim: XP via existing gamification path, snapshot, activity row, level return → Task 5.
- Membership validation (owned + one-off), `questlineId` on read → Task 6.
- List page, focus view, nav, chip, selector, filter, celebration → Tasks 7–9.
- Testing convention (pure-function units; no HTTP harness) → Task 2 + Task 9 gate.

**Placeholder scan** — no TBD/TODO; every code step shows complete code. Two flagged *verify-before-write* notes (textarea component existence in Task 7; `useGetQuestline` generated arg shape in Task 8) are deliberate guardrails against orval/shadcn variance, not missing content.

**Type consistency** — `computeProgress`/`isReadyToClaim`/`computeRewardXp`/`isQuestlineAssignable` signatures match across Tasks 2, 4, 5, 6. `formatQuestline(row, progress)` defined in Task 4, reused in Task 5. `QuestlineClaimResult` fields (`xpAwarded`, `totalPoints`, `currentLevel`, `levelName`, `leveledUp`) match between the openapi schema (Task 3) and the handler response (Task 5) and the frontend consumer (Task 8). `questlineId` naming is consistent across schema, DB column (`questline_id`), and TS.

**Known deviation from spec wording:** the spec mentioned "route tests"; the codebase has no HTTP test harness, so guard/reward logic is unit-tested in `questlines.ts` and handlers are verified by typecheck + the Task 9 end-to-end preview. This matches the established api-server convention.
