# Native Push Fan-Out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route all three server-side push senders (scheduler, accountability nudge, body-double invite) through the existing `dispatchToUser` so native `device_tokens` receive the same notifications as web, collapsing three duplicated web-push loops into one shared helper.

**Architecture:** A pure, unit-tested core (`lib/push-dispatch.ts`) holds the web-sub loop and the best-effort dispatch wrapper, both taking injected deps. A thin db-wiring file (`lib/push-dispatch-live.ts`) assembles the real deps and exposes `pushToUser(userId, payload)` for callers. The three call sites drop their hand-rolled web loops and call `pushToUser`.

**Tech Stack:** TypeScript, Express, Drizzle ORM (node-postgres), Vitest, pnpm workspace. Server package: `@workspace/api-server`.

## Global Constraints

- **Design spec:** `docs/superpowers/specs/2026-08-12-native-push-fanout-design.md` — the source of truth for behavior.
- **db-import purity rule:** importing `@workspace/db` throws at load if `DATABASE_URL` is unset, and eagerly builds a `pg.Pool`. Any file that must be unit-tested MUST NOT import the runtime `db` value (type-only `import type` from `@workspace/db` is fine). This is why the pure core and the db-wiring live in separate files. (Convention confirmed by `lib/starter-quests.ts:19`.)
- **No behavior change to gating/scheduling:** which notifications are sent, when, and their preference/quiet-hours/budget gating stay exactly as today. Only the set of delivery channels widens (web → web + Expo).
- **Best-effort delivery:** `pushToUser` never throws. A dispatch failure must not roll back the scheduler's spacing/budget claim.
- **`provider = 'expo'` only:** the Expo push API accepts only ExpoPushTokens; `listExpoTokens` filters to `provider = 'expo'`.
- **Package/test commands:** typecheck = `pnpm --filter @workspace/api-server typecheck`; full suite = `pnpm --filter @workspace/api-server test`; single file = `pnpm --filter @workspace/api-server exec vitest run <path>`.
- **Branch:** `feat/native-push-fanout` (already created off `main`; the design doc is committed there as `d4e9782`).

---

### Task 1: Pure web-sub loop — `sendWebToUser`

**Files:**
- Create: `artifacts/api-server/src/lib/push-dispatch.ts`
- Test: `artifacts/api-server/src/lib/push-dispatch.test.ts`

**Interfaces:**
- Consumes: `PushPayload` (type) from `./push-notifications`.
- Produces:
  - `interface WebSubscription { endpoint: string; p256dh: string; auth: string }`
  - `interface WebPushDeps { listSubscriptions(userId: number): Promise<WebSubscription[]>; send(sub: WebSubscription, payload: PushPayload): Promise<boolean>; remove(endpoint: string): Promise<void> }`
  - `sendWebToUser(userId: number, payload: PushPayload, deps: WebPushDeps): Promise<number>` — returns count of successful sends; prunes (via `deps.remove`) any subscription whose `send` returns false.

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/push-dispatch.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { sendWebToUser } from "./push-dispatch";

const payload = { title: "T", body: "B" };
const sub = (endpoint: string) => ({ endpoint, p256dh: "p", auth: "a" });

describe("sendWebToUser", () => {
  it("counts successful sends and prunes nothing when all succeed", async () => {
    const deps = {
      listSubscriptions: vi.fn().mockResolvedValue([sub("e1"), sub("e2")]),
      send: vi.fn().mockResolvedValue(true),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const n = await sendWebToUser(7, payload, deps);
    expect(n).toBe(2);
    expect(deps.send).toHaveBeenCalledTimes(2);
    expect(deps.remove).not.toHaveBeenCalled();
  });

  it("prunes a failed subscription and excludes it from the count", async () => {
    const deps = {
      listSubscriptions: vi.fn().mockResolvedValue([sub("good"), sub("dead")]),
      send: vi
        .fn()
        .mockImplementation((s: { endpoint: string }) =>
          Promise.resolve(s.endpoint === "good"),
        ),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const n = await sendWebToUser(7, payload, deps);
    expect(n).toBe(1);
    expect(deps.remove).toHaveBeenCalledWith("dead");
    expect(deps.remove).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/push-dispatch.test.ts`
Expected: FAIL — `Failed to resolve import "./push-dispatch"` (file does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `artifacts/api-server/src/lib/push-dispatch.ts`:

```typescript
import type { PushPayload } from "./push-notifications";

export interface WebSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface WebPushDeps {
  listSubscriptions(userId: number): Promise<WebSubscription[]>;
  send(sub: WebSubscription, payload: PushPayload): Promise<boolean>;
  remove(endpoint: string): Promise<void>;
}

/** Deliver to every web-push subscription for a user, pruning any that fail
 * (an expired/gone subscription). Returns the number of successful sends. */
export async function sendWebToUser(
  userId: number,
  payload: PushPayload,
  deps: WebPushDeps,
): Promise<number> {
  const subs = await deps.listSubscriptions(userId);
  let sent = 0;
  for (const sub of subs) {
    const ok = await deps.send(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      payload,
    );
    if (ok) sent += 1;
    else await deps.remove(sub.endpoint);
  }
  return sent;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/push-dispatch.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/push-dispatch.ts artifacts/api-server/src/lib/push-dispatch.test.ts
git commit -m "feat(push): pure sendWebToUser web-subscription loop with pruning"
```

---

### Task 2: Best-effort dispatch wrapper — `bestEffortDispatch`

**Files:**
- Modify: `artifacts/api-server/src/lib/push-dispatch.ts` (append)
- Test: `artifacts/api-server/src/lib/push-dispatch.test.ts` (append)

**Interfaces:**
- Consumes: `dispatchToUser` and `type DispatchDeps` from `./device-dispatch`; `logger` from `./logger`.
- Produces: `bestEffortDispatch(userId: number, payload: PushPayload, deps: DispatchDeps): Promise<void>` — calls `dispatchToUser`, logs the `DispatchResult`, and **never throws** (catches and logs any error).

Note on `dispatchToUser` order (from `device-dispatch.ts`): it calls `deps.sendWeb` first, then `deps.listExpoTokens`, then `deps.sendExpo`, then `deps.pruneTokens`. The throwing test below rejects `sendWeb` to exercise the catch.

- [ ] **Step 1: Write the failing test**

Append to `artifacts/api-server/src/lib/push-dispatch.test.ts`:

```typescript
import { bestEffortDispatch } from "./push-dispatch";

describe("bestEffortDispatch", () => {
  const dispatchDeps = (over: Record<string, unknown> = {}) => ({
    listExpoTokens: vi.fn().mockResolvedValue([]),
    sendExpo: vi.fn().mockResolvedValue([]),
    pruneTokens: vi.fn().mockResolvedValue(undefined),
    sendWeb: vi.fn().mockResolvedValue(1),
    ...over,
  });

  it("resolves without throwing on success and fans out via sendWeb", async () => {
    const deps = dispatchDeps();
    await expect(bestEffortDispatch(7, payload, deps)).resolves.toBeUndefined();
    expect(deps.sendWeb).toHaveBeenCalledWith(7, payload);
  });

  it("swallows errors from a throwing dep (best-effort contract)", async () => {
    const deps = dispatchDeps({
      sendWeb: vi.fn().mockRejectedValue(new Error("db down")),
    });
    await expect(bestEffortDispatch(7, payload, deps)).resolves.toBeUndefined();
  });
});
```

(Extend the existing top import line to `import { sendWebToUser, bestEffortDispatch } from "./push-dispatch";`, or keep the separate `import { bestEffortDispatch }` line shown above — both compile.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/push-dispatch.test.ts`
Expected: FAIL — `bestEffortDispatch is not a function` / import has no such export.

- [ ] **Step 3: Write minimal implementation**

Append to `artifacts/api-server/src/lib/push-dispatch.ts`:

```typescript
import { dispatchToUser, type DispatchDeps } from "./device-dispatch";
import { logger } from "./logger";

/** Fan out a push to all of a user's channels, best-effort: logs the result
 * and never throws, so a caller's control flow (e.g. the scheduler's
 * spacing/budget claim) is never rolled back by a delivery hiccup. */
export async function bestEffortDispatch(
  userId: number,
  payload: PushPayload,
  deps: DispatchDeps,
): Promise<void> {
  try {
    const result = await dispatchToUser(deps, userId, payload);
    logger.info({ userId, ...result }, "Dispatched push to user");
  } catch (err) {
    logger.error({ err, userId }, "Push dispatch failed");
  }
}
```

(Place the two new `import` lines at the top of the file with the existing `import type { PushPayload }` line.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/push-dispatch.test.ts`
Expected: PASS (4 tests total).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @workspace/api-server typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/lib/push-dispatch.ts artifacts/api-server/src/lib/push-dispatch.test.ts
git commit -m "feat(push): best-effort dispatch wrapper over dispatchToUser"
```

---

### Task 3: db-wiring — `push-dispatch-live.ts`

**Files:**
- Create: `artifacts/api-server/src/lib/push-dispatch-live.ts`

**Interfaces:**
- Consumes: `db`, `pushSubscriptionsTable`, `deviceTokensTable` from `@workspace/db`; `eq`, `and`, `inArray` from `drizzle-orm`; `sendPushNotification`, `type PushPayload` from `./push-notifications`; `buildExpoMessages`, `sendExpoPush`, `expoHttpTransport` from `./expo-push`; `type DispatchDeps` from `./device-dispatch`; `sendWebToUser`, `bestEffortDispatch`, `type WebPushDeps` from `./push-dispatch`.
- Produces:
  - `buildDispatchDeps(): DispatchDeps`
  - `pushToUser(userId: number, payload: PushPayload): Promise<void>` — the zero-config entry point all call sites use.

This file imports the runtime `db` value, so it is **not** unit-tested (see the db-import purity rule). It is verified by typecheck and by the full suite staying green; its behavior is covered indirectly by the `dispatchToUser`, `expo-push`, and `sendWebToUser` tests.

- [ ] **Step 1: Write the file**

Create `artifacts/api-server/src/lib/push-dispatch-live.ts`:

```typescript
import { eq, and, inArray } from "drizzle-orm";
import { db, pushSubscriptionsTable, deviceTokensTable } from "@workspace/db";
import { sendPushNotification, type PushPayload } from "./push-notifications";
import { buildExpoMessages, sendExpoPush, expoHttpTransport } from "./expo-push";
import type { DispatchDeps } from "./device-dispatch";
import { sendWebToUser, bestEffortDispatch, type WebPushDeps } from "./push-dispatch";

const webDeps: WebPushDeps = {
  listSubscriptions: (userId) =>
    db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, userId)),
  send: (sub, payload) => sendPushNotification(sub, payload),
  remove: (endpoint) =>
    db
      .delete(pushSubscriptionsTable)
      .where(eq(pushSubscriptionsTable.endpoint, endpoint))
      .then(() => undefined),
};

/** Assemble the real fan-out deps: web subs + Expo device tokens. */
export function buildDispatchDeps(): DispatchDeps {
  return {
    listExpoTokens: async (userId) => {
      const rows = await db
        .select({ token: deviceTokensTable.token })
        .from(deviceTokensTable)
        .where(
          and(
            eq(deviceTokensTable.userId, userId),
            eq(deviceTokensTable.provider, "expo"),
          ),
        );
      return rows.map((r) => r.token);
    },
    sendExpo: (tokens, payload) =>
      sendExpoPush(buildExpoMessages(tokens, payload), expoHttpTransport),
    pruneTokens: async (tokens) => {
      if (tokens.length === 0) return;
      await db.delete(deviceTokensTable).where(inArray(deviceTokensTable.token, tokens));
    },
    sendWeb: (userId, payload) => sendWebToUser(userId, payload, webDeps),
  };
}

/** Zero-config, best-effort push to all of a user's channels. */
export function pushToUser(userId: number, payload: PushPayload): Promise<void> {
  return bestEffortDispatch(userId, payload, buildDispatchDeps());
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @workspace/api-server typecheck`
Expected: no errors. (If `listSubscriptions` complains about the row type, it is the covariant full-row → `WebSubscription` assignment, which is allowed; no cast needed.)

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/lib/push-dispatch-live.ts
git commit -m "feat(push): db-backed dispatch deps and pushToUser entry point"
```

---

### Task 4: Wire the scheduler through `pushToUser`

**Files:**
- Modify: `artifacts/api-server/src/lib/notification-scheduler.ts` (imports; remove `getSubscriptions`/`removeSubscription`; rewrite `notify`)

**Interfaces:**
- Consumes: `pushToUser` from `./push-dispatch-live`.
- Produces: no new exports. `notify(userId, title, body, tag, data?)` keeps its signature; its single call site (`runEnvelopePass`, ~line 354) is unchanged.

- [ ] **Step 1: Update imports**

In `artifacts/api-server/src/lib/notification-scheduler.ts`:

- Remove `pushSubscriptionsTable` from the `@workspace/db` import (currently line 3):

  ```typescript
  // before
  db, tasksTable, usersTable, activityTable, pushSubscriptionsTable, focusSessionsTable,
  // after
  db, tasksTable, usersTable, activityTable, focusSessionsTable,
  ```

- Delete the line `import { sendPushNotification } from "./push-notifications";` (currently line 9).
- Add near the other `./` imports:

  ```typescript
  import { pushToUser } from "./push-dispatch-live";
  ```

- [ ] **Step 2: Remove the dead web helpers and rewrite `notify`**

Delete `getSubscriptions` (lines ~40–42) and `removeSubscription` (lines ~44–46) entirely. Replace the `notify` function (lines ~48–59) with:

```typescript
async function notify(userId: number, title: string, body: string, tag: string, data?: Record<string, unknown>) {
  await pushToUser(userId, { title, body, tag, ...(data ? { data } : {}) });
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @workspace/api-server typecheck`
Expected: no errors. (`eq` is still used elsewhere in the file; `pushSubscriptionsTable` now unused and removed.)

- [ ] **Step 4: Run the full suite**

Run: `pnpm --filter @workspace/api-server test`
Expected: PASS (all existing tests unchanged; there is no `notification-scheduler.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/notification-scheduler.ts
git commit -m "feat(push): route scheduler notify() through native+web pushToUser"
```

---

### Task 5: Wire the accountability nudge through `pushToUser`

**Files:**
- Modify: `artifacts/api-server/src/routes/accountability.ts` (imports; replace the web loop, ~lines 403–413)

**Interfaces:**
- Consumes: `pushToUser` from `../lib/push-dispatch-live`.
- Produces: no new exports.

- [ ] **Step 1: Update imports**

In `artifacts/api-server/src/routes/accountability.ts`:

- Remove `pushSubscriptionsTable` from the `@workspace/db` import (line 3):

  ```typescript
  // after
  import { db, usersTable, partnershipsTable, activityTable, tasksTable, allyNudgesTable } from "@workspace/db";
  ```

- Delete the line `import { sendPushNotification } from "../lib/push-notifications";` (line 10).
- Add:

  ```typescript
  import { pushToUser } from "../lib/push-dispatch-live";
  ```

- [ ] **Step 2: Replace the web loop**

Replace the subscription fetch + `for` loop (currently lines ~403–413, from `const subs = await db.select()...` through the loop's closing brace) with a single call. The surrounding code (`const [sender] = ...`, `const label = ...`, `const title = ...` above; `res.status(201).json(...)` below) stays:

```typescript
  await pushToUser(recipientId, { title, body: label, tag: `nudge-${kind}` });
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @workspace/api-server typecheck`
Expected: no errors. (`eq` and `db` remain used elsewhere in the file.)

- [ ] **Step 4: Run the full suite**

Run: `pnpm --filter @workspace/api-server test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/accountability.ts
git commit -m "feat(push): route accountability nudge through native+web pushToUser"
```

---

### Task 6: Wire the body-double invite through `pushToUser`

**Files:**
- Modify: `artifacts/api-server/src/routes/body-double.ts` (imports; replace the inner web loop, ~lines 83–93)

**Interfaces:**
- Consumes: `pushToUser` from `../lib/push-dispatch-live`.
- Produces: no new exports.

- [ ] **Step 1: Update imports**

In `artifacts/api-server/src/routes/body-double.ts`:

- Remove `pushSubscriptionsTable` from the multi-line `@workspace/db` import (line 3–...):

  ```typescript
  // before (line 4)
    db, usersTable, partnershipsTable, pushSubscriptionsTable, activityTable,
  // after
    db, usersTable, partnershipsTable, activityTable,
  ```

- Delete the line `import { sendPushNotification } from "../lib/push-notifications";` (line 10).
- Add (near the other `../lib/` imports):

  ```typescript
  import { pushToUser } from "../lib/push-dispatch-live";
  ```

- [ ] **Step 2: Replace the inner web loop**

Inside `sendRoomInvites`, keep the `for (const ally of allies)` loop and the `if (!shouldSendInvitePush(ally, now)) continue;` guard. Replace the subscription fetch + inner `for (const sub ...)` loop (currently lines ~83–93) with:

```typescript
    await pushToUser(ally.id, {
      title,
      body: "Drop in and work alongside",
      tag: "bodydouble-invite",
      data: { url: "/focus" },
    });
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @workspace/api-server typecheck`
Expected: no errors. (`logger`, `eq`, `db`, `inArray` remain used elsewhere in the file.)

- [ ] **Step 4: Run the full suite**

Run: `pnpm --filter @workspace/api-server test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/body-double.ts
git commit -m "feat(push): route body-double invite through native+web pushToUser"
```

---

### Task 7: Final verification and PR

**Files:** none (verification + PR only)

- [ ] **Step 1: Full typecheck + suite green**

Run: `pnpm --filter @workspace/api-server typecheck && pnpm --filter @workspace/api-server test`
Expected: typecheck clean; all tests pass (including the 4 new `push-dispatch` tests).

- [ ] **Step 2: Grep for leftover direct web-push usage**

Run: `git grep -n "sendPushNotification" -- artifacts/api-server/src`
Expected: matches ONLY in `lib/push-notifications.ts` (definition) and `lib/push-dispatch-live.ts` (the single wired consumer). No matches in `notification-scheduler.ts`, `routes/accountability.ts`, or `routes/body-double.ts`.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/native-push-fanout
gh pr create --base main --head feat/native-push-fanout \
  --title "feat(push): fan out notifications to native devices via dispatchToUser" \
  --body "Routes the scheduler, accountability nudge, and body-double invite through the existing dispatchToUser so iOS device_tokens receive the same pushes as web; collapses three duplicated web-push loops into one shared push-dispatch helper. Closes iOS device-track follow-up #3. Spec: docs/superpowers/specs/2026-08-12-native-push-fanout-design.md"
```

Expected: PR created into `main`; CI `check` runs green. Merge requires the owner's admin action (branch ruleset).

---

## Self-Review

**1. Spec coverage:**
- Shared seam / one push path → Tasks 1–3 (pure core + db wiring). ✓
- `sendWebToUser` (web loop lifted) → Task 1. ✓
- `buildDispatchDeps` (listExpoTokens `provider='expo'`, sendExpo via `expoHttpTransport`, pruneTokens, sendWeb) → Task 3. ✓
- `pushToUser` best-effort wrapper → Task 2 (`bestEffortDispatch`) + Task 3 (bound `pushToUser`). ✓
- Scheduler `notify` rewrite + dead-helper/import removal, claim/rollback left intact → Task 4. ✓
- Accountability call site → Task 5. ✓
- Body-double call site (keeps `shouldSendInvitePush`, `data.url`) → Task 6. ✓
- Decision 1 (`provider='expo'`) → Task 3 Step 1 + Global Constraints. ✓
- Decision 2 (best-effort/slot-stays-spent) → Task 2 + Global Constraints; rollback left unchanged in Task 4. ✓
- Decision 3 (transport hard-wired; optional deps for tests) → the plan makes deps a *required* param on the pure functions and binds them in `push-dispatch-live.ts`; tests inject fakes directly. Equivalent to the spec's optional-default, and cleaner given the file split. ✓
- Testing plan (sendWebToUser branching, pushToUser best-effort, reuse dispatchToUser/expo-push) → Tasks 1–2; reuse noted. ✓
- Rollout (no migration, one PR) → Task 7. ✓

No gaps.

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". Every code step shows full code; every command shows expected output. ✓

**3. Type consistency:** `WebSubscription`/`WebPushDeps`/`sendWebToUser`/`bestEffortDispatch`/`WebPushDeps` names are identical across Tasks 1–3. `DispatchDeps` matches the real interface in `device-dispatch.ts` (`listExpoTokens`, `sendExpo`, `pruneTokens`, `sendWeb`). `PushPayload` matches `push-notifications.ts` (`title`, `body`, `tag?`, `icon?`, `data?`). `pushToUser(userId, payload)` signature is consistent between Task 3 and the call sites in Tasks 4–6. ✓
