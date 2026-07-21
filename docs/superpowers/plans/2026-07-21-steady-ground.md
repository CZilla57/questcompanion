# Steady Ground (Act VII q7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ops resilience + data trust: a GitHub-Actions backup cron and dead-man heartbeat so the tick can never silently die, an atomic push-budget counter so overlapping crons can't double-send, and account export/delete with a Danger-zone entry point — the last Act VII quest.

**Architecture:** (1) The envelope pass's read-modify-write on `pushes_sent_count`/`last_push_at` becomes an atomic **claim-before-send**: one conditional `UPDATE … WHERE spacing-and-budget-still-hold RETURNING`; the row lock serializes overlapping ticks and a losing tick skips the send. This is the prerequisite that makes cron overlap actually safe. (2) `tick()` gains a fire-and-forget heartbeat ping (env-gated, no-op unset) and a `backup-cron.yml` workflow POSTs `/api/cron/tick` every 5 minutes with `CRON_SECRET`. (3) A single `USER_DATA_TABLES` registry drives both `DELETE /api/me` (one transaction, children-first, sessions + users last) and `GET /api/me/export` (one honest JSON); a **schema-walking guard test** (drizzle `getTableConfig` introspection) fails the suite if a future user-keyed table is added without registering it. (4) A small Account dialog off the header hosts Export + the confirm-phrase delete.

**Tech Stack:** Express + drizzle (Neon PG), GitHub Actions cron, hand-authored `lib/api-spec/openapi.yaml` → orval codegen, React 19 + shadcn Dialog, vitest.

## Global Constraints

- **Anti-shame / no dark patterns:** Danger-zone copy is plain and honest; delete requires typing the confirm phrase; no guilt copy, no retention tricks.
- **Act VII rule:** settings + trust plumbing only — no new game features.
- **Free infra only:** GitHub Actions cron (min interval 5 min, delays expected — acceptable per spec), healthchecks.io free tier (Chad provisions), no paid services.
- **Fail-safe direction for the counter:** charge the budget *before* sending; a thrown send loses one quiet slot but can never double-push.
- **`tick()` passes must stay idempotent/deduped** — the backup cron overlaps the primary by design.
- **Shared working tree:** verify `git branch --show-current` is `feat/steady-ground` before every commit.
- **Zero schema migrations.** Sessions table and all user tables already exist.
- **Out of scope (spec):** paid infra, multi-region, backups beyond Neon's own, GDPR paperwork, Auth0 management-API integration (manual cleanup documented instead).

## File Structure

```
artifacts/api-server/src/lib/notification-scheduler.ts   # MODIFY: claim-before-send in runEnvelopePass; heartbeat call in tick()
artifacts/api-server/src/lib/heartbeat.ts                # CREATE: env-gated dead-man ping (injected fetch)
artifacts/api-server/src/lib/heartbeat.test.ts           # CREATE
artifacts/api-server/src/lib/account-data.ts             # CREATE: USER_DATA_TABLES registry (delete order + export names)
artifacts/api-server/src/lib/account-data.test.ts        # CREATE: schema-walking guard (getTableConfig introspection)
artifacts/api-server/src/routes/account.ts               # CREATE: GET /me/export, DELETE /me
artifacts/api-server/src/routes/index.ts                 # MODIFY: register accountRouter
.github/workflows/backup-cron.yml                        # CREATE: 5-min POST /api/cron/tick
lib/api-spec/openapi.yaml                                # MODIFY: /me/export, /me delete + schemas
artifacts/focusquest/src/lib/account.ts                  # CREATE: confirmPhraseOk pure helper
artifacts/focusquest/src/lib/account.test.ts             # CREATE
artifacts/focusquest/src/components/account-dialog.tsx   # CREATE: Account + Danger zone dialog
artifacts/focusquest/src/components/layout.tsx           # MODIFY: AccountDialog trigger beside the bell
docs/ops/steady-ground.md                                # CREATE: CRON_SECRET GH secret, healthchecks setup, Auth0 manual cleanup
```

---

### Task 1: Atomic push-slot claim (the mandated counter fix)

**Files:**
- Modify: `artifacts/api-server/src/lib/notification-scheduler.ts` (`runEnvelopePass`, lines ~300–315)

**Why first:** the Act VII spec's "overlap is safe" claim is false today: `runEnvelopePass` reads `user.pushesSentDate/Count/lastPushAt` from the tick-start users fetch, sends, then writes `staleCount + 1`. Two overlapping ticks both pass `selectPush` and both send. Everything else in this quest assumes overlap is safe.

**Interfaces:**
- Consumes: existing `selectPush`, `consumesBudget`, `DAILY_PUSH_BUDGET`, `PUSH_SPACING_MIN` from `./notification-envelope`; drizzle `and/or/eq/isNull/ne/lt/lte/sql`.
- Produces: no signature changes; `runEnvelopePass` behavior: claim → send → commit.

- [ ] **Step 1: Replace the post-send bookkeeping with a pre-send claim**

In `runEnvelopePass`, replace:

```ts
      const produced = candidates.find((c) => c === winner)!;
      await notify(user.id, produced.title, produced.body, produced.tag, produced.url ? { url: produced.url } : undefined);
      await produced.commit();
      const sentToday = user.pushesSentDate === localToday ? user.pushesSentCount : 0;
      await db.update(usersTable)
        .set(consumesBudget(produced.kind)
          ? { pushesSentDate: localToday, pushesSentCount: sentToday + 1, lastPushAt: now }
          : { lastPushAt: now })
        .where(eq(usersTable.id, user.id));
```

with:

```ts
      const produced = candidates.find((c) => c === winner)!;

      // Atomic claim-before-send (Act VII q7): selectPush decided from a
      // tick-start snapshot, so re-verify spacing + budget against the CURRENT
      // row in one conditional UPDATE. The row lock serializes overlapping
      // ticks (primary + backup cron); the loser matches 0 rows and skips.
      // Charging before the send is the fail-safe direction: a thrown send
      // loses one quiet slot but can never double-push.
      const spacingCutoff = new Date(now.getTime() - PUSH_SPACING_MIN * 60_000);
      const spacingOk = or(isNull(usersTable.lastPushAt), lte(usersTable.lastPushAt, spacingCutoff));
      const budgetOk = or(
        isNull(usersTable.pushesSentDate),
        ne(usersTable.pushesSentDate, localToday),
        lt(usersTable.pushesSentCount, DAILY_PUSH_BUDGET),
      );
      const claimed = await db.update(usersTable)
        .set(consumesBudget(produced.kind)
          ? {
              lastPushAt: now,
              pushesSentDate: localToday,
              pushesSentCount: sql`CASE WHEN ${usersTable.pushesSentDate} = ${localToday} THEN ${usersTable.pushesSentCount} + 1 ELSE 1 END`,
            }
          : { lastPushAt: now })
        .where(and(
          eq(usersTable.id, user.id),
          spacingOk,
          ...(consumesBudget(produced.kind) ? [budgetOk] : []),
        ))
        .returning({ id: usersTable.id });
      if (claimed.length === 0) continue; // another tick won this slot

      await notify(user.id, produced.title, produced.body, produced.tag, produced.url ? { url: produced.url } : undefined);
      await produced.commit();
```

Add `or`, `ne`, `lt`, `lte`, `isNull`, `sql` to the scheduler's drizzle import if missing (`isNull`, `lte`, `lt` already imported; check `or`, `ne`, `sql`). Import `DAILY_PUSH_BUDGET`, `PUSH_SPACING_MIN` from `./notification-envelope`.

- [ ] **Step 2: Typecheck + full API suite**

Run: `pnpm -C artifacts/api-server typecheck && pnpm -C artifacts/api-server test`
Expected: PASS — envelope unit tests are pure and unchanged; no test asserts the old write order.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/lib/notification-scheduler.ts
git commit -m "fix(envelope): atomic claim-before-send closes the budget double-spend race"
```

### Task 2: Dead-man heartbeat in `tick()`

**Files:**
- Create: `artifacts/api-server/src/lib/heartbeat.ts`
- Create: `artifacts/api-server/src/lib/heartbeat.test.ts`
- Modify: `artifacts/api-server/src/lib/notification-scheduler.ts` (end of `tick()`)

**Interfaces:**
- Produces: `pingHeartbeat(fetchFn?: typeof fetch): Promise<boolean>` — true when a ping was attempted and succeeded, false otherwise; never throws.

- [ ] **Step 1: Write the failing tests**

Create `artifacts/api-server/src/lib/heartbeat.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { pingHeartbeat } from "./heartbeat";

afterEach(() => {
  delete process.env.HEARTBEAT_URL;
});

describe("pingHeartbeat", () => {
  it("is a no-op when HEARTBEAT_URL is unset", async () => {
    const fetchFn = vi.fn();
    await expect(pingHeartbeat(fetchFn as unknown as typeof fetch)).resolves.toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("pings the configured URL and reports success", async () => {
    process.env.HEARTBEAT_URL = "https://hc-ping.com/abc";
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    await expect(pingHeartbeat(fetchFn as unknown as typeof fetch)).resolves.toBe(true);
    expect(fetchFn).toHaveBeenCalledWith("https://hc-ping.com/abc", expect.objectContaining({ method: "GET" }));
  });

  it("swallows network failure — the tick must never die for the monitor", async () => {
    process.env.HEARTBEAT_URL = "https://hc-ping.com/abc";
    const fetchFn = vi.fn().mockRejectedValue(new Error("down"));
    await expect(pingHeartbeat(fetchFn as unknown as typeof fetch)).resolves.toBe(false);
  });

  it("reports false on a non-2xx response", async () => {
    process.env.HEARTBEAT_URL = "https://hc-ping.com/abc";
    const fetchFn = vi.fn().mockResolvedValue({ ok: false });
    await expect(pingHeartbeat(fetchFn as unknown as typeof fetch)).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm -C artifacts/api-server test src/lib/heartbeat.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `artifacts/api-server/src/lib/heartbeat.ts`:

```ts
import { logger } from "./logger";

/** Dead-man's switch (Act VII q7): after a successful tick, GET the
 * healthchecks.io-style URL in HEARTBEAT_URL. The monitor alerts on a GAP in
 * pings, so this must be best-effort — env unset is a silent no-op, and no
 * failure here may ever fail the tick. */
export async function pingHeartbeat(fetchFn: typeof fetch = fetch): Promise<boolean> {
  const url = process.env.HEARTBEAT_URL;
  if (!url) return false;
  try {
    const res = await fetchFn(url, { method: "GET", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      logger.warn({ status: (res as Response).status }, "Heartbeat ping got a non-2xx response");
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err }, "Heartbeat ping failed");
    return false;
  }
}
```

In `notification-scheduler.ts`, find `export async function tick(` and add as its final statement (after all passes, before returning): `await pingHeartbeat();` — with `import { pingHeartbeat } from "./heartbeat";` at the top. Keep it after the passes so a ping means "a full tick completed".

- [ ] **Step 4: Run to verify green + suite**

Run: `pnpm -C artifacts/api-server test src/lib/heartbeat.test.ts && pnpm -C artifacts/api-server typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/heartbeat.ts artifacts/api-server/src/lib/heartbeat.test.ts artifacts/api-server/src/lib/notification-scheduler.ts
git commit -m "feat(ops): dead-man heartbeat ping after each completed tick"
```

### Task 3: Backup scheduler — GitHub Actions cron

**Files:**
- Create: `.github/workflows/backup-cron.yml`

**Interfaces:** none (infra). Overlap with cron-job.org is safe: every pass is idempotent/deduped and Task 1 made the envelope counter atomic.

- [ ] **Step 1: Write the workflow**

```yaml
# Backup scheduler (Act VII q7 — Steady Ground). cron-job.org is the primary
# tick; this fires every 5 minutes as the dead-simple fallback so one silent
# lapse can't stop notifications AND cold-start the dyno. Overlap with the
# primary is safe: every pass is idempotent and the push budget is claimed
# atomically. GitHub cron may lag minutes under load — acceptable for a backup.
name: backup-cron
on:
  schedule:
    - cron: "*/5 * * * *"
  workflow_dispatch: {}

concurrency:
  group: backup-cron
  cancel-in-progress: false

jobs:
  tick:
    runs-on: ubuntu-latest
    timeout-minutes: 3
    steps:
      - name: POST /api/cron/tick
        env:
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
        run: |
          curl -fsS -X POST "https://getfocusquest.com/api/cron/tick" \
            -H "Authorization: Bearer ${CRON_SECRET}" \
            --max-time 60 \
            -o /dev/null -w "http=%{http_code} time=%{time_total}s\n"
```

`-f` fails the job on non-2xx so gaps and auth breakage show as red runs in the Actions tab.

- [ ] **Step 2: Validate + commit**

Run: `npx --yes yaml-lint .github/workflows/backup-cron.yml 2>/dev/null || node -e "require('js-yaml') && console.log('skip')" || true` — if no YAML linter is handy, eyeball indentation; the file is short.

```bash
git add .github/workflows/backup-cron.yml
git commit -m "feat(ops): GitHub Actions backup cron hits /api/cron/tick every 5 min"
```

**Post-merge (recorded in docs, Task 7):** set the repo secret — `gh secret set CRON_SECRET` with the value from `.env` — and run the workflow once via `workflow_dispatch` to prove it. `workflow_dispatch` requires the workflow to exist on the default branch, so this happens after merge.

### Task 4: `USER_DATA_TABLES` registry + schema-walking guard test

**Files:**
- Create: `artifacts/api-server/src/lib/account-data.ts`
- Create: `artifacts/api-server/src/lib/account-data.test.ts`

**Interfaces:**
- Produces: `USER_DATA_TABLES: readonly UserDataTable[]` where `UserDataTable = { name: string; table: PgTable; userColumns: PgColumn[] }`; ordered children-first so `DELETE /api/me` can walk it top-to-bottom inside one transaction and delete `users` last (users itself is NOT in the list). `userWhere(t, userId)` builds `eq` or `or(eq, eq)` across the user columns.

- [ ] **Step 1: Write the registry**

Create `artifacts/api-server/src/lib/account-data.ts`:

```ts
// Act VII q7: the single source of truth for "which tables hold a user's
// data". DELETE /api/me and GET /api/me/export both walk this list, and
// account-data.test.ts walks the drizzle schema to prove the list is
// complete — adding a user-keyed table without registering it fails CI.
//
// Order is FK-safe for deletion (children before the tables they reference;
// the users row itself is deleted after the whole list). Tables with two user
// columns (partnerships, ally_nudges) match on EITHER — the relationship dies
// with the account. world_boss_weeks.totalDamage is intentionally untouched:
// the shared raid's history keeps its total after the attacker rows vanish.
import { eq, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import {
  activityTable, allyNudgesTable, brainCheckinsTable, coinTransactionsTable,
  dopamineRewardsTable, focusSessionsTable, habitStreaksTable, initiationAwardsTable,
  kingdomPointsTable, partnershipsTable, pushSubscriptionsTable, questlinesTable,
  recurringTasksTable, reflectionsTable, rescueEventsTable, rewardStoreItemsTable,
  taskStepsTable, tasksTable, userBadgesTable, userGearTable, weeklyBattlesTable,
  weeklyRecapsTable, worldBossAttacksTable,
} from "@workspace/db";

export interface UserDataTable {
  name: string;               // export key + log name
  table: PgTable;
  userColumns: AnyPgColumn[]; // one per user-FK column on the table
}

export const USER_DATA_TABLES: readonly UserDataTable[] = [
  // Children that reference tasks/questlines/etc. come before their parents.
  { name: "task_steps",         table: taskStepsTable,        userColumns: [taskStepsTable.userId] },
  { name: "focus_sessions",     table: focusSessionsTable,    userColumns: [focusSessionsTable.userId] },
  { name: "rescue_events",      table: rescueEventsTable,     userColumns: [rescueEventsTable.userId] },
  { name: "tasks",              table: tasksTable,            userColumns: [tasksTable.userId] },
  { name: "recurring_tasks",    table: recurringTasksTable,   userColumns: [recurringTasksTable.userId] },
  { name: "questlines",         table: questlinesTable,       userColumns: [questlinesTable.userId] },
  { name: "activity",           table: activityTable,         userColumns: [activityTable.userId] },
  { name: "brain_checkins",     table: brainCheckinsTable,    userColumns: [brainCheckinsTable.userId] },
  { name: "reflections",        table: reflectionsTable,      userColumns: [reflectionsTable.userId] },
  { name: "weekly_recaps",      table: weeklyRecapsTable,     userColumns: [weeklyRecapsTable.userId] },
  { name: "initiation_awards",  table: initiationAwardsTable, userColumns: [initiationAwardsTable.userId] },
  { name: "habit_streaks",      table: habitStreaksTable,     userColumns: [habitStreaksTable.userId] },
  { name: "kingdom_points",     table: kingdomPointsTable,    userColumns: [kingdomPointsTable.userId] },
  { name: "coin_transactions",  table: coinTransactionsTable, userColumns: [coinTransactionsTable.userId] },
  { name: "dopamine_rewards",   table: dopamineRewardsTable,  userColumns: [dopamineRewardsTable.userId] },
  { name: "reward_store_items", table: rewardStoreItemsTable, userColumns: [rewardStoreItemsTable.userId] },
  { name: "user_badges",        table: userBadgesTable,       userColumns: [userBadgesTable.userId] },
  { name: "user_gear",          table: userGearTable,         userColumns: [userGearTable.userId] },
  { name: "weekly_battles",     table: weeklyBattlesTable,    userColumns: [weeklyBattlesTable.userId] },
  { name: "world_boss_attacks", table: worldBossAttacksTable, userColumns: [worldBossAttacksTable.userId] },
  { name: "push_subscriptions", table: pushSubscriptionsTable,userColumns: [pushSubscriptionsTable.userId] },
  { name: "ally_nudges",        table: allyNudgesTable,       userColumns: [allyNudgesTable.senderId, allyNudgesTable.recipientId] },
  { name: "partnerships",       table: partnershipsTable,     userColumns: [partnershipsTable.requesterId, partnershipsTable.recipientId] },
] as const;

/** WHERE matching this user on ANY of the table's user columns. */
export function userWhere(t: UserDataTable, userId: number): SQL {
  const conds = t.userColumns.map((c) => eq(c, userId));
  return conds.length === 1 ? conds[0]! : or(...conds)!;
}
```

(Adjust the exact exported table names to what `@workspace/db` exports — check `lib/db/src/schema/index.ts`/each schema file at implementation time; e.g. the badges user table and gear user table names. Every import must be real.)

- [ ] **Step 2: Write the failing schema-walk guard**

Create `artifacts/api-server/src/lib/account-data.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import * as schema from "@workspace/db";
import { USER_DATA_TABLES } from "./account-data";

// Walk every drizzle table exported by @workspace/db and collect the
// (tableName, columnName) pairs whose FK targets users.id. sessions is
// excluded: it has no FK (userId lives inside the jsonb) and account
// deletion handles it explicitly.
function userFkPairs(): Set<string> {
  const pairs = new Set<string>();
  for (const exported of Object.values(schema)) {
    let cfg;
    try {
      cfg = getTableConfig(exported as PgTable);
    } catch {
      continue; // not a table export
    }
    if (cfg.name === "users") continue;
    for (const fk of cfg.foreignKeys) {
      const ref = fk.reference();
      const targetCfg = getTableConfig(ref.foreignTable as PgTable);
      if (targetCfg.name !== "users") continue;
      for (const col of ref.columns) pairs.add(`${cfg.name}.${col.name}`);
    }
  }
  return pairs;
}

function registryPairs(): Set<string> {
  const pairs = new Set<string>();
  for (const t of USER_DATA_TABLES) {
    const cfg = getTableConfig(t.table as PgTable);
    for (const c of t.userColumns) pairs.add(`${cfg.name}.${c.name}`);
  }
  return pairs;
}

describe("USER_DATA_TABLES registry (standing guard)", () => {
  it("covers every schema column that references users.id — add new user tables here AND to delete/export", () => {
    const missing = [...userFkPairs()].filter((p) => !registryPairs().has(p));
    expect(missing).toEqual([]);
  });

  it("contains no stale entries that the schema no longer backs", () => {
    const stale = [...registryPairs()].filter((p) => !userFkPairs().has(p));
    expect(stale).toEqual([]);
  });

  it("names are unique export keys", () => {
    const names = USER_DATA_TABLES.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
```

- [ ] **Step 3: Run — expect the guard to expose any table the registry draft missed**

Run: `pnpm -C artifacts/api-server test src/lib/account-data.test.ts`
Expected: either PASS (registry complete) or a FAIL listing exact missing `table.column` pairs — fix the registry until green. This red→green loop IS the acceptance's "test walks the schema".

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/lib/account-data.ts artifacts/api-server/src/lib/account-data.test.ts
git commit -m "feat(api): USER_DATA_TABLES registry + schema-walking completeness guard"
```

### Task 5: `GET /me/export` + `DELETE /me` + OpenAPI

**Files:**
- Create: `artifacts/api-server/src/routes/account.ts`
- Modify: `artifacts/api-server/src/routes/index.ts` (import + `router.use(accountRouter)` after `usersRouter`)
- Modify: `lib/api-spec/openapi.yaml`
- Regenerate clients via codegen

**Interfaces:**
- Consumes: `USER_DATA_TABLES`, `userWhere` (Task 4); `sessionsTable`, `usersTable`, `db` from `@workspace/db`; `clearSession`, `getSessionId` from `../lib/auth`.
- Produces: `GET /me/export` → attachment JSON `{ exportedAt, user, data: { [name]: rows[] } }`; `DELETE /me` body `{ confirm: "delete my account" }` → `{ success: true }`, session destroyed. Generated `useDeleteMe` hook for the web.

- [ ] **Step 1: Implement the route**

Create `artifacts/api-server/src/routes/account.ts`:

```ts
import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, usersTable, sessionsTable } from "@workspace/db";
import { USER_DATA_TABLES, userWhere } from "../lib/account-data";
import { clearSession, getSessionId } from "../lib/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

export const DELETE_CONFIRM_PHRASE = "delete my account";

// One honest JSON of everything user-keyed. Sessions are transport state,
// not user data — deleted on account deletion, never exported.
router.get("/me/export", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  const entries = await Promise.all(
    USER_DATA_TABLES.map(async (t) => {
      const rows = await db.select().from(t.table as never).where(userWhere(t, userId));
      return [t.name, rows] as const;
    }),
  );

  const stamp = new Date().toISOString();
  res.setHeader("Content-Disposition", `attachment; filename="focusquest-export-${stamp.slice(0, 10)}.json"`);
  res.json({ exportedAt: stamp, user, data: Object.fromEntries(entries) });
});

// Cascading, transactional, unrecoverable-by-design. The confirm phrase is
// re-checked server-side so nothing but a deliberate client call can land here.
router.delete("/me", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  if (req.body?.confirm !== DELETE_CONFIRM_PHRASE) {
    res.status(400).json({ error: `Body must include confirm: "${DELETE_CONFIRM_PHRASE}"` });
    return;
  }

  await db.transaction(async (tx) => {
    for (const t of USER_DATA_TABLES) {
      await tx.delete(t.table as never).where(userWhere(t, userId));
    }
    // Sessions carry gameUserId inside the jsonb — every device logs out.
    await tx.delete(sessionsTable)
      .where(sql`(${sessionsTable.sess} ->> 'gameUserId')::int = ${userId}`);
    await tx.delete(usersTable).where(eq(usersTable.id, userId));
  });

  await clearSession(res, getSessionId(req));
  logger.info({ userId }, "Account deleted");
  res.json({ success: true });
});

export default router;
```

Register in `routes/index.ts`: `import accountRouter from "./account";` and `router.use(accountRouter);` directly after `usersRouter`.

Type note: `t.table as never` sidesteps drizzle's generic variance on heterogenous table lists; if `PgTable` unifies cleanly without it at implementation time, drop the casts.

- [ ] **Step 2: OpenAPI**

After the `/me` paths (find the existing `/me`-prefixed block; if none, place after `/users/search`), add:

```yaml
  /me/export:
    get:
      operationId: getMyExport
      tags: [users]
      summary: Download everything user-keyed as one JSON file
      responses:
        "200":
          description: Attachment JSON of the user's rows across all user-keyed tables
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/AccountExport"

  /me:
    delete:
      operationId: deleteMe
      tags: [users]
      summary: Permanently delete the account and every user-keyed row
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [confirm]
              properties:
                confirm:
                  type: string
      responses:
        "200":
          description: Account deleted; session destroyed
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SuccessEnvelope"
```

(If a `/me:` path key already exists with a `get:`, add the `delete:` under the same key instead of a new block.) Schema after `SuccessEnvelope`:

```yaml
    AccountExport:
      type: object
      required: [exportedAt, user, data]
      properties:
        exportedAt:
          type: string
        user:
          type: object
          additionalProperties: true
        data:
          type: object
          additionalProperties:
            type: array
            items:
              type: object
              additionalProperties: true
```

- [ ] **Step 3: Codegen + typecheck + suite**

Run: `pnpm -C lib/api-spec codegen && pnpm -C artifacts/api-server typecheck && pnpm -C artifacts/api-server test`
Expected: PASS; `grep -n "useDeleteMe" lib/api-client-react/src/generated/api.ts` finds the hook.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/account.ts artifacts/api-server/src/routes/index.ts lib/api-spec/openapi.yaml lib/api-client-react lib/api-zod
git commit -m "feat(api): account export + transactional account deletion"
```

### Task 6: Danger-zone UI (Account dialog off the header)

**Files:**
- Create: `artifacts/focusquest/src/lib/account.ts` + `account.test.ts`
- Create: `artifacts/focusquest/src/components/account-dialog.tsx`
- Modify: `artifacts/focusquest/src/components/layout.tsx` (render `<AccountDialog />` beside `<NotificationBell />` in BOTH header spots — desktop and mobile)

**Interfaces:**
- Consumes: `useDeleteMe` (Task 5 codegen), shadcn `Dialog`/`Button`/`Input`, `confirmPhraseOk`.
- Produces: header button (Settings icon, aria-label "Account settings") → dialog with Export + Danger zone.

- [ ] **Step 1: Failing tests for the pure helper**

`artifacts/focusquest/src/lib/account.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { confirmPhraseOk, DELETE_PHRASE } from "./account";

describe("confirmPhraseOk", () => {
  it("accepts the exact phrase", () => {
    expect(confirmPhraseOk("delete my account")).toBe(true);
  });
  it("forgives case and surrounding whitespace — the phrase is a speed bump, not a typing test", () => {
    expect(confirmPhraseOk("  Delete My Account ")).toBe(true);
  });
  it("rejects anything else", () => {
    expect(confirmPhraseOk("")).toBe(false);
    expect(confirmPhraseOk("delete")).toBe(false);
    expect(confirmPhraseOk("delete my acount")).toBe(false);
  });
  it("exports the canonical phrase the server expects", () => {
    expect(DELETE_PHRASE).toBe("delete my account");
  });
});
```

`artifacts/focusquest/src/lib/account.ts`:

```ts
export const DELETE_PHRASE = "delete my account";

/** Case/whitespace-forgiving match — deliberate friction without being a
 * typing test (anti-shame: the phrase slows you down, it doesn't punish you). */
export function confirmPhraseOk(input: string): boolean {
  return input.trim().toLowerCase() === DELETE_PHRASE;
}
```

Run RED then GREEN: `pnpm -C artifacts/focusquest test src/lib/account.test.ts`.

- [ ] **Step 2: The dialog**

Create `artifacts/focusquest/src/components/account-dialog.tsx`:

```tsx
import { useState } from "react";
import { Settings, Download, ShieldAlert } from "lucide-react";
import { useDeleteMe } from "@workspace/api-client-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { confirmPhraseOk, DELETE_PHRASE } from "@/lib/account";

/** Account settings + Danger zone (Act VII q7). Plain copy, no dark patterns:
 * export is one tap, deletion is honest about being unrecoverable and takes a
 * typed phrase — friction, not guilt. */
export function AccountDialog() {
  const { toast } = useToast();
  const del = useDeleteMe();
  const [phrase, setPhrase] = useState("");

  async function onDelete() {
    try {
      await del.mutateAsync({ data: { confirm: DELETE_PHRASE } });
      // Session is gone server-side; a hard navigation lands on the login screen.
      window.location.href = "/";
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      toast({ title: "Couldn't delete the account", description: msg, variant: "destructive" });
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Account settings" className="text-muted-foreground">
          <Settings className="w-5 h-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Your account</DialogTitle>
          <DialogDescription>Your data belongs to you — take it or erase it.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Download className="w-4 h-4" /> Export your data
          </div>
          <p className="text-xs text-muted-foreground">
            One JSON file with everything: quests, check-ins, reflections, coins, hero, history.
          </p>
          <Button asChild variant="outline" size="sm">
            <a href="/api/me/export" download>Download export</a>
          </Button>
        </div>

        <div className="space-y-2 border border-destructive/40 rounded-lg p-3 mt-2">
          <div className="text-sm font-semibold text-destructive flex items-center gap-2">
            <ShieldAlert className="w-4 h-4" /> Danger zone
          </div>
          <p className="text-xs text-muted-foreground">
            Deleting your account erases everything above, on every device, permanently.
            There is no recovery. Export first if you want a copy.
          </p>
          <Input
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder={`Type "${DELETE_PHRASE}" to enable`}
            aria-label="Deletion confirmation phrase"
          />
          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            disabled={!confirmPhraseOk(phrase) || del.isPending}
            onClick={onDelete}
          >
            {del.isPending ? "Deleting…" : "Delete my account"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

In `layout.tsx`: `import { AccountDialog } from "./account-dialog";` and render `<AccountDialog />` immediately before `<NotificationBell />` at BOTH render sites (lines ~212 and ~254). Note the app calls the API same-origin (`/api/...`), matching the existing `<form method="POST" action="/api/logout">` pattern — the plain `<a href="/api/me/export">` rides the session cookie the same way. Verify the generated `useDeleteMe` mutation arg shape (`{ data: { confirm } }`) against the generated client and adjust.

- [ ] **Step 3: Web suite + typecheck**

Run: `pnpm -C artifacts/focusquest test && pnpm -C artifacts/focusquest typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add artifacts/focusquest/src/lib/account.ts artifacts/focusquest/src/lib/account.test.ts artifacts/focusquest/src/components/account-dialog.tsx artifacts/focusquest/src/components/layout.tsx
git commit -m "feat(web): account dialog — export + confirm-phrase deletion"
```

### Task 7: Ops doc + full verification

**Files:**
- Create: `docs/ops/steady-ground.md`

- [ ] **Step 1: Write the ops doc**

```markdown
# Steady Ground — ops runbook (Act VII q7)

## Backup cron (GitHub Actions)
- Workflow: `.github/workflows/backup-cron.yml` — POSTs `/api/cron/tick` every 5 min.
- One-time setup after merge: `gh secret set CRON_SECRET` (same value as Render's
  env var / cron-job.org), then run the workflow once from the Actions tab
  (workflow_dispatch) and confirm `http=200`.
- Failure drill (optional): pause the cron-job.org job for 15 minutes — pushes
  keep flowing on the 5-min backup cadence; re-enable afterwards.

## Dead-man's switch (healthchecks.io, free tier)
- Create one check at https://healthchecks.io — period 10 min, grace 5 min.
- Set `HEARTBEAT_URL` on the Render service to the check's ping URL. Unset = no-op.
- The tick pings AFTER all passes complete, so an alert means "no full tick
  finished in 15 minutes" across BOTH schedulers.

## Account deletion — Auth0 side
`DELETE /api/me` erases every FocusQuest row and session. The Auth0 identity
(login credential) is separate and free-tier cleanup is manual:
Auth0 dashboard → User Management → Users → ⋯ → Delete. Until then the person
can log in again, which creates a FRESH empty FocusQuest account (no data links
back — the old rows are gone). Document sent to the user on request.
```

- [ ] **Step 2: Full verification sweep**

Run: `pnpm -C artifacts/api-server test && pnpm -C artifacts/focusquest test && pnpm typecheck && pnpm -C scripts typecheck`
Expected: all green.

Behavioral checks (built server + curl):
- `POST /api/cron/tick` without auth → 401; with `Bearer $CRON_SECRET` → `{ok:true,...}` and (HEARTBEAT_URL unset) no ping attempted.
- `GET /api/me/export` unauthed → 401. `DELETE /api/me` unauthed → 401.
- Browser: app boots; header shows the Account (gear) button next to the bell on the login-gated shell if visible pre-auth — otherwise verified in code + Chad's walkthrough.

**Deliberately NOT verified by the session:** an authed end-to-end delete against live Neon (destructive on real data — the guard test + transaction shape carry it; Chad may exercise it with a throwaway account), and the live backup-cron run (needs the merged workflow + repo secret).

- [ ] **Step 3: Commit**

```bash
git add docs/ops/steady-ground.md
git commit -m "docs(ops): steady-ground runbook — backup cron, heartbeat, Auth0 cleanup"
```

---

## Post-plan workflow (session, not plan tasks)

PR `feat/steady-ground` → multi-angle review pass → merge → `gh secret set CRON_SECRET` + `workflow_dispatch` proof run (if permitted; else Chad) → map artifact 34/38 = **Act VII complete** + memory refresh. Chad's items: healthchecks.io check + `HEARTBEAT_URL` on Render; optional failure drill; optional throwaway-account delete test.

## Self-Review

- **Spec coverage:** backup scheduler ✓ (T3), dead-man switch ✓ (T2, env-gated no-op ✓), account deletion one-tx cascade + session destroyed + Auth0 documented ✓ (T5+T7), export single honest JSON ✓ (T5), danger zone plain copy + confirm phrase ✓ (T6), "test walks the schema" ✓ (T4 guard), mandated envelope-counter fix ✓ (T1, first). Acceptance "backup within 5 min" carried by workflow cadence + runbook drill; "alert fires on gap" carried by healthchecks config (documented — external service, Chad provisions).
- **Placeholder scan:** clean; the two implementation-time checks (exact `@workspace/db` export names in T4, `useDeleteMe` arg shape in T6) name exactly what to verify and where.
- **Type consistency:** `UserDataTable`/`userWhere` shapes match between T4 and T5; `DELETE_PHRASE` client constant equals the server's `DELETE_CONFIRM_PHRASE` string and T6's test pins it; heartbeat's `pingHeartbeat(fetchFn?)` matches T2 tests.
