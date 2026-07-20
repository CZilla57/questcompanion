# Never Lose a Thought Implementation Plan (Act VII quest 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A capture typed or spoken into FocusQuest is never lost: offline opens render the app shell (not a login-screen dead end), failed quick-adds persist to an IndexedDB outbox and replay in order on reconnect, and a client-generated key makes every replay exactly-once server-side.

**Architecture:** Four independent seams. (1) Server: `tasks.client_key` + a partial unique index; `POST /api/tasks` returns the existing row (200) on a key match. (2) A pure outbox core (`entry` construction, replay decision table) + a raw-IndexedDB adapter + a sequential drain orchestrator — all app-layer; the SW never touches POSTs. (3) A hand-rolled SW precache: a build script injects the hashed-asset manifest into `public/sw.js`; navigations go network-first with cached-shell fallback; `/api/*` is never intercepted. (4) Offline-aware gates: `useAuth` exposes *unreachable* vs *denied*, and last-known-good flags in localStorage let the authed shell render offline.

**Tech Stack:** Express + drizzle (`@workspace/db`), openapi → orval (`@workspace/api-client-react` — its generated `createTask(input, options?: RequestInit)` passes options into `customFetch`, which is how the capture path gets a timeout signal without bespoke fetch code), React 18 + wouter + TanStack Query v5, raw IndexedDB (no new dependency), vitest node-env pure-lib tests in both packages.

**Spec:** `docs/superpowers/specs/2026-07-20-never-lose-a-thought-design.md` (approved 2026-07-20, PR #72). Line anchors refer to main @ `1c71de8`.

## Global Constraints

- **No new dependencies** — runtime or dev. Raw IndexedDB (~80 lines), no `workbox`/`idb`/`fake-indexeddb`; the IDB adapter stays thin and the coverage lives on the pure core + in-memory fake.
- **Never hand-edit `*/src/generated`.** API changes: edit `lib/api-spec/openapi.yaml` → `pnpm --filter @workspace/api-spec codegen`.
- **The SW never intercepts non-GET requests or anything under `/api/`** (including `/api/login` navigations). Offline mutation queueing is capture-create only — no other mutation may be enqueued.
- **Outbox invariant: `entry.id` IS the server `clientKey`** (one UUID minted per capture at submit time, reused across timeout-retry and replay — that identity is what makes "landed but timed out" safe).
- **Drain is sequential oldest-first; retryable failures stop the drain** (order preserved); only terminal 4xx parks an entry and continues. Parked entries are never auto-dropped.
- **Anti-shame copy, verbatim** (spec): banner "You're offline — captures are saved and will sync." · text capture "Saved — will sync when you're back online ✓" · voice capture "Voice note saved — I'll transcribe it when you're back online" · empty transcript "Couldn't hear anything in this note" · non-persistent fallback "Can't save to this browser — keep the app open until you're back online." · sync toast "Synced N quest(s) ✓" · auth stop "Log in to sync your saved quests". Offline is weather, never an error state.
- **Migrations:** `pnpm --filter @workspace/db generate` (placeholder `DATABASE_URL` ok, always pass `--name`) → review SQL → `pnpm --filter @workspace/db migrate` against Neon (export `DATABASE_URL` from `.env` first — config does not load `.env`; strip `\r`). `drizzle-kit push` is REMOVED — never reintroduce it.
- **Tests:** `pnpm --filter @workspace/api-server test`, `pnpm --filter @workspace/focusquest test` (single file: `... test -- <name>`). Typecheck: `pnpm typecheck` (root). Both suites + typecheck green at the end of every task.
- Branch: `feat/never-lose-a-thought` (Task 0). Commit at the end of every task; run `git branch --show-current` before each commit — concurrent sessions share this working tree.
- The precache build script assumes the deployed `BASE_PATH=/` (what the Dockerfile sets); it does not need to handle other bases.

---

### Task 0: Branch

- [ ] **Step 1:** PR #72 (spec + this plan, branch `spec/never-lose-a-thought`) must be merged first. Then:

```bash
git switch main && git pull && git switch -c feat/never-lose-a-thought && git status --short
```

Expected: empty status; `git log --oneline -1` shows the PR #72 merge (or later).

---

### Task 1: Server idempotency — `client_key` column, partial unique index, 200-on-replay

**Files:**
- Modify: `lib/db/src/schema/tasks.ts:1,25-73`
- Create: `lib/db/drizzle/0002_never_lose_a_thought.sql` (generated — never hand-written)
- Create: `artifacts/api-server/src/lib/client-key.ts`
- Test: `artifacts/api-server/src/lib/client-key.test.ts`
- Test: `artifacts/api-server/src/lib/client-key-guard.test.ts`
- Modify: `artifacts/api-server/src/routes/tasks.ts:187-240` (POST /tasks)
- Modify: `lib/api-spec/openapi.yaml:2593-2632` (`TaskInput` schema) + run codegen

**Interfaces:**
- Produces (used by Tasks 4, 5, 8):
  - `POST /api/tasks` accepts optional `clientKey: string` (8–64 chars). Fresh create → **201**. Same `(userId, clientKey)` again → **200** with the *existing* task, no second row. Invalid key → 400.
  - `isValidClientKey(value: unknown): value is string` in `lib/client-key.ts`.
  - Generated `TaskInput` type gains `clientKey?: string` (via codegen).

- [ ] **Step 1: Write the failing validation test** — create `artifacts/api-server/src/lib/client-key.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isValidClientKey, CLIENT_KEY_MIN, CLIENT_KEY_MAX } from "./client-key";

describe("isValidClientKey (Never Lose a Thought: capture idempotency)", () => {
  it("accepts a crypto.randomUUID()-shaped key", () => {
    expect(isValidClientKey("9b2f4a1e-6c3d-4e5f-8a7b-0c1d2e3f4a5b")).toBe(true);
  });
  it("accepts the 8/64 length bounds inclusive", () => {
    expect(isValidClientKey("a".repeat(CLIENT_KEY_MIN))).toBe(true);
    expect(isValidClientKey("a".repeat(CLIENT_KEY_MAX))).toBe(true);
  });
  it("rejects too-short, too-long, and non-strings", () => {
    expect(isValidClientKey("a".repeat(CLIENT_KEY_MIN - 1))).toBe(false);
    expect(isValidClientKey("a".repeat(CLIENT_KEY_MAX + 1))).toBe(false);
    expect(isValidClientKey(42)).toBe(false);
    expect(isValidClientKey(null)).toBe(false);
    expect(isValidClientKey(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server test -- client-key`
Expected: FAIL — `./client-key` module not found.

- [ ] **Step 3: Implement** — create `artifacts/api-server/src/lib/client-key.ts`:

```ts
// Capture idempotency (Never Lose a Thought): the client mints one UUID per
// capture and reuses it across timeout-retries and offline replays. Bounds are
// defensive — the web client always sends crypto.randomUUID() (36 chars).
export const CLIENT_KEY_MIN = 8;
export const CLIENT_KEY_MAX = 64;

export function isValidClientKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= CLIENT_KEY_MIN &&
    value.length <= CLIENT_KEY_MAX
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server test -- client-key`
Expected: PASS (3 tests).

- [ ] **Step 5: Schema column + partial unique index.** In `lib/db/src/schema/tasks.ts`, change line 1 to add `uniqueIndex` and add a `sql` import:

```ts
import { pgTable, serial, text, integer, boolean, timestamp, date, unique, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
```

Add the column after `createdAt` (line 67), inside the column object:

```ts
  // Offline-capture idempotency (Never Lose a Thought): client-minted UUID.
  // Replays of the same capture match the partial unique index below and the
  // route returns the existing row instead of inserting a duplicate.
  clientKey: text("client_key"),
```

Extend the table's third argument (currently the single `unique(...)` entry, lines 68–73):

```ts
}, (table) => [
  // Prevents duplicate recurring-task rows for the same user/template/day across concurrent
  // scheduler instances.  PostgreSQL treats NULLs as distinct so regular (non-recurring)
  // tasks on the same date are unaffected by this constraint.
  unique("tasks_recurring_unique_idx").on(table.userId, table.recurringTaskId, table.dueDate),
  // Partial: only capture-keyed rows participate — every legacy/serverside insert
  // (clientKey null) is untouched by the uniqueness rule.
  uniqueIndex("tasks_user_client_key_unique")
    .on(table.userId, table.clientKey)
    .where(sql`${table.clientKey} IS NOT NULL`),
]);
```

- [ ] **Step 6: Generate the migration** (placeholder URL is fine for generate; always name it):

```bash
DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" pnpm --filter @workspace/db generate --name never_lose_a_thought
```

Expected: `lib/db/drizzle/0002_never_lose_a_thought.sql` containing an
`ALTER TABLE "tasks" ADD COLUMN "client_key" text;` and a
`CREATE UNIQUE INDEX "tasks_user_client_key_unique" ON "tasks" ... ("user_id","client_key") WHERE "client_key" IS NOT NULL` (drizzle may quote/order clauses slightly differently — the column pair and the `WHERE ... IS NOT NULL` are the load-bearing parts). Review it; commit SQL **and** the updated `lib/db/drizzle/meta/` together (Step 12).

- [ ] **Step 7: Write the failing schema-guard test** — create `artifacts/api-server/src/lib/client-key-guard.test.ts` (standing-guard style: the exactly-once claim rests on this index existing in migration history):

```ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// The exactly-once replay guarantee is the partial unique index, not app code.
// This guard fails if a future squash/rewrite of migrations drops it.
const drizzleDir = fileURLToPath(new URL("../../../../lib/db/drizzle", import.meta.url));

describe("capture idempotency schema guard (Never Lose a Thought)", () => {
  it("migration history creates the partial unique index on (user_id, client_key)", () => {
    const allSql = readdirSync(drizzleDir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(path.join(drizzleDir, f), "utf8"))
      .join("\n");
    const idx = /CREATE UNIQUE INDEX (?:IF NOT EXISTS )?"tasks_user_client_key_unique" ON "tasks"[^;]*"user_id"[^;]*"client_key"[^;]*WHERE[^;]*client_key[^;]*IS NOT NULL/s;
    expect(allSql).toMatch(idx);
  });
});
```

Run: `pnpm --filter @workspace/api-server test -- client-key-guard` — Expected: PASS already (migration exists from Step 6). If it FAILS, the generated SQL diverged from expectation — read `0002_never_lose_a_thought.sql`, adjust the regex only if the real SQL is semantically identical (same columns, same partial predicate), otherwise fix the schema.

- [ ] **Step 8: Route change.** In `artifacts/api-server/src/routes/tasks.ts`, POST `/tasks` (line 187). Add the import at the top of the file alongside the other `../lib/` imports:

```ts
import { isValidClientKey } from "../lib/client-key";
```

Extend the destructure (lines 191–201) with `clientKey`:

```ts
  const { title, description, dueDate, dueTime, priority = "medium", estimatedMinutes, category, isAnchored, questlineId, clientKey } = req.body as {
    title?: string;
    description?: string;
    dueDate?: string;
    dueTime?: string;
    priority?: string;
    estimatedMinutes?: number;
    category?: string;
    isAnchored?: boolean;
    questlineId?: number | null;
    clientKey?: string;
  };
```

After the `dueTime` validation block (line 216), add:

```ts
  if (clientKey !== undefined && !isValidClientKey(clientKey)) {
    res.status(400).json({ error: "clientKey must be a string of 8-64 characters" });
    return;
  }
```

Replace the insert + response (lines 225–239) with:

```ts
  // onConflictDoNothing can only ever match the (user_id, client_key) partial
  // index here: this route never sets recurringTaskId, so the recurring unique
  // constraint (which treats its NULL as distinct) cannot fire.
  const [task] = await db.insert(tasksTable).values({
    userId,
    title,
    description,
    points: autoPoint.points,
    dueDate: anchored ? null : dueDate,
    dueTime: anchored ? null : (dueTime ?? null),
    priority,
    category: resolvedCategory,
    estimatedMinutes: estimatedMinutes ?? null,
    isAnchored: anchored,
    questlineId: qlResult.value,
    clientKey: clientKey ?? null,
  }).onConflictDoNothing().returning();

  if (!task) {
    // A replay of a capture we already have: hand back the existing quest.
    // 200 (not 201) so the client can tell "created" from "already had it".
    if (!clientKey) { res.status(500).json({ error: "Task insert failed" }); return; }
    const [existing] = await db.select().from(tasksTable)
      .where(and(eq(tasksTable.userId, userId), eq(tasksTable.clientKey, clientKey)));
    if (!existing) { res.status(500).json({ error: "Task insert failed" }); return; }
    const existingSteps = await db.select().from(taskStepsTable)
      .where(eq(taskStepsTable.taskId, existing.id))
      .orderBy(taskStepsTable.position);
    res.status(200).json(formatTask(existing, existingSteps));
    return;
  }

  res.status(201).json(formatTask(task));
```

(`and`, `eq`, `taskStepsTable`, `formatTask` are already imported/used in this file — see lines 353–359.)

- [ ] **Step 9: openapi + codegen.** In `lib/api-spec/openapi.yaml`, inside `TaskInput.properties` (after `questlineId`, line ~2632), add:

```yaml
        clientKey:
          type: string
          minLength: 8
          maxLength: 64
          description: >-
            Client-generated idempotency key (a UUID). Two creates with the
            same key for the same user return the same task - the second
            responds 200 with the existing quest instead of creating a
            duplicate. Sent on every quick-add capture; offline replays reuse
            the capture's key.
```

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: clean exit; `lib/api-client-react/src/generated/api.schemas.ts` `TaskInput` now has `clientKey?: string`. Do not hand-edit anything under `generated/`.

- [ ] **Step 10: Full gates**

Run: `pnpm --filter @workspace/api-server test` then `pnpm typecheck`
Expected: all PASS / clean.

- [ ] **Step 11: Apply the migration to Neon** (repo convention: apply it yourself; no other branch has live-but-unmerged schema right now — Honest Coin shipped zero migrations):

```bash
export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '\r')"
pnpm --filter @workspace/db migrate
```

Expected: `✓ migrations up to date`. (Deploys also run migrations automatically before boot, so the deploy is self-healing regardless.)

- [ ] **Step 12: Commit**

```bash
git branch --show-current   # must print feat/never-lose-a-thought
git add lib/db/src/schema/tasks.ts lib/db/drizzle artifacts/api-server/src/lib/client-key.ts artifacts/api-server/src/lib/client-key.test.ts artifacts/api-server/src/lib/client-key-guard.test.ts artifacts/api-server/src/routes/tasks.ts lib/api-spec/openapi.yaml lib/api-client-react/src/generated lib/api-zod/src/generated
git commit -m "feat(api): idempotent task capture — client_key + partial unique index, 200 on replay"
```

---

### Task 2: Outbox pure core — entries, ids, replay decision table

**Files:**
- Create: `artifacts/focusquest/src/lib/net-errors.ts`
- Test: `artifacts/focusquest/src/lib/net-errors.test.ts`
- Create: `artifacts/focusquest/src/lib/outbox/core.ts`
- Test: `artifacts/focusquest/src/lib/outbox/core.test.ts`

**Interfaces:**
- Consumes: generated `TaskInput` (Task 1 codegen) from `@workspace/api-client-react`.
- Produces (used by Tasks 3, 4, 5, 8):

```ts
// net-errors.ts
export function isNetworkError(err: unknown): boolean;

// outbox/core.ts
export type TextPayload = { kind: "text"; input: TaskInput & { clientKey: string } };
export type VoicePayload = { kind: "voice"; blob: Blob; durationMs: number; questlineId?: number };
export type OutboxStatus = "queued" | "syncing" | "failed";
export type OutboxEntry = {
  id: string;            // === the server clientKey
  createdAt: string;     // ISO instant of capture
  captureDate: string;   // YYYY-MM-DD, device-local at capture
  tz: string;            // IANA, informational
  status: OutboxStatus;
  attempts: number;
  lastError?: string;
  payload: TextPayload | VoicePayload;
};
export function newCaptureId(): string;
export function localDateString(d: Date): string;
export function makeTextEntry(input: TaskInput & { clientKey: string }, opts?: { now?: Date; tz?: string }): OutboxEntry;
export function makeVoiceEntry(blob: Blob, durationMs: number, opts?: { questlineId?: number; now?: Date; tz?: string }): OutboxEntry;
export type ReplayFailureDecision =
  | { action: "stop"; authNeeded?: boolean }
  | { action: "park"; message: string }
  | { action: "retry-without-questline" };
export function decideReplayFailure(err: unknown): ReplayFailureDecision;
export function entryLabel(e: OutboxEntry): string;
export const EMPTY_TRANSCRIPT_MESSAGE = "Couldn't hear anything in this note";
```

- [ ] **Step 1: Write the failing tests.** Create `artifacts/focusquest/src/lib/net-errors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isNetworkError } from "./net-errors";

describe("isNetworkError", () => {
  it("true for fetch's TypeError (no HTTP answer)", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
  });
  it("true for an abort (our capture timeout)", () => {
    const abort = Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
    expect(isNetworkError(abort)).toBe(true);
  });
  it("false for server answers (anything carrying an HTTP status)", () => {
    expect(isNetworkError(Object.assign(new Error("HTTP 500"), { status: 500 }))).toBe(false);
    expect(isNetworkError(Object.assign(new Error("HTTP 401"), { status: 401 }))).toBe(false);
  });
  it("false for null/undefined/random objects", () => {
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
    expect(isNetworkError({})).toBe(false);
  });
});
```

Create `artifacts/focusquest/src/lib/outbox/core.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  newCaptureId, localDateString, makeTextEntry, makeVoiceEntry,
  decideReplayFailure, entryLabel, EMPTY_TRANSCRIPT_MESSAGE,
} from "./core";

const NOW = new Date(2026, 6, 20, 23, 45); // Jul 20 2026, 23:45 local

describe("newCaptureId", () => {
  it("mints unique UUID-shaped ids", () => {
    const a = newCaptureId();
    const b = newCaptureId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe("localDateString", () => {
  it("formats the device-local calendar date", () => {
    expect(localDateString(new Date(2026, 6, 20, 23, 45))).toBe("2026-07-20");
    expect(localDateString(new Date(2026, 0, 3, 0, 5))).toBe("2026-01-03");
  });
});

describe("makeTextEntry", () => {
  it("uses the input clientKey as the entry id (id IS the idempotency key)", () => {
    const e = makeTextEntry({ title: "Email Sam", dueDate: "2026-07-20", clientKey: "k".repeat(12) }, { now: NOW, tz: "America/Chicago" });
    expect(e.id).toBe("k".repeat(12));
    expect(e.status).toBe("queued");
    expect(e.attempts).toBe(0);
    expect(e.captureDate).toBe("2026-07-20");
    expect(e.tz).toBe("America/Chicago");
    expect(e.payload.kind).toBe("text");
  });
  it("defaults a missing dueDate to the capture day (never loses the day the thought happened)", () => {
    const e = makeTextEntry({ title: "x", clientKey: "k".repeat(12) }, { now: NOW });
    expect(e.payload.kind === "text" && e.payload.input.dueDate).toBe("2026-07-20");
  });
  it("keeps an explicit dueDate", () => {
    const e = makeTextEntry({ title: "x", dueDate: "2026-08-01", clientKey: "k".repeat(12) }, { now: NOW });
    expect(e.payload.kind === "text" && e.payload.input.dueDate).toBe("2026-08-01");
  });
});

describe("makeVoiceEntry", () => {
  it("preserves the blob (mime intact — iOS records mp4) and mints its own id", () => {
    const blob = new Blob(["x"], { type: "audio/mp4" });
    const e = makeVoiceEntry(blob, 42_000, { questlineId: 7, now: NOW });
    expect(e.payload.kind).toBe("voice");
    if (e.payload.kind === "voice") {
      expect(e.payload.blob.type).toBe("audio/mp4");
      expect(e.payload.durationMs).toBe(42_000);
      expect(e.payload.questlineId).toBe(7);
    }
    expect(e.id).toMatch(/^[0-9a-f]{8}-/);
    expect(e.captureDate).toBe("2026-07-20");
  });
});

describe("decideReplayFailure (the drain policy table)", () => {
  const withStatus = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
  it("network/timeout/unknown → stop (still offline; order preserved)", () => {
    expect(decideReplayFailure(new TypeError("Failed to fetch"))).toEqual({ action: "stop" });
    expect(decideReplayFailure(Object.assign(new Error("x"), { name: "AbortError" }))).toEqual({ action: "stop" });
    expect(decideReplayFailure(new Error("weird"))).toEqual({ action: "stop" });
  });
  it("401 → stop with authNeeded", () => {
    expect(decideReplayFailure(withStatus(401))).toEqual({ action: "stop", authNeeded: true });
  });
  it("429 and 5xx → stop (cooldown / sick server)", () => {
    expect(decideReplayFailure(withStatus(429))).toEqual({ action: "stop" });
    expect(decideReplayFailure(withStatus(500))).toEqual({ action: "stop" });
    expect(decideReplayFailure(withStatus(503))).toEqual({ action: "stop" });
  });
  it("422 → retry once without the questline (capture outranks grouping)", () => {
    expect(decideReplayFailure(withStatus(422))).toEqual({ action: "retry-without-questline" });
  });
  it("other 4xx → park visibly, drain continues", () => {
    expect(decideReplayFailure(withStatus(400))).toEqual({ action: "park", message: "Couldn't sync this one — retry or discard." });
    expect(decideReplayFailure(withStatus(404))).toEqual({ action: "park", message: "Couldn't sync this one — retry or discard." });
  });
});

describe("entryLabel", () => {
  it("text entries label with their title", () => {
    const e = makeTextEntry({ title: "Email Sam", clientKey: "k".repeat(12) }, { now: NOW });
    expect(entryLabel(e)).toBe("Email Sam");
  });
  it("voice entries label with duration m:ss", () => {
    const e = makeVoiceEntry(new Blob(["x"], { type: "audio/webm" }), 42_000, { now: NOW });
    expect(entryLabel(e)).toBe("Voice note · 0:42");
    const long = makeVoiceEntry(new Blob(["x"], { type: "audio/webm" }), 61_000, { now: NOW });
    expect(entryLabel(long)).toBe("Voice note · 1:01");
  });
});

describe("EMPTY_TRANSCRIPT_MESSAGE", () => {
  it("is the anti-shame copy verbatim", () => {
    expect(EMPTY_TRANSCRIPT_MESSAGE).toBe("Couldn't hear anything in this note");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @workspace/focusquest test -- net-errors` and `pnpm --filter @workspace/focusquest test -- outbox/core`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement.** Create `artifacts/focusquest/src/lib/net-errors.ts`:

```ts
// A failure that never got an HTTP answer: fetch's TypeError, or an abort
// (the capture path's 10s timeout). ApiError/ResponseParseError from
// @workspace/api-client-react carry a numeric .status — those are server
// answers and must NOT be treated as dead zones.
export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (typeof err !== "object" || err === null) return false;
  if (typeof (err as { status?: unknown }).status === "number") return false;
  return (err as { name?: unknown }).name === "AbortError";
}
```

Create `artifacts/focusquest/src/lib/outbox/core.ts`:

```ts
import type { TaskInput } from "@workspace/api-client-react";
import { browserTimeZone } from "@/lib/timezone";

export type TextPayload = {
  kind: "text";
  /** The fully resolved create body from QuickAddBar at capture time. */
  input: TaskInput & { clientKey: string };
};

export type VoicePayload = {
  kind: "voice";
  /** Mime preserved via blob.type — iOS records audio/mp4, not webm. */
  blob: Blob;
  durationMs: number;
  questlineId?: number;
};

export type OutboxStatus = "queued" | "syncing" | "failed";

export type OutboxEntry = {
  /** INVARIANT: doubles as the server clientKey — same UUID from first
   * attempt through every replay, which is what makes replays exactly-once. */
  id: string;
  createdAt: string;
  /** YYYY-MM-DD in the device's local tz at capture — replay's dueDate default. */
  captureDate: string;
  tz: string;
  status: OutboxStatus;
  attempts: number;
  lastError?: string;
  payload: TextPayload | VoicePayload;
};

export const EMPTY_TRANSCRIPT_MESSAGE = "Couldn't hear anything in this note";
const PARK_MESSAGE = "Couldn't sync this one — retry or discard.";

export function newCaptureId(): string {
  const c = globalThis.crypto;
  if (c && "randomUUID" in c) return c.randomUUID();
  // Old-WebKit fallback: RFC4122-v4-shaped from getRandomValues.
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function localDateString(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

type EntryOpts = { now?: Date; tz?: string };

function baseEntry(id: string, opts?: EntryOpts) {
  const now = opts?.now ?? new Date();
  return {
    id,
    createdAt: now.toISOString(),
    captureDate: localDateString(now),
    tz: opts?.tz ?? browserTimeZone(),
    status: "queued" as const,
    attempts: 0,
  };
}

export function makeTextEntry(input: TaskInput & { clientKey: string }, opts?: EntryOpts): OutboxEntry {
  const base = baseEntry(input.clientKey, opts);
  return {
    ...base,
    // A capture never loses the day the thought happened.
    payload: { kind: "text", input: { ...input, dueDate: input.dueDate ?? base.captureDate } },
  };
}

export function makeVoiceEntry(
  blob: Blob,
  durationMs: number,
  opts?: EntryOpts & { questlineId?: number },
): OutboxEntry {
  return {
    ...baseEntry(newCaptureId(), opts),
    payload: {
      kind: "voice",
      blob,
      durationMs,
      ...(opts?.questlineId != null ? { questlineId: opts.questlineId } : {}),
    },
  };
}

export type ReplayFailureDecision =
  | { action: "stop"; authNeeded?: boolean }
  | { action: "park"; message: string }
  | { action: "retry-without-questline" };

/** The drain policy table (spec §Part 3). Retryable failures stop the whole
 * drain so order is preserved; only a terminal 4xx parks the entry. */
export function decideReplayFailure(err: unknown): ReplayFailureDecision {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status !== "number") return { action: "stop" };
  if (status === 401) return { action: "stop", authNeeded: true };
  if (status === 429 || status >= 500) return { action: "stop" };
  if (status === 422) return { action: "retry-without-questline" };
  return { action: "park", message: PARK_MESSAGE };
}

export function entryLabel(e: OutboxEntry): string {
  if (e.payload.kind === "text") return e.payload.input.title;
  const s = Math.round(e.payload.durationMs / 1000);
  return `Voice note · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workspace/focusquest test -- net-errors` and `pnpm --filter @workspace/focusquest test -- outbox/core`
Expected: PASS. (Node ≥19 has `crypto.randomUUID` and `Blob` globals; the suite runs in node env.)

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add artifacts/focusquest/src/lib/net-errors.ts artifacts/focusquest/src/lib/net-errors.test.ts artifacts/focusquest/src/lib/outbox/core.ts artifacts/focusquest/src/lib/outbox/core.test.ts
git commit -m "feat(web): outbox pure core — capture entries, id=clientKey invariant, replay decision table"
```

---

### Task 3: Outbox store — interface, in-memory fake, raw-IDB adapter

**Files:**
- Create: `artifacts/focusquest/src/lib/outbox/store.ts`
- Test: `artifacts/focusquest/src/lib/outbox/store.test.ts`

**Interfaces:**
- Consumes: `OutboxEntry` from `./core` (Task 2).
- Produces (used by Tasks 4, 5, 8):

```ts
export interface OutboxStore {
  readonly persistent: boolean;
  add(entry: OutboxEntry): Promise<void>;
  list(): Promise<OutboxEntry[]>;                                   // createdAt asc, ties by id
  update(id: string, patch: Partial<OutboxEntry>): Promise<void>;   // no-op on unknown id
  remove(id: string): Promise<void>;
}
export const outboxChanged: EventTarget;                            // fires Event("change") after any mutation
export function createMemoryStore(): OutboxStore;
export function getOutboxStore(): Promise<OutboxStore>;             // singleton: IDB, falling back to memory
```

- [ ] **Step 1: Write the failing test** — create `artifacts/focusquest/src/lib/outbox/store.test.ts` (contract-tests the memory implementation; the IDB adapter implements the same interface and stays thin):

```ts
import { describe, it, expect, vi } from "vitest";
import { createMemoryStore, outboxChanged } from "./store";
import { makeTextEntry } from "./core";

const entry = (key: string, at: string) =>
  makeTextEntry({ title: key, clientKey: key.padEnd(12, "_") }, { now: new Date(at), tz: "UTC" });

describe("memory OutboxStore (contract for both adapters)", () => {
  it("is honest about persistence", () => {
    expect(createMemoryStore().persistent).toBe(false);
  });

  it("lists in createdAt order regardless of insertion order", async () => {
    const s = createMemoryStore();
    await s.add(entry("second", "2026-07-20T10:00:00Z"));
    await s.add(entry("first", "2026-07-20T09:00:00Z"));
    await s.add(entry("third", "2026-07-20T11:00:00Z"));
    const titles = (await s.list()).map((e) => e.payload.kind === "text" && e.payload.input.title);
    expect(titles).toEqual(["first", "second", "third"]);
  });

  it("update patches in place and ignores unknown ids", async () => {
    const s = createMemoryStore();
    const e = entry("a", "2026-07-20T09:00:00Z");
    await s.add(e);
    await s.update(e.id, { status: "failed", lastError: "nope", attempts: 3 });
    await s.update("missing-id___", { status: "failed" });
    const [got] = await s.list();
    expect(got.status).toBe("failed");
    expect(got.lastError).toBe("nope");
    expect(got.attempts).toBe(3);
  });

  it("remove deletes exactly one entry", async () => {
    const s = createMemoryStore();
    const a = entry("a", "2026-07-20T09:00:00Z");
    const b = entry("b", "2026-07-20T10:00:00Z");
    await s.add(a);
    await s.add(b);
    await s.remove(a.id);
    const left = await s.list();
    expect(left).toHaveLength(1);
    expect(left[0].id).toBe(b.id);
  });

  it("emits a change event on add/update/remove", async () => {
    const s = createMemoryStore();
    const spy = vi.fn();
    outboxChanged.addEventListener("change", spy);
    const e = entry("a", "2026-07-20T09:00:00Z");
    await s.add(e);
    await s.update(e.id, { attempts: 1 });
    await s.remove(e.id);
    outboxChanged.removeEventListener("change", spy);
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/focusquest test -- outbox/store`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `artifacts/focusquest/src/lib/outbox/store.ts`:

```ts
import type { OutboxEntry } from "./core";

export interface OutboxStore {
  /** false = in-memory fallback (private mode / IDB broken): survives the
   * session only, and the capture UI says so honestly. */
  readonly persistent: boolean;
  add(entry: OutboxEntry): Promise<void>;
  list(): Promise<OutboxEntry[]>;
  update(id: string, patch: Partial<OutboxEntry>): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Same-tab change signal for useOutboxEntries. Cross-tab consistency is not
 * chased — the server clientKey dedupes, and drains take a Web Lock. */
export const outboxChanged = new EventTarget();
const emit = () => outboxChanged.dispatchEvent(new Event("change"));

const byCreatedAt = (a: OutboxEntry, b: OutboxEntry) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1;

export function createMemoryStore(): OutboxStore {
  const entries = new Map<string, OutboxEntry>();
  return {
    persistent: false,
    async add(entry) {
      entries.set(entry.id, entry);
      emit();
    },
    async list() {
      return [...entries.values()].sort(byCreatedAt);
    },
    async update(id, patch) {
      const current = entries.get(id);
      if (!current) return;
      entries.set(id, { ...current, ...patch });
      emit();
    },
    async remove(id) {
      entries.delete(id);
      emit();
    },
  };
}

// ── Raw IndexedDB adapter ────────────────────────────────────────────────
// Deliberately dependency-free and thin: all replay/ordering logic lives in
// core.ts/replay.ts against the interface above, which the memory store
// contract-tests. DB "fq-outbox", store "entries", keyPath "id"; Blobs
// persist via structured clone.

const DB_NAME = "fq-outbox";
const STORE = "entries";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB request failed"));
  });
}

function createIdbStore(db: IDBDatabase): OutboxStore {
  return {
    persistent: true,
    async add(entry) {
      await tx(db, "readwrite", (s) => s.put(entry));
      emit();
    },
    async list() {
      const all = (await tx(db, "readonly", (s) => s.getAll())) as OutboxEntry[];
      return all.sort(byCreatedAt);
    },
    async update(id, patch) {
      const current = (await tx(db, "readonly", (s) => s.get(id))) as OutboxEntry | undefined;
      if (!current) return;
      await tx(db, "readwrite", (s) => s.put({ ...current, ...patch }));
      emit();
    },
    async remove(id) {
      await tx(db, "readwrite", (s) => s.delete(id));
      emit();
    },
  };
}

let storePromise: Promise<OutboxStore> | null = null;

/** Singleton accessor. IDB when available; otherwise an in-memory queue for
 * the session (callers surface the honest "keep the app open" copy). */
export function getOutboxStore(): Promise<OutboxStore> {
  if (!storePromise) {
    storePromise = (async () => {
      try {
        if (typeof indexedDB === "undefined") throw new Error("no indexedDB");
        return createIdbStore(await openDb());
      } catch {
        return createMemoryStore();
      }
    })();
  }
  return storePromise;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/focusquest test -- outbox/store`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add artifacts/focusquest/src/lib/outbox/store.ts artifacts/focusquest/src/lib/outbox/store.test.ts
git commit -m "feat(web): outbox store — contract-tested memory adapter + thin raw-IDB adapter with memory fallback"
```

---

### Task 4: Replay orchestrator — ordered drain with the policy table

**Files:**
- Create: `artifacts/focusquest/src/lib/outbox/replay.ts`
- Test: `artifacts/focusquest/src/lib/outbox/replay.test.ts`

**Interfaces:**
- Consumes: `OutboxStore`/`createMemoryStore` (Task 3), `decideReplayFailure`/`EMPTY_TRANSCRIPT_MESSAGE`/entry types (Task 2), `parseQuickAdd` from `@workspace/quick-add`, generated `Task`/`TaskInput` types.
- Produces (used by Task 8):

```ts
export type ReplayApi = {
  createTask(input: TaskInput & { clientKey: string }): Promise<Task>;
  transcribe(blob: Blob): Promise<{ text: string }>;
};
export type DrainResult = { synced: number; parked: number; stopped: null | { authNeeded: boolean } };
export async function drainOutbox(store: OutboxStore, api: ReplayApi): Promise<DrainResult>;
export async function drainOutboxLocked(store: OutboxStore, api: ReplayApi): Promise<DrainResult | null>; // null = another tab holds the lock
```

- [ ] **Step 1: Write the failing test** — create `artifacts/focusquest/src/lib/outbox/replay.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import type { TaskInput } from "@workspace/api-client-react";
import { createMemoryStore } from "./store";
import { makeTextEntry, makeVoiceEntry } from "./core";
import { drainOutbox, type ReplayApi } from "./replay";

const key = (n: string) => n.padEnd(12, "_");
const text = (title: string, at: string, extra: Partial<TaskInput> = {}) =>
  makeTextEntry({ title, clientKey: key(title), ...extra }, { now: new Date(at), tz: "UTC" });
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

function api(overrides: Partial<ReplayApi> = {}): ReplayApi {
  return {
    createTask: vi.fn().mockResolvedValue({ id: 1 }),
    transcribe: vi.fn().mockResolvedValue({ text: "buy milk" }),
    ...overrides,
  };
}

describe("drainOutbox", () => {
  it("drains oldest-first, passes each entry's id as clientKey, removes synced entries", async () => {
    const store = createMemoryStore();
    await store.add(text("second", "2026-07-20T10:00:00Z"));
    await store.add(text("first", "2026-07-20T09:00:00Z"));
    const a = api();
    const result = await drainOutbox(store, a);
    expect(result).toEqual({ synced: 2, parked: 0, stopped: null });
    const calls = (a.createTask as ReturnType<typeof vi.fn>).mock.calls.map(([input]) => input);
    expect(calls.map((c) => c.title)).toEqual(["first", "second"]);
    expect(calls.map((c) => c.clientKey)).toEqual([key("first"), key("second")]);
    expect(await store.list()).toHaveLength(0);
  });

  it("network failure stops the drain and keeps everything queued, order intact", async () => {
    const store = createMemoryStore();
    await store.add(text("first", "2026-07-20T09:00:00Z"));
    await store.add(text("second", "2026-07-20T10:00:00Z"));
    const a = api({ createTask: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) });
    const result = await drainOutbox(store, a);
    expect(result).toEqual({ synced: 0, parked: 0, stopped: { authNeeded: false } });
    const left = await store.list();
    expect(left).toHaveLength(2);
    expect(left.every((e) => e.status === "queued")).toBe(true);
    expect(left[0].attempts).toBe(1);   // only the attempted head was charged
    expect(left[1].attempts).toBe(0);
    expect(a.createTask).toHaveBeenCalledTimes(1);
  });

  it("401 stops with authNeeded", async () => {
    const store = createMemoryStore();
    await store.add(text("first", "2026-07-20T09:00:00Z"));
    const a = api({ createTask: vi.fn().mockRejectedValue(httpError(401)) });
    const result = await drainOutbox(store, a);
    expect(result.stopped).toEqual({ authNeeded: true });
    expect((await store.list())[0].status).toBe("queued");
  });

  it("429 and 5xx stop the drain (cooldowns / sick server)", async () => {
    for (const status of [429, 500]) {
      const store = createMemoryStore();
      await store.add(text("first", "2026-07-20T09:00:00Z"));
      const result = await drainOutbox(store, api({ createTask: vi.fn().mockRejectedValue(httpError(status)) }));
      expect(result.stopped).toEqual({ authNeeded: false });
    }
  });

  it("422 retries exactly once without questlineId, then succeeds", async () => {
    const store = createMemoryStore();
    await store.add(text("orphan", "2026-07-20T09:00:00Z", { questlineId: 99 }));
    const createTask = vi.fn()
      .mockRejectedValueOnce(httpError(422))
      .mockResolvedValueOnce({ id: 1 });
    const result = await drainOutbox(store, api({ createTask }));
    expect(result).toEqual({ synced: 1, parked: 0, stopped: null });
    expect(createTask).toHaveBeenCalledTimes(2);
    expect(createTask.mock.calls[0][0].questlineId).toBe(99);
    expect(createTask.mock.calls[1][0]).not.toHaveProperty("questlineId");
    expect(createTask.mock.calls[1][0].clientKey).toBe(key("orphan"));
  });

  it("422 with no questline to shed parks the entry and continues", async () => {
    const store = createMemoryStore();
    await store.add(text("bad", "2026-07-20T09:00:00Z"));
    await store.add(text("good", "2026-07-20T10:00:00Z"));
    const createTask = vi.fn()
      .mockRejectedValueOnce(httpError(422))
      .mockResolvedValueOnce({ id: 1 });
    const result = await drainOutbox(store, api({ createTask }));
    expect(result.synced).toBe(1);
    expect(result.parked).toBe(1);
    const left = await store.list();
    expect(left).toHaveLength(1);
    expect(left[0].status).toBe("failed");
    expect(left[0].lastError).toBeTruthy();
  });

  it("terminal 4xx parks the head but still syncs the rest (a bad entry never blocks the queue)", async () => {
    const store = createMemoryStore();
    await store.add(text("bad", "2026-07-20T09:00:00Z"));
    await store.add(text("good", "2026-07-20T10:00:00Z"));
    const createTask = vi.fn()
      .mockRejectedValueOnce(httpError(400))
      .mockResolvedValueOnce({ id: 1 });
    const result = await drainOutbox(store, api({ createTask }));
    expect(result).toEqual({ synced: 1, parked: 1, stopped: null });
    const left = await store.list();
    expect(left).toHaveLength(1);
    expect(left[0].status).toBe("failed");
  });

  it("skips entries already parked as failed", async () => {
    const store = createMemoryStore();
    const parked = text("parked", "2026-07-20T09:00:00Z");
    await store.add(parked);
    await store.update(parked.id, { status: "failed", lastError: "old" });
    await store.add(text("fresh", "2026-07-20T10:00:00Z"));
    const a = api();
    const result = await drainOutbox(store, a);
    expect(result.synced).toBe(1);
    expect(a.createTask).toHaveBeenCalledTimes(1);
    expect((await store.list())[0].status).toBe("failed");
  });

  it("voice: transcribes, parses deterministically anchored to capture time, creates with the entry id", async () => {
    const store = createMemoryStore();
    const blob = new Blob(["x"], { type: "audio/mp4" });
    const entry = makeVoiceEntry(blob, 42_000, { now: new Date("2026-07-20T09:00:00Z"), tz: "UTC" });
    await store.add(entry);
    const a = api({ transcribe: vi.fn().mockResolvedValue({ text: "buy milk" }) });
    const result = await drainOutbox(store, a);
    expect(result.synced).toBe(1);
    expect(a.transcribe).toHaveBeenCalledWith(blob);
    const input = (a.createTask as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(input.title).toBe("buy milk");
    expect(input.clientKey).toBe(entry.id);
    expect(input.dueDate).toBe(entry.captureDate);   // no date in transcript → capture day
    expect(input.priority).toBe("medium");
  });

  it("voice: an empty transcript parks with the anti-shame copy and keeps the blob", async () => {
    const store = createMemoryStore();
    await store.add(makeVoiceEntry(new Blob(["x"], { type: "audio/webm" }), 9_000, { now: new Date("2026-07-20T09:00:00Z") }));
    const a = api({ transcribe: vi.fn().mockResolvedValue({ text: "   " }) });
    const result = await drainOutbox(store, a);
    expect(result).toEqual({ synced: 0, parked: 1, stopped: null });
    const [left] = await store.list();
    expect(left.status).toBe("failed");
    expect(left.lastError).toBe("Couldn't hear anything in this note");
    expect(left.payload.kind).toBe("voice");
    expect(a.createTask).not.toHaveBeenCalled();
  });

  it("voice: a transcribe network failure stops the drain with the blob still queued", async () => {
    const store = createMemoryStore();
    await store.add(makeVoiceEntry(new Blob(["x"], { type: "audio/webm" }), 9_000, { now: new Date("2026-07-20T09:00:00Z") }));
    const a = api({ transcribe: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) });
    const result = await drainOutbox(store, a);
    expect(result.stopped).toEqual({ authNeeded: false });
    expect((await store.list())[0].status).toBe("queued");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/focusquest test -- outbox/replay`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `artifacts/focusquest/src/lib/outbox/replay.ts`:

```ts
import { parseQuickAdd } from "@workspace/quick-add";
import type { Task, TaskInput } from "@workspace/api-client-react";
import {
  decideReplayFailure,
  EMPTY_TRANSCRIPT_MESSAGE,
  type OutboxEntry,
} from "./core";
import type { OutboxStore } from "./store";

export type ReplayApi = {
  createTask(input: TaskInput & { clientKey: string }): Promise<Task>;
  transcribe(blob: Blob): Promise<{ text: string }>;
};

export type DrainResult = {
  synced: number;
  parked: number;
  /** Non-null when the drain halted early on a retryable failure. */
  stopped: null | { authNeeded: boolean };
};

/** Build the create body for a voice entry from its transcript. Deterministic
 * parse only, anchored to capture time — no AI parse on replay (spec §Part 3). */
function voiceInput(entry: OutboxEntry, transcript: string): TaskInput & { clientKey: string } {
  if (entry.payload.kind !== "voice") throw new Error("voiceInput on non-voice entry");
  const parsed = parseQuickAdd(transcript, { now: new Date(entry.createdAt) });
  return {
    title: parsed.title || transcript.trim(),
    dueDate: parsed.dueDate ?? entry.captureDate,
    priority: (parsed.priority ?? "medium") as TaskInput["priority"],
    ...(parsed.dueTime ? { dueTime: parsed.dueTime } : {}),
    ...(parsed.category ? { category: parsed.category as TaskInput["category"] } : {}),
    ...(entry.payload.questlineId != null ? { questlineId: entry.payload.questlineId } : {}),
    clientKey: entry.id,
  };
}

function stripQuestline(input: TaskInput & { clientKey: string }): TaskInput & { clientKey: string } {
  const { questlineId: _dropped, ...rest } = input;
  return rest;
}

/** Sequential oldest-first drain. Retryable failures stop the whole drain so
 * order is preserved across triggers; terminal failures park and continue. */
export async function drainOutbox(store: OutboxStore, api: ReplayApi): Promise<DrainResult> {
  const result: DrainResult = { synced: 0, parked: 0, stopped: null };

  for (const entry of await store.list()) {
    if (entry.status === "failed") continue; // parked: manual retry/discard only

    await store.update(entry.id, { status: "syncing", attempts: entry.attempts + 1 });

    try {
      let input: TaskInput & { clientKey: string };
      if (entry.payload.kind === "text") {
        input = entry.payload.input;
      } else {
        const { text } = await api.transcribe(entry.payload.blob);
        if (!text.trim()) {
          await store.update(entry.id, { status: "failed", lastError: EMPTY_TRANSCRIPT_MESSAGE });
          result.parked++;
          continue;
        }
        input = voiceInput(entry, text);
      }

      try {
        await api.createTask(input);
      } catch (err) {
        // One shed-the-questline retry: the capture outranks its grouping.
        if (decideReplayFailure(err).action === "retry-without-questline" && input.questlineId != null) {
          await api.createTask(stripQuestline(input));
        } else {
          throw err;
        }
      }

      await store.remove(entry.id);
      result.synced++;
    } catch (err) {
      const decision = decideReplayFailure(err);
      if (decision.action === "park" || decision.action === "retry-without-questline") {
        // retry-without-questline landing here means there was nothing to shed
        // (or the retry itself failed non-retryably): park it visibly.
        const message = decision.action === "park" ? decision.message : "Couldn't sync this one — retry or discard.";
        await store.update(entry.id, { status: "failed", lastError: message });
        result.parked++;
        continue;
      }
      await store.update(entry.id, { status: "queued" });
      result.stopped = { authNeeded: decision.authNeeded === true };
      break;
    }
  }

  return result;
}

/** Web-Lock-wrapped drain so two tabs don't double-run; the server clientKey
 * is the real exactly-once guarantee, this just avoids wasted requests.
 * Returns null when another tab holds the lock. */
export async function drainOutboxLocked(store: OutboxStore, api: ReplayApi): Promise<DrainResult | null> {
  const locks = (navigator as { locks?: LockManager } | undefined)?.locks;
  if (!locks?.request) return drainOutbox(store, api);
  return locks.request("fq-outbox-replay", { ifAvailable: true }, async (lock) =>
    lock ? drainOutbox(store, api) : null,
  );
}
```

One subtlety the tests pin down: a **stop** decision re-queues the head entry (`status: "queued"`) but its `attempts` increment survives — later entries were never touched, so their `attempts` stay 0.

A retryable failure on the shed-questline retry (network blip mid-retry) flows into the outer catch and stops the drain — the entry stays queued and the *next* drain re-attempts with the questline again, hitting the same 422 → retry path. Harmless: one extra request per drain, and the idempotency key makes the eventual success exactly-once.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/focusquest test -- outbox/replay`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add artifacts/focusquest/src/lib/outbox/replay.ts artifacts/focusquest/src/lib/outbox/replay.test.ts
git commit -m "feat(web): outbox replay — ordered drain, stop/park/shed-questline policy, voice transcribe-then-create"
```

---

### Task 5: Capture path — clientKey everywhere, timeout, offline stash (text + voice)

**Files:**
- Create: `artifacts/focusquest/src/lib/outbox/api.ts`
- Modify: `artifacts/focusquest/src/components/quick-add-bar.tsx`

**Interfaces:**
- Consumes: generated `createTask(input, options?: RequestInit)` + `customFetch` + `TranscribeResult` from `@workspace/api-client-react`; `makeTextEntry`/`makeVoiceEntry`/`newCaptureId` (Task 2); `getOutboxStore` (Task 3); `isNetworkError` (Task 2); `ReplayApi` (Task 4).
- Produces (used by Task 8): `replayApi: ReplayApi` in `outbox/api.ts`.

No new unit tests: every decision this task wires (entry construction, dueDate defaulting, network classification) is already covered by Tasks 2–4; the component itself has no test harness in this repo. Verification is the Step 4 behavior checks.

- [ ] **Step 1: Create `artifacts/focusquest/src/lib/outbox/api.ts`** (the real `ReplayApi` — also reused by the capture path for its timeout wrapper):

```ts
import { createTask, customFetch, type TaskInput, type TranscribeResult } from "@workspace/api-client-react";
import type { ReplayApi } from "./replay";

/** 10s cap: a dead-zone request must fail fast into the outbox instead of
 * hanging the capture moment. If the slow request actually landed, the shared
 * clientKey makes the later replay a dedupe, not a duplicate. */
export function createTaskWithTimeout(
  input: TaskInput & { clientKey: string },
  timeoutMs = 10_000,
): ReturnType<typeof createTask> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return createTask(input, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

export const replayApi: ReplayApi = {
  createTask: (input) => createTaskWithTimeout(input),
  // orval's generated transcribe hook JSON.stringifies Blob bodies (see the
  // note in quick-add-bar.tsx), so this endpoint always goes through
  // customFetch directly with the raw blob.
  transcribe: (blob) =>
    customFetch<TranscribeResult>("/api/tasks/transcribe", {
      method: "POST",
      headers: { "content-type": blob.type || "audio/webm" },
      body: blob,
    }),
};
```

- [ ] **Step 2: Rewire `quick-add-bar.tsx`.** Change the imports (lines 5, 12–13 area):

```ts
import { useParseQuickAdd, getGetTasksQueryKey, getGetTasksMomentumQueryKey, getGetQuestlinesQueryKey, getGetQuestlineQueryKey, customFetch, type TaskInput, type TranscribeResult } from "@workspace/api-client-react";
import { isNetworkError } from "@/lib/net-errors";
import { makeTextEntry, makeVoiceEntry, newCaptureId } from "@/lib/outbox/core";
import { getOutboxStore } from "@/lib/outbox/store";
import { createTaskWithTimeout } from "@/lib/outbox/api";
```

(`useCreateTask` is no longer imported.) Replace `const createMutation = useCreateTask();` (line 27) with:

```ts
  // Direct call instead of the orval hook so the capture path controls its
  // timeout signal and can classify server-answer vs dead-zone failures.
  const createMutation = useMutation({
    mutationFn: (input: TaskInput & { clientKey: string }) => createTaskWithTimeout(input),
  });
```

Replace `handleCreate` (lines 65–91) with:

```ts
  const stashCapture = async (input: TaskInput & { clientKey: string }) => {
    const store = await getOutboxStore();
    await store.add(makeTextEntry(input));
    toast(
      store.persistent
        ? { title: "Saved — will sync when you're back online ✓", className: "border-primary" }
        : { title: "Can't save to this browser — keep the app open until you're back online." },
    );
    setText("");
    setAiFields(null);
  };

  const handleCreate = () => {
    if (!canCreate) return;
    const dueDate = parsed.dueDate ?? format(selectedDate ?? new Date(), "yyyy-MM-dd");
    const input: TaskInput & { clientKey: string } = {
      title: parsed.title,
      dueDate,
      priority: (parsed.priority ?? "medium") as any,
      ...(parsed.dueTime ? { dueTime: parsed.dueTime } : {}),
      ...(parsed.category ? { category: parsed.category as any } : {}),
      ...(questlineId != null ? { questlineId } : {}),
      // Every create carries a key — double-taps and timed-out-but-landed
      // requests dedupe server-side instead of duplicating.
      clientKey: newCaptureId(),
    };
    if (!navigator.onLine) { void stashCapture(input); return; }
    createMutation.mutate(input, {
      onSuccess: (task) => {
        toast({ title: `Quest added — ${task.points} XP`, className: "border-primary" });
        setText("");
        setAiFields(null);
        queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetTasksMomentumQueryKey() });
        if (questlineId != null) {
          queryClient.invalidateQueries({ queryKey: getGetQuestlinesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetQuestlineQueryKey(questlineId) });
        }
      },
      onError: (err) => {
        if (isNetworkError(err)) { void stashCapture(input); return; }
        toast({ title: "Couldn't add that quest", variant: "destructive" });
      },
    });
  };
```

- [ ] **Step 3: Voice offline path.** In the same file, add next to `stashCapture`:

```ts
  const stashVoice = async (blob: Blob, durationMs: number) => {
    const store = await getOutboxStore();
    await store.add(makeVoiceEntry(blob, durationMs, questlineId != null ? { questlineId } : {}));
    toast(
      store.persistent
        ? { title: "Voice note saved — I'll transcribe it when you're back online", className: "border-primary" }
        : { title: "Can't save to this browser — keep the app open until you're back online." },
    );
  };
```

In `useVoiceRecording`'s `onClip` (lines 135–164), after the too-short guard and the auto-stop toast, gate the transcribe attempt:

```ts
      if (!navigator.onLine) {
        void stashVoice(blob, durationMs);
        return;
      }
      transcribeMutation.mutate(blob, {
        onSuccess: ({ text: transcript }) => {
          /* unchanged */
        },
        onError: (err: any) => {
          if (isNetworkError(err)) { void stashVoice(blob, durationMs); return; }
          const status = err?.status;
          const msg =
            status === 503 ? "Voice input isn't set up yet."
            : status === 429 ? "Give it a moment and try again."
            : "Couldn't transcribe — try typing it.";
          toast({ title: msg, variant: "destructive" });
        },
      });
```

(The `onSuccess` body — setText, setAiFields(null), handleSmartParse — is unchanged; only the offline guard before `.mutate` and the `isNetworkError` branch in `onError` are new.)

- [ ] **Step 4: Gates + behavior check**

Run: `pnpm --filter @workspace/focusquest test` then `pnpm typecheck`
Expected: PASS / clean. The online path is exercised for real in Task 9's walkthrough (create a quest via the dev server, confirm 201 + a `clientKey` in the request body via devtools).

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add artifacts/focusquest/src/lib/outbox/api.ts artifacts/focusquest/src/components/quick-add-bar.tsx
git commit -m "feat(web): capture path — clientKey on every create, 10s timeout, offline stash for text + voice"
```

---

### Task 6: Service worker — precache manifest injection + fetch strategies

**Files:**
- Create: `artifacts/focusquest/scripts/inject-sw-precache.mjs`
- Test: `artifacts/focusquest/src/lib/sw-precache.test.ts`
- Modify: `artifacts/focusquest/public/sw.js`
- Modify: `artifacts/focusquest/package.json:8` (build script)

**Interfaces:**
- Produces: `dist/public/sw.js` whose `BUILD` line carries `{ hash, assets }` after every build; source `public/sw.js` keeps `{ hash: "dev", assets: [] }` so `vite dev` stays inert.
- Script exports (for the test): `collectPrecache(distDir): { assets: string[]; hash: string; totalBytes: number }` and `injectIntoSw(swSource: string, manifest: { hash: string; assets: string[] }): string`.

- [ ] **Step 1: Write the failing test** — create `artifacts/focusquest/src/lib/sw-precache.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The script is plain mjs (it runs post-vite-build, outside the src graph);
// import it relative to this test file.
const scriptUrl = new URL("../../scripts/inject-sw-precache.mjs", import.meta.url);

let collectPrecache: (dist: string) => { assets: string[]; hash: string; totalBytes: number };
let injectIntoSw: (src: string, m: { hash: string; assets: string[] }) => string;

beforeAll(async () => {
  const mod = await import(scriptUrl.href);
  collectPrecache = mod.collectPrecache;
  injectIntoSw = mod.injectIntoSw;
});

const MARKER = 'const BUILD = { hash: "dev", assets: [] }; // replaced at build time by scripts/inject-sw-precache.mjs';

function makeFixtureDist(): string {
  const dist = mkdtempSync(path.join(tmpdir(), "fq-dist-"));
  writeFileSync(path.join(dist, "index.html"), "<html>app</html>");
  writeFileSync(path.join(dist, "manifest.webmanifest"), "{}");
  writeFileSync(path.join(dist, "favicon.svg"), "<svg/>");
  writeFileSync(path.join(dist, "sw.js"), MARKER + "\nrest();");
  writeFileSync(path.join(dist, "opengraph.jpg"), "jpg");
  writeFileSync(path.join(dist, "robots.txt"), "x");
  mkdirSync(path.join(dist, "assets"));
  writeFileSync(path.join(dist, "assets", "index-Abc123.js"), "js");
  writeFileSync(path.join(dist, "assets", "index-Def456.css"), "css");
  mkdirSync(path.join(dist, "icons"));
  writeFileSync(path.join(dist, "icons", "icon-192.png"), "png");
  mkdirSync(path.join(dist, "lpc"));
  writeFileSync(path.join(dist, "lpc", "huge-sheet.png"), "megabytes of sprites");
  return dist;
}

describe("collectPrecache", () => {
  let dist: string;
  beforeAll(() => { dist = makeFixtureDist(); });
  afterAll(() => rmSync(dist, { recursive: true, force: true }));

  it("lists the shell: index.html, manifest, favicon, assets/*, icons/*", () => {
    const { assets } = collectPrecache(dist);
    expect(assets).toContain("/index.html");
    expect(assets).toContain("/manifest.webmanifest");
    expect(assets).toContain("/favicon.svg");
    expect(assets).toContain("/assets/index-Abc123.js");
    expect(assets).toContain("/assets/index-Def456.css");
    expect(assets).toContain("/icons/icon-192.png");
  });

  it("excludes art dirs, sw.js itself, opengraph and robots (capture-mode shell only)", () => {
    const { assets } = collectPrecache(dist);
    expect(assets.some((a) => a.startsWith("/lpc/"))).toBe(false);
    expect(assets).not.toContain("/sw.js");
    expect(assets).not.toContain("/opengraph.jpg");
    expect(assets).not.toContain("/robots.txt");
  });

  it("hash is deterministic and changes when index.html content changes", () => {
    const first = collectPrecache(dist).hash;
    expect(collectPrecache(dist).hash).toBe(first);
    writeFileSync(path.join(dist, "index.html"), "<html>app v2</html>");
    expect(collectPrecache(dist).hash).not.toBe(first);
  });

  it("reports total bytes for the size budget log", () => {
    expect(collectPrecache(dist).totalBytes).toBeGreaterThan(0);
  });
});

describe("injectIntoSw", () => {
  it("replaces the BUILD marker with the manifest", () => {
    const out = injectIntoSw(MARKER + "\nrest();", { hash: "abc123def456", assets: ["/index.html"] });
    expect(out).toContain('"hash":"abc123def456"');
    expect(out).toContain('"/index.html"');
    expect(out).not.toContain('hash: "dev"');
    expect(out).toContain("rest();");
  });

  it("throws when the marker is missing (a template drift must fail the build)", () => {
    expect(() => injectIntoSw("nothing here", { hash: "x", assets: [] })).toThrow(/marker/i);
  });
});

describe("public/sw.js template", () => {
  it("carries the exact marker line the build replaces", () => {
    const swPath = fileURLToPath(new URL("../../public/sw.js", import.meta.url));
    expect(readFileSync(swPath, "utf8")).toContain(MARKER);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/focusquest test -- sw-precache`
Expected: FAIL — script module not found.

- [ ] **Step 3: Implement the script** — create `artifacts/focusquest/scripts/inject-sw-precache.mjs`:

```js
// Post-build step (see package.json "build"): scans dist/public, injects the
// precached shell manifest into dist/public/sw.js. Source public/sw.js keeps
// hash "dev" so `vite dev` serves an inert worker. Assumes BASE_PATH=/ (what
// the Dockerfile deploys).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = 'const BUILD = { hash: "dev", assets: [] }; // replaced at build time by scripts/inject-sw-precache.mjs';
const SIZE_BUDGET_BYTES = 3 * 1024 * 1024;

// Shell only: the big art dirs (/lpc, /avatars, /kingdoms) and misc root
// files are deliberately absent — offline is capture-mode (spec §Part 1).
const ROOT_FILES = ["index.html", "manifest.webmanifest", "favicon.svg"];
const DIRS = ["assets", "icons"];

export function collectPrecache(distDir) {
  const assets = [];
  let totalBytes = 0;
  for (const f of ROOT_FILES) {
    assets.push(`/${f}`);
    totalBytes += statSync(path.join(distDir, f)).size;
  }
  for (const dir of DIRS) {
    for (const f of readdirSync(path.join(distDir, dir)).sort()) {
      assets.push(`/${dir}/${f}`);
      totalBytes += statSync(path.join(distDir, dir, f)).size;
    }
  }
  assets.sort();
  // Hashed bundle names make the list content-addressed — but index.html and
  // the manifest keep stable names, so their bytes join the hash too (a
  // meta-tag-only edit must still produce a fresh cache).
  const h = createHash("sha256");
  h.update(JSON.stringify(assets));
  h.update(readFileSync(path.join(distDir, "index.html")));
  h.update(readFileSync(path.join(distDir, "manifest.webmanifest")));
  return { assets, hash: h.digest("hex").slice(0, 12), totalBytes };
}

export function injectIntoSw(swSource, { hash, assets }) {
  if (!swSource.includes(MARKER)) {
    throw new Error("inject-sw-precache: BUILD marker line not found in sw.js — template drifted");
  }
  return swSource.replace(MARKER, `const BUILD = ${JSON.stringify({ hash, assets })};`);
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const distDir = path.resolve(here, "..", "dist", "public");
  const swPath = path.join(distDir, "sw.js");
  const manifest = collectPrecache(distDir);
  writeFileSync(swPath, injectIntoSw(readFileSync(swPath, "utf8"), manifest));
  const mb = (manifest.totalBytes / (1024 * 1024)).toFixed(2);
  console.log(`sw precache: ${manifest.assets.length} files, ${mb} MB, hash ${manifest.hash}`);
  if (manifest.totalBytes > SIZE_BUDGET_BYTES) {
    console.warn(`sw precache: WARNING — shell exceeds the ${SIZE_BUDGET_BYTES / (1024 * 1024)} MB budget; check what grew`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
```

- [ ] **Step 4: Rewrite `public/sw.js`.** Full new content (push + notificationclick handlers unchanged from today; install/activate/fetch replace the current lines 1–7 and 51–55):

```js
const BUILD = { hash: "dev", assets: [] }; // replaced at build time by scripts/inject-sw-precache.mjs

const SHELL_CACHE = `fq-shell-${BUILD.hash}`;
const FONT_CACHE = "fq-fonts-v1";
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (event) => {
  if (BUILD.hash !== "dev") {
    event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(BUILD.assets)));
  }
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("fq-shell-") && n !== SHELL_CACHE)
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(cacheName, request) {
  const cached = await caches.match(request, { cacheName });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Never intercept mutations — the outbox is app-layer (spec §Part 3).
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // API is network-only, always — including /api/login navigations.
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) return;

  // Fonts: cache-first into a small persistent cache so type survives offline.
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(FONT_CACHE, request));
    return;
  }

  // Everything below needs a real build (dev worker is inert) + same origin.
  if (BUILD.hash === "dev" || url.origin !== self.location.origin) return;

  // Navigations: network-first so deploys land immediately; cached shell offline.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/index.html", { cacheName: SHELL_CACHE })));
    return;
  }

  // Precached shell files (hashed → immutable): cache-first.
  if (BUILD.assets.includes(url.pathname)) {
    event.respondWith(cacheFirst(SHELL_CACHE, request));
  }
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "FocusQuest", body: event.data.text(), icon: "/favicon.svg" };
  }

  const options = {
    body: payload.body ?? "",
    icon: payload.icon ?? "/favicon.svg",
    badge: "/favicon.svg",
    tag: payload.tag ?? "focusquest",
    renotify: true,
    data: payload.data ?? {},
    actions: payload.actions ?? [],
  };

  event.waitUntil(
    self.registration.showNotification(payload.title ?? "FocusQuest", options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      if (clients.length > 0) {
        clients[0].focus();
        if (url !== "/" && clients[0].navigate) {
          return clients[0].navigate(url);
        }
      } else {
        return self.clients.openWindow(url);
      }
    })
  );
});
```

- [ ] **Step 5: Wire the build.** In `artifacts/focusquest/package.json`, change the build script:

```json
    "build": "vite build --config vite.config.ts && node scripts/inject-sw-precache.mjs",
```

- [ ] **Step 6: Run tests + a real build**

Run: `pnpm --filter @workspace/focusquest test -- sw-precache`
Expected: PASS (8 tests).

Run: `pnpm --filter @workspace/focusquest build`
Expected: vite build succeeds, then a line like `sw precache: N files, X.XX MB, hash abcdef123456` with **no** budget warning; `dist/public/sw.js` no longer contains `hash: "dev"`. If the size warning fires, list `dist/public/assets` by size and report the offenders in the PR — do not raise the budget silently.

- [ ] **Step 7: Commit**

```bash
git branch --show-current
git add artifacts/focusquest/scripts/inject-sw-precache.mjs artifacts/focusquest/src/lib/sw-precache.test.ts artifacts/focusquest/public/sw.js artifacts/focusquest/package.json
git commit -m "feat(web): SW app-shell precache — build-time manifest injection, network-first navigations, api never intercepted"
```

---

### Task 7: Offline-aware gates — `useAuth` failure kind, session record, gate verdicts

**Files:**
- Modify: `lib/auth-web/src/use-auth.ts`
- Create: `artifacts/focusquest/src/lib/offline-session.ts`
- Test: `artifacts/focusquest/src/lib/offline-session.test.ts`
- Modify: `artifacts/focusquest/src/App.tsx:133-160` (OnboardingGate), `:191-230` (AuthGate)

**Interfaces:**
- Consumes: `isNetworkError` (Task 2).
- Produces (used by AuthGate/OnboardingGate here; record writes also feed Task 8's shell):

```ts
// lib/auth-web use-auth.ts — AuthState gains:
failure: "unreachable" | null;   // 5xx or fetch rejection; null once answered authoritatively

// offline-session.ts
export type SessionRecord = { authed: boolean; onboardingComplete: boolean; savedAt: string };
export function readSessionRecord(storage?: Pick<Storage, "getItem">): SessionRecord | null;
export function writeSessionRecord(patch: Partial<Omit<SessionRecord, "savedAt">>, storage?: Pick<Storage, "getItem" | "setItem">): void; // merge
export function clearSessionRecord(storage?: Pick<Storage, "removeItem">): void;
export function authVerdict(args: { isAuthenticated: boolean; failure: "unreachable" | null; record: SessionRecord | null }): "in" | "out";
export function onboardingVerdict(args: { stats: { onboardingComplete?: boolean } | undefined; isPaused: boolean; error: unknown; record: SessionRecord | null }): "app" | "onboarding" | "loading";
```

- [ ] **Step 1: Write the failing test** — create `artifacts/focusquest/src/lib/offline-session.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  readSessionRecord, writeSessionRecord, clearSessionRecord,
  authVerdict, onboardingVerdict, type SessionRecord,
} from "./offline-session";

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

const record = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  authed: true, onboardingComplete: true, savedAt: "2026-07-20T09:00:00Z", ...over,
});

describe("session record storage", () => {
  it("round-trips and merges patches", () => {
    const s = memoryStorage();
    writeSessionRecord({ authed: true }, s);
    writeSessionRecord({ onboardingComplete: true }, s);
    const got = readSessionRecord(s);
    expect(got?.authed).toBe(true);
    expect(got?.onboardingComplete).toBe(true);
    expect(typeof got?.savedAt).toBe("string");
  });
  it("returns null on empty or corrupt storage (never throws)", () => {
    const s = memoryStorage();
    expect(readSessionRecord(s)).toBeNull();
    s.setItem("fq.offline-session", "{not json");
    expect(readSessionRecord(s)).toBeNull();
  });
  it("clear removes the record", () => {
    const s = memoryStorage();
    writeSessionRecord({ authed: true }, s);
    clearSessionRecord(s);
    expect(readSessionRecord(s)).toBeNull();
  });
});

describe("authVerdict", () => {
  it("authenticated always wins", () => {
    expect(authVerdict({ isAuthenticated: true, failure: null, record: null })).toBe("in");
  });
  it("unreachable + cached authed → in (offline grace)", () => {
    expect(authVerdict({ isAuthenticated: false, failure: "unreachable", record: record() })).toBe("in");
  });
  it("unreachable with no record (fresh device) → out", () => {
    expect(authVerdict({ isAuthenticated: false, failure: "unreachable", record: null })).toBe("out");
  });
  it("an authoritative no → out even with a cached record", () => {
    expect(authVerdict({ isAuthenticated: false, failure: null, record: record() })).toBe("out");
  });
});

describe("onboardingVerdict", () => {
  it("positive server answers win: complete → app, incomplete → onboarding", () => {
    expect(onboardingVerdict({ stats: { onboardingComplete: true }, isPaused: false, error: null, record: null })).toBe("app");
    expect(onboardingVerdict({ stats: { onboardingComplete: false }, isPaused: false, error: null, record: record() })).toBe("onboarding");
  });
  it("paused offline + cached complete → app (grace)", () => {
    expect(onboardingVerdict({ stats: undefined, isPaused: true, error: null, record: record() })).toBe("app");
  });
  it("network error + cached complete → app; 5xx too (cold start)", () => {
    expect(onboardingVerdict({ stats: undefined, isPaused: false, error: new TypeError("fetch failed"), record: record() })).toBe("app");
    const err500 = Object.assign(new Error("HTTP 500"), { status: 500 });
    expect(onboardingVerdict({ stats: undefined, isPaused: false, error: err500, record: record() })).toBe("app");
  });
  it("no stats + no grace → loading, never the onboarding screen", () => {
    expect(onboardingVerdict({ stats: undefined, isPaused: true, error: null, record: null })).toBe("loading");
    expect(onboardingVerdict({ stats: undefined, isPaused: false, error: null, record: record() })).toBe("loading");
    const err401 = Object.assign(new Error("HTTP 401"), { status: 401 });
    expect(onboardingVerdict({ stats: undefined, isPaused: false, error: err401, record: record() })).toBe("loading");
  });
  it("cached record without onboardingComplete grants no grace", () => {
    expect(onboardingVerdict({ stats: undefined, isPaused: true, error: null, record: record({ onboardingComplete: false }) })).toBe("loading");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/focusquest test -- offline-session`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `artifacts/focusquest/src/lib/offline-session.ts`:

```ts
import { isNetworkError } from "@/lib/net-errors";

/** Last-known-good session facts, written only on positive server answers.
 * Grace NEVER comes from this record alone — only from record + an
 * unreachable-server signal. A real 401/logged-out answer clears it. */
export type SessionRecord = {
  authed: boolean;
  onboardingComplete: boolean;
  savedAt: string;
};

const KEY = "fq.offline-session";

export function readSessionRecord(storage: Pick<Storage, "getItem"> = localStorage): SessionRecord | null {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionRecord>;
    if (typeof parsed !== "object" || parsed === null) return null;
    return {
      authed: parsed.authed === true,
      onboardingComplete: parsed.onboardingComplete === true,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
    };
  } catch {
    return null;
  }
}

export function writeSessionRecord(
  patch: Partial<Omit<SessionRecord, "savedAt">>,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): void {
  try {
    const current = readSessionRecord(storage);
    const next: SessionRecord = {
      authed: patch.authed ?? current?.authed ?? false,
      onboardingComplete: patch.onboardingComplete ?? current?.onboardingComplete ?? false,
      savedAt: new Date().toISOString(),
    };
    storage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode): grace simply won't apply.
  }
}

export function clearSessionRecord(storage: Pick<Storage, "removeItem"> = localStorage): void {
  try {
    storage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

function isUnreachableError(err: unknown): boolean {
  if (isNetworkError(err)) return true;
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 500;
}

export function authVerdict(args: {
  isAuthenticated: boolean;
  failure: "unreachable" | null;
  record: SessionRecord | null;
}): "in" | "out" {
  if (args.isAuthenticated) return "in";
  if (args.failure === "unreachable" && args.record?.authed) return "in";
  return "out";
}

export function onboardingVerdict(args: {
  stats: { onboardingComplete?: boolean } | undefined;
  isPaused: boolean;
  error: unknown;
  record: SessionRecord | null;
}): "app" | "onboarding" | "loading" {
  if (args.stats) return args.stats.onboardingComplete ? "app" : "onboarding";
  const unreachable = args.isPaused || (args.error != null && isUnreachableError(args.error));
  if (unreachable && args.record?.onboardingComplete) return "app";
  // No positive answer and no grace: hold at loading — the onboarding screen
  // only ever shows on a positive "not onboarded" from the server.
  return "loading";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/focusquest test -- offline-session`
Expected: PASS (11 tests).

- [ ] **Step 5: `useAuth` exposes the failure kind.** In `lib/auth-web/src/use-auth.ts`, replace the whole file with:

```ts
import { useState, useEffect, useCallback } from "react";
import type { AuthUser } from "@workspace/api-client-react";

export type { AuthUser };

/** "unreachable" = we never got an authoritative answer about the session
 * (fetch rejected, or the server 5xx'd — Render cold starts included).
 * Consumers may apply offline grace on it; a real 401/logged-out answer
 * always reports failure: null with user: null. */
export type AuthFailure = "unreachable" | null;

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  failure: AuthFailure;
  login: () => void;
  logout: () => void;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [failure, setFailure] = useState<AuthFailure>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/auth/user", { credentials: "include" })
      .then(async (res) => {
        if (res.ok) {
          const data = (await res.json()) as { user: AuthUser | null };
          return { user: data.user ?? null, failure: null as AuthFailure };
        }
        // 5xx is not an answer about the session; anything else is a "no".
        return { user: null, failure: (res.status >= 500 ? "unreachable" : null) as AuthFailure };
      })
      .catch(() => ({ user: null, failure: "unreachable" as AuthFailure }))
      .then((result) => {
        if (!cancelled) {
          setUser(result.user);
          setFailure(result.failure);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(() => {
    const base = import.meta.env.BASE_URL.replace(/\/+$/, "") || "/";
    window.location.href = `/api/login?returnTo=${encodeURIComponent(base)}`;
  }, []);

  const logout = useCallback(() => {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/logout";
    document.body.appendChild(form);
    form.submit();
  }, []);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    failure,
    login,
    logout,
  };
}
```

- [ ] **Step 6: Wire the gates in `App.tsx`.** Add imports:

```ts
import { readSessionRecord, writeSessionRecord, clearSessionRecord, authVerdict, onboardingVerdict } from "@/lib/offline-session";
```

**AuthGate** (lines 191–230) — replace the hook call and the `!isAuthenticated` branch condition; the loading and login-screen JSX stay as they are:

```tsx
function AuthGate({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated, failure, login } = useAuth();

  useEffect(() => {
    if (isAuthenticated) writeSessionRecord({ authed: true });
    else if (!isLoading && failure === null) clearSessionRecord(); // authoritative "no"
  }, [isAuthenticated, isLoading, failure]);

  if (isLoading) {
    /* existing loading JSX unchanged */
  }

  const verdict = authVerdict({ isAuthenticated, failure, record: readSessionRecord() });
  if (verdict === "out") {
    /* existing login-screen JSX unchanged */
  }

  return <>{children}</>;
}
```

**OnboardingGate** (lines 133–160) — replace the query destructure, add the record write, and route through the verdict (loading JSX and `<OnboardingScreen />` stay as they are):

```tsx
function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { data: stats, isLoading, error, fetchStatus } = useGetMyStats({ tz: browserTimeZone() });
  const putTz = usePutMyTimezone();

  useEffect(() => {
    putTz.mutate({ data: { tz: browserTimeZone() } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (stats) writeSessionRecord({ authed: true, onboardingComplete: !!stats.onboardingComplete });
  }, [stats]);

  const verdict = onboardingVerdict({
    stats,
    isPaused: fetchStatus === "paused",
    error: error ?? null,
    record: readSessionRecord(),
  });

  if (isLoading || verdict === "loading") {
    /* existing loading JSX unchanged */
  }

  if (verdict === "onboarding") {
    return <OnboardingScreen />;
  }

  return <>{children}</>;
}
```

Known accepted edge (spec): a fresh device opened offline has no record → auth verdict "out" / loading — nothing existed to protect. Logged-out state self-corrects on the next online load because `/api/auth/user` answers authoritatively (200 with `user: null` → record cleared).

- [ ] **Step 7: Gates**

Run: `pnpm --filter @workspace/focusquest test` then `pnpm typecheck`
Expected: PASS / clean (typecheck confirms no other consumer of `useAuth` breaks on the added field).

- [ ] **Step 8: Commit**

```bash
git branch --show-current
git add lib/auth-web/src/use-auth.ts artifacts/focusquest/src/lib/offline-session.ts artifacts/focusquest/src/lib/offline-session.test.ts artifacts/focusquest/src/App.tsx
git commit -m "feat(web): offline-aware gates — unreachable vs denied, last-known-good grace, 401 always wins"
```

---

### Task 8: Offline UI — banner, outbox block, sync triggers, Now fallback

**Files:**
- Create: `artifacts/focusquest/src/hooks/use-online.ts`
- Create: `artifacts/focusquest/src/hooks/use-outbox.ts`
- Create: `artifacts/focusquest/src/components/offline-banner.tsx`
- Create: `artifacts/focusquest/src/components/outbox-block.tsx`
- Modify: `artifacts/focusquest/src/components/layout.tsx:171-177,299-308`
- Modify: `artifacts/focusquest/src/pages/now.tsx:82-113`
- Modify: `artifacts/focusquest/src/pages/tasks.tsx:275` (immediately after `<QuickAddBar selectedDate={date} />`)

**Interfaces:**
- Consumes: `getOutboxStore`/`outboxChanged` (Task 3), `drainOutboxLocked` (Task 4), `replayApi` (Task 5), `entryLabel`/`OutboxEntry` (Task 2), `getGetTasksQueryKey`/`getGetTasksMomentumQueryKey` (generated), `useToast`.
- Produces: `useOnline(): boolean` · `useOutboxEntries(): OutboxEntry[]` · `useOutboxActions(): { syncNow(): void; retry(id: string): void; discard(id: string): void }` · `useOutboxSync(): void` (Layout-only effect: drain on mount + `online` event) · `<OfflineBanner />` · `<OutboxBlock />`.

All four hooks/components are thin wiring over already-tested cores (Tasks 2–4); no new unit tests — behavior is exercised in Task 9's walkthrough.

- [ ] **Step 1: `use-online.ts`:**

```ts
import { useEffect, useState } from "react";

/** navigator.onLine seeded, event-updated. Treated as a hint for UI — the
 * capture path trusts actual fetch failures, not this flag. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}
```

- [ ] **Step 2: `use-outbox.ts`:**

```ts
import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetTasksQueryKey, getGetTasksMomentumQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import type { OutboxEntry } from "@/lib/outbox/core";
import { getOutboxStore, outboxChanged } from "@/lib/outbox/store";
import { drainOutboxLocked } from "@/lib/outbox/replay";
import { replayApi } from "@/lib/outbox/api";

export function useOutboxEntries(): OutboxEntry[] {
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void getOutboxStore()
        .then((s) => s.list())
        .then((list) => {
          if (alive) setEntries(list);
        });
    };
    refresh();
    outboxChanged.addEventListener("change", refresh);
    return () => {
      alive = false;
      outboxChanged.removeEventListener("change", refresh);
    };
  }, []);
  return entries;
}

export function useOutboxActions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const syncNow = useCallback(() => {
    void (async () => {
      const store = await getOutboxStore();
      const result = await drainOutboxLocked(store, replayApi);
      if (!result) return; // another tab is draining
      if (result.synced > 0) {
        queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetTasksMomentumQueryKey() });
        toast({
          title: `Synced ${result.synced} quest${result.synced === 1 ? "" : "s"} ✓`,
          className: "border-primary",
        });
      }
      if (result.stopped?.authNeeded) {
        toast({ title: "Log in to sync your saved quests" });
      }
    })();
  }, [queryClient, toast]);

  const retry = useCallback(
    (id: string) => {
      void (async () => {
        const store = await getOutboxStore();
        await store.update(id, { status: "queued", lastError: undefined });
        syncNow();
      })();
    },
    [syncNow],
  );

  const discard = useCallback((id: string) => {
    void getOutboxStore().then((s) => s.remove(id));
  }, []);

  return { syncNow, retry, discard };
}

/** Mounted once in Layout: drain on app open and whenever we come back online. */
export function useOutboxSync(): void {
  const { syncNow } = useOutboxActions();
  useEffect(() => {
    syncNow();
    window.addEventListener("online", syncNow);
    return () => window.removeEventListener("online", syncNow);
  }, [syncNow]);
}
```

- [ ] **Step 3: `offline-banner.tsx`:**

```tsx
import { CloudOff } from "lucide-react";
import { useOnline } from "@/hooks/use-online";

/** Calm strip, muted styling — being offline is weather, not an error. */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
    >
      <CloudOff className="w-3.5 h-3.5 shrink-0" aria-hidden />
      <span>You're offline — captures are saved and will sync.</span>
    </div>
  );
}
```

- [ ] **Step 4: `outbox-block.tsx`:**

```tsx
import { CloudUpload, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOnline } from "@/hooks/use-online";
import { useOutboxActions, useOutboxEntries } from "@/hooks/use-outbox";
import { entryLabel } from "@/lib/outbox/core";

/** "Waiting to sync" — queued captures, visually distinct from real quests
 * (no checkbox: they can't be completed yet). Renders nothing when empty. */
export function OutboxBlock() {
  const entries = useOutboxEntries();
  const online = useOnline();
  const { syncNow, retry, discard } = useOutboxActions();

  if (entries.length === 0) return null;

  return (
    <div className="rounded-xl border border-primary/20 bg-muted/20 p-3 space-y-2" data-testid="outbox-block">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <CloudUpload className="w-3.5 h-3.5" aria-hidden />
          Waiting to sync ({entries.length})
        </span>
        {online && (
          <Button variant="ghost" size="sm" onClick={syncNow} className="h-6 px-2 text-xs text-muted-foreground hover:text-primary">
            Sync now
          </Button>
        )}
      </div>
      <ul className="space-y-1.5">
        {entries.map((e) => (
          <li key={e.id} className="flex items-start justify-between gap-2 text-sm">
            <div className="min-w-0">
              <span className={`block truncate ${e.status === "failed" ? "text-muted-foreground" : "text-foreground"}`}>
                {entryLabel(e)}
              </span>
              {e.status === "failed" && e.lastError && (
                <span className="block text-xs text-muted-foreground">{e.lastError}</span>
              )}
            </div>
            <span className="flex items-center gap-1 shrink-0">
              {e.status === "failed" && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Retry ${entryLabel(e)}`}
                  onClick={() => retry(e.id)}
                  className="h-6 w-6 text-muted-foreground hover:text-primary"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Discard ${entryLabel(e)}`}
                onClick={() => discard(e.id)}
                className="h-6 w-6 text-muted-foreground hover:text-destructive"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 5: Layout wiring.** In `layout.tsx`: import both —

```ts
import { OfflineBanner } from "./offline-banner";
import { useOutboxSync } from "@/hooks/use-outbox";
```

Inside `Layout` (after line 177, next to the other hooks): `useOutboxSync();`
In the main content wrapper (line 307), render the banner above `InstallBanner`:

```tsx
          <OfflineBanner />
          <InstallBanner />
          {children}
```

- [ ] **Step 6: Now screen.** In `now.tsx`: import `OutboxBlock` (`import { OutboxBlock } from "@/components/outbox-block";`). Replace the two early returns (lines 82–86):

```tsx
  if (statsLoading || tasksLoading) {
    return <NowSkeleton />;
  }

  // Can't reach the server (offline, cold start): capture-first shell instead
  // of a blank page. Layout already shows the offline banner.
  if (!stats) {
    return (
      <div className="space-y-4 animate-in fade-in duration-300">
        <p className="text-sm text-muted-foreground">Capture now — sort it out later.</p>
        <div id="quick-add">
          <QuickAddBar selectedDate={new Date()} />
        </div>
        <OutboxBlock />
      </div>
    );
  }
```

And in the normal render, add `<OutboxBlock />` between the quick-add div and the Today's Quests section (after line 112):

```tsx
      {/* ── Quick add ──────────────────────────────────────── */}
      <div id="quick-add">
        <QuickAddBar selectedDate={new Date()} />
      </div>

      <OutboxBlock />
```

(React Query v5 nuance this depends on: offline, queries sit `fetchStatus: "paused"` with `isLoading === false` — so the `!stats` branch is reached instead of an eternal skeleton.)

- [ ] **Step 7: Tasks page.** In `tasks.tsx`, import `OutboxBlock` the same way and render it immediately after `<QuickAddBar selectedDate={date} />` (line 275):

```tsx
      <QuickAddBar selectedDate={date} />
      <OutboxBlock />
```

(It shows regardless of the selected date — queued captures are global.)

- [ ] **Step 8: Gates**

Run: `pnpm --filter @workspace/focusquest test` then `pnpm typecheck`
Expected: PASS / clean.

- [ ] **Step 9: Commit**

```bash
git branch --show-current
git add artifacts/focusquest/src/hooks/use-online.ts artifacts/focusquest/src/hooks/use-outbox.ts artifacts/focusquest/src/components/offline-banner.tsx artifacts/focusquest/src/components/outbox-block.tsx artifacts/focusquest/src/components/layout.tsx artifacts/focusquest/src/pages/now.tsx artifacts/focusquest/src/pages/tasks.tsx
git commit -m "feat(web): offline UI — banner, waiting-to-sync block, drain on open/online, Now capture-first fallback"
```

---

### Task 9: Full verification, walkthrough, PR

**Files:** none new (fixes only if the walkthrough finds issues).

- [ ] **Step 1: Full gates**

```bash
pnpm --filter @workspace/api-server test && pnpm --filter @workspace/focusquest test && pnpm --filter @workspace/quick-add test && pnpm typecheck
```

Expected: all green.

- [ ] **Step 2: Build check**

```bash
pnpm --filter @workspace/focusquest build
```

Expected: `sw precache: N files, X.XX MB, hash …` — no budget warning; `grep -c 'hash: "dev"' artifacts/focusquest/dist/public/sw.js` prints `0`.

- [ ] **Step 3: Dev-server walkthrough** (dev SW is inert by design — this verifies the app-layer pieces; full offline shell behavior is production-only):
  1. Start the dev server; log in; on `/` create a quest from the quick-add bar. In devtools Network confirm the `POST /api/tasks` body carries a `clientKey` and the response is **201**.
  2. Replay the same request from devtools ("Copy as fetch" → re-run). Confirm **200** and the same task `id` — no duplicate row in the list after refetch.
  3. DevTools → Network → Offline. Type a capture → "Saved — will sync when you're back online ✓" toast, entry appears in **Waiting to sync**, offline banner visible. Record a short voice note → "Voice note saved…" toast, `Voice note · 0:0X` row.
  4. Network back online → within the `online`-event drain: toast "Synced 2 quests ✓", rows leave the block, quests appear in Today's list with today's date, exactly once each.
  5. Reload while offline (devtools offline, after a prior online load): the app shell may fail in dev (no precache — expected); confirm instead that `/` renders the capture-first fallback + banner when only the API is unreachable: stop the API server, reload the web app, confirm the fallback (not the login screen — the auth grace path) renders.
- [ ] **Step 4: Production smoke (optional but recommended):** `pnpm --filter @workspace/api-server build`, run `NODE_ENV=production node artifacts/api-server/dist/index.mjs` with `.env` loaded, open `http://localhost:8080`, install-check the SW (Application tab: `fq-shell-<hash>` cache populated), then toggle devtools offline and reload → shell + banner render.
- [ ] **Step 5: Push + PR** targeting `main`, body includes: summary, the four seams, screenshots of the offline banner + outbox block, the Step 3 walkthrough results, and this device checklist for Chad (the charter acceptance, run on the installed PWA):

```
- [ ] Airplane mode ON → open FocusQuest from the home screen → shell renders with the offline banner (no login dead end)
- [ ] Quick-add three quests: two typed, one voice → each shows "Saved — will sync…" / "Voice note saved…"
- [ ] Airplane mode OFF, reopen/foreground the app → "Synced 3 quests ✓"; all three exist once each, dated the capture day, in capture order
- [ ] Double-tap Add rapidly online → exactly one quest created
```

- [ ] **Step 6:** After merge: refresh the campaign map artifact (Act VII 4/7, 31/38 = 82%) and the roadmap/project memory files, per rollout convention.

---

## Self-review (done at plan time)

- **Spec coverage:** Part 1 SW → Task 6; Part 2 gates → Task 7; Part 3 outbox core/store/replay/capture → Tasks 2–5; Part 4 idempotency → Task 1; UI surfaces → Task 8; acceptance → Task 9 + device checklist. Anti-shame copy strings appear verbatim in Global Constraints and the tasks that render them.
- **Type consistency:** `OutboxEntry`/`OutboxStore`/`ReplayApi`/`DrainResult`/`SessionRecord` signatures match across Tasks 2→8; `entry.id === clientKey` invariant enforced in `makeTextEntry` (tested) and `voiceInput` (tested).
- **No placeholders:** every step carries the actual code/commands.
