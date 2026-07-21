# Pocket Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add & complete quests from the iPhone home screen via two Apple Shortcuts backed by scoped `fqs_` personal-access tokens — no app launch, no login.

**Architecture:** A new `api_tokens` table (sha256-at-rest) + a default-deny token branch in `authMiddleware` that authenticates exactly three routes; two thin shortcut-facing endpoints (`/shortcuts/capture`, `/shortcuts/today`) whose logic lives in pure, unit-tested lib modules; completion reuses the existing `POST /tasks/:id/complete` verbatim. Session-only token-management routes + a reveal-once settings card in the account dialog.

**Tech Stack:** Express 5 (ESM, TS strict), drizzle-orm + Neon PG, vitest, OpenAPI (`lib/api-spec/openapi.yaml`) + orval codegen, React 19 + shadcn UI + TanStack Query.

**Spec:** `docs/superpowers/specs/2026-07-21-pocket-gate-design.md` (approved; D-numbers below refer to it).

## Global Constraints

- Branch: `feat/pocket-gate` (already created). Verify with `git branch --show-current` before every commit ([[feedback-guard-branch-before-commit]]).
- Token prefix is exactly `fqs_`; **plaintext tokens are never stored, logged, or exported** — only sha256 hex digests.
- Default-deny (D4): a shortcut token authenticates ONLY `POST /api/shortcuts/capture`, `GET /api/shortcuts/today`, `POST /api/tasks/{digits}/complete`. Everything else must remain 401 under token auth — especially `/shortcut-tokens` mint/list/revoke.
- Capture (D5): deterministic `parseQuickAdd` only — no AI calls; dateless → user's local today; `isAnchored` always `false`.
- Error envelope is the house `{ error: string }`; success payloads carry a notification-ready `message` where the recipes need one.
- Anti-shame copy is load-bearing: the empty today-list message is exactly `Nothing waiting on you today 🌤`.
- Never hand-edit generated files (`lib/api-client-react/src/generated/**`, `lib/api-zod/src/generated/**`) — only `pnpm --filter @workspace/api-spec codegen` may change them.
- No new dependencies anywhere.
- Repo lives under OneDrive — if git ever reports locked files, recover with `git reset --mixed`, never `--hard` ([[reference-onedrive-git-locks]]).
- All commands run from the repo root `C:\Users\Chadr\OneDrive\Documents\Quest-Companion` unless stated. End commit messages with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.

---

### Task 1: `api_tokens` schema + migration + account-data registry

**Files:**
- Create: `lib/db/src/schema/api-tokens.ts`
- Modify: `lib/db/src/schema/index.ts` (append one export line)
- Modify: `artifacts/api-server/src/lib/account-data.ts` (register table)
- Generated: `lib/db/drizzle/0005_pocket_gate.sql` + `lib/db/drizzle/meta/*` (via drizzle-kit — do not write by hand)
- Test: existing standing guard `artifacts/api-server/src/lib/account-data.test.ts` (no new test file — the guard drives this task)

**Interfaces:**
- Consumes: `usersTable` from `./users`.
- Produces: `apiTokensTable` with columns `id` (serial PK), `userId` (int, FK→users.id cascade), `tokenHash` (text, unique), `label` (text, nullable), `createdAt` (timestamp default now), `lastUsedAt` (timestamp nullable), `revokedAt` (timestamp nullable). Exported from `@workspace/db` and `@workspace/db/schema`.

- [ ] **Step 1: Write the schema file** — `lib/db/src/schema/api-tokens.ts`:

```ts
import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Pocket Gate: personal-access tokens for the iPhone Shortcuts flows.
// Only the sha256 hex digest of the secret is stored — the plaintext is shown
// once at mint and never persisted. Revocation is soft (revoked_at set), so
// the Settings list can show what existed and when it was last used.
export const apiTokensTable = pgTable(
  "api_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    label: text("label"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [index("idx_api_tokens_user").on(t.userId)],
);
```

- [ ] **Step 2: Export it** — append to `lib/db/src/schema/index.ts` (after the `./body-double` line):

```ts
export * from "./api-tokens";
```

- [ ] **Step 3: Run the standing guard to see it fail**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/account-data.test.ts`
Expected: FAIL — first guard test reports missing pair `api_tokens.user_id` (schema FK exists, registry entry doesn't).

- [ ] **Step 4: Register the table** — in `artifacts/api-server/src/lib/account-data.ts`, add `apiTokensTable` to the import list from `@workspace/db/schema`, and add this entry to `USER_DATA_TABLES` directly after the `push_subscriptions` line (references only `users`, so any position is FK-safe; keep it with the other infrastructure-ish tables):

```ts
  // Pocket Gate shortcut tokens: sha256 digests only — one-way, so exporting
  // them is harmless; deleting them here kills home-screen access with the account.
  { name: "api_tokens",         table: apiTokensTable,        userColumns: [apiTokensTable.userId] },
```

- [ ] **Step 5: Run the guard again to see it pass**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/account-data.test.ts`
Expected: PASS — all 4 tests (coverage, no-stale, unique names, topological order).

- [ ] **Step 6: Generate the migration**

Run: `pnpm --filter @workspace/db generate --name pocket_gate`
Expected: creates `lib/db/drizzle/0005_pocket_gate.sql` containing `CREATE TABLE "api_tokens"` with the unique `token_hash` constraint, the users FK (`ON DELETE cascade`), and `idx_api_tokens_user`; updates `lib/db/drizzle/meta/_journal.json`. Do NOT run `migrate` — the live Neon apply happens post-merge.

- [ ] **Step 7: Typecheck**

Run: `pnpm run typecheck`
Expected: clean exit.

- [ ] **Step 8: Commit**

```bash
git add lib/db/src/schema/api-tokens.ts lib/db/src/schema/index.ts lib/db/drizzle artifacts/api-server/src/lib/account-data.ts
git commit -m "feat(db): api_tokens table for Pocket Gate shortcut auth

Sha256-at-rest personal-access tokens; registered in USER_DATA_TABLES so
account delete/export cover it and the standing guard stays untouched.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: token lib — mint/hash, route whitelist, pure auth decision, cooldowns

**Files:**
- Create: `artifacts/api-server/src/lib/shortcut-token.ts`
- Create: `artifacts/api-server/src/lib/shortcut-cooldowns.ts`
- Test: `artifacts/api-server/src/lib/shortcut-token.test.ts`

**Interfaces:**
- Consumes: `createCooldown` from `./ai/breakdown-cooldown` (exists: `createCooldown(intervalMs): { tryAcquire(userId, nowMs?): boolean }`).
- Produces (Task 3/4/6 rely on these exact names):
  - `TOKEN_PREFIX = "fqs_"`
  - `mintTokenSecret(): { token: string; tokenHash: string }`
  - `hashTokenSecret(token: string): string` (sha256 hex)
  - `isShortcutToken(bearerValue: string): boolean`
  - `isShortcutRouteAllowed(method: string, path: string): boolean`
  - `evaluateShortcutAuth(input: { bearer: string; method: string; path: string; tokenRow: TokenRowLike | undefined; now?: Date }): ShortcutAuthDecision`
  - `LAST_USED_THROTTLE_MS = 3_600_000`
  - `captureCooldown`, `todayCooldown`, `mintCooldown` (Cooldown instances)

- [ ] **Step 1: Write the failing tests** — `artifacts/api-server/src/lib/shortcut-token.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  TOKEN_PREFIX, mintTokenSecret, hashTokenSecret, isShortcutToken,
  isShortcutRouteAllowed, evaluateShortcutAuth, LAST_USED_THROTTLE_MS,
} from "./shortcut-token";

describe("mintTokenSecret", () => {
  it("mints fqs_-prefixed 47-char base64url tokens with a matching sha256 hash", () => {
    const { token, tokenHash } = mintTokenSecret();
    expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(token).toHaveLength(4 + 43); // "fqs_" + base64url(32 bytes)
    expect(token.slice(4)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("never mints the same token twice", () => {
    const seen = new Set(Array.from({ length: 50 }, () => mintTokenSecret().token));
    expect(seen.size).toBe(50);
  });
});

describe("hashTokenSecret", () => {
  it("is deterministic sha256 hex", () => {
    expect(hashTokenSecret("fqs_abc")).toBe(hashTokenSecret("fqs_abc"));
    expect(hashTokenSecret("fqs_abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashTokenSecret("fqs_abc")).not.toBe(hashTokenSecret("fqs_abd"));
  });
});

describe("isShortcutToken", () => {
  it("recognizes the prefix and nothing else", () => {
    expect(isShortcutToken("fqs_xyz")).toBe(true);
    expect(isShortcutToken("sess-abc123")).toBe(false);
    expect(isShortcutToken("")).toBe(false);
  });
});

describe("isShortcutRouteAllowed (D4 default-deny)", () => {
  it.each([
    ["POST", "/api/shortcuts/capture"],
    ["GET", "/api/shortcuts/today"],
    ["POST", "/api/tasks/7/complete"],
    ["POST", "/api/tasks/12345/complete"],
  ])("allows %s %s", (method, path) => {
    expect(isShortcutRouteAllowed(method, path)).toBe(true);
  });

  it.each([
    ["GET", "/api/shortcuts/capture"],        // method mismatch
    ["POST", "/api/shortcuts/today"],         // method mismatch
    ["POST", "/api/tasks/7/uncomplete"],      // adjacent route
    ["POST", "/api/tasks/abc/complete"],      // non-numeric id
    ["POST", "/api/tasks/7/complete/extra"],  // suffix
    ["POST", "/api/shortcut-tokens"],         // mint must NEVER token-auth
    ["GET", "/api/shortcut-tokens"],
    ["DELETE", "/api/shortcut-tokens/1"],
    ["GET", "/api/me/export"],
    ["DELETE", "/api/me"],
    ["GET", "/api/tasks"],
    ["POST", "/api/tasks"],
  ])("denies %s %s", (method, path) => {
    expect(isShortcutRouteAllowed(method, path)).toBe(false);
  });
});

describe("evaluateShortcutAuth", () => {
  const now = new Date("2026-07-21T12:00:00Z");
  const activeRow = { revokedAt: null, lastUsedAt: null };
  const onCapture = { bearer: "fqs_x", method: "POST", path: "/api/shortcuts/capture" };

  it("passes through non-shortcut bearers untouched", () => {
    expect(evaluateShortcutAuth({ bearer: "sess-1", method: "POST", path: "/api/shortcuts/capture", tokenRow: undefined, now }))
      .toEqual({ kind: "not-a-shortcut-token" });
  });

  it("denies off-whitelist routes even with a valid token", () => {
    expect(evaluateShortcutAuth({ bearer: "fqs_x", method: "DELETE", path: "/api/me", tokenRow: activeRow, now }))
      .toEqual({ kind: "deny" });
  });

  it("denies unknown tokens", () => {
    expect(evaluateShortcutAuth({ ...onCapture, tokenRow: undefined, now })).toEqual({ kind: "deny" });
  });

  it("denies revoked tokens", () => {
    expect(evaluateShortcutAuth({ ...onCapture, tokenRow: { revokedAt: new Date("2026-07-20T00:00:00Z"), lastUsedAt: null }, now }))
      .toEqual({ kind: "deny" });
  });

  it("allows an active token on a whitelisted route, refreshing last-used when never used", () => {
    expect(evaluateShortcutAuth({ ...onCapture, tokenRow: activeRow, now }))
      .toEqual({ kind: "allow", refreshLastUsed: true });
  });

  it("throttles the last-used refresh to once an hour", () => {
    const recent = { revokedAt: null, lastUsedAt: new Date(now.getTime() - 5 * 60_000) };
    expect(evaluateShortcutAuth({ ...onCapture, tokenRow: recent, now }))
      .toEqual({ kind: "allow", refreshLastUsed: false });
    const stale = { revokedAt: null, lastUsedAt: new Date(now.getTime() - LAST_USED_THROTTLE_MS) };
    expect(evaluateShortcutAuth({ ...onCapture, tokenRow: stale, now }))
      .toEqual({ kind: "allow", refreshLastUsed: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/shortcut-token.test.ts`
Expected: FAIL — cannot resolve `./shortcut-token`.

- [ ] **Step 3: Write the implementation** — `artifacts/api-server/src/lib/shortcut-token.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";

/** Pocket Gate personal-access tokens: `fqs_` + base64url(32 random bytes). */
export const TOKEN_PREFIX = "fqs_";

export interface MintedSecret {
  /** Full plaintext token — shown to the user exactly once, never stored. */
  token: string;
  /** sha256 hex digest — the only form that touches the database. */
  tokenHash: string;
}

export function mintTokenSecret(): MintedSecret {
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { token, tokenHash: hashTokenSecret(token) };
}

export function hashTokenSecret(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isShortcutToken(bearerValue: string): boolean {
  return bearerValue.startsWith(TOKEN_PREFIX);
}

// Default-deny route whitelist (spec D4): a shortcut token authenticates
// exactly these requests and nothing else — in particular never the
// /shortcut-tokens management routes, so a leaked token cannot mint tokens.
// Matched against the app-level req.path, which includes the /api mount.
const WHITELIST: ReadonlyArray<{ method: string; path: RegExp }> = [
  { method: "POST", path: /^\/api\/shortcuts\/capture$/ },
  { method: "GET", path: /^\/api\/shortcuts\/today$/ },
  { method: "POST", path: /^\/api\/tasks\/\d+\/complete$/ },
];

export function isShortcutRouteAllowed(method: string, path: string): boolean {
  return WHITELIST.some((w) => w.method === method && w.path.test(path));
}

/** Subset of an api_tokens row the auth decision needs. */
export interface TokenRowLike {
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

export type ShortcutAuthDecision =
  | { kind: "not-a-shortcut-token" }
  /** Wrong route, unknown or revoked token — the request stays unauthenticated. */
  | { kind: "deny" }
  | { kind: "allow"; refreshLastUsed: boolean };

/** last_used_at is a freshness hint for the Settings list, not an audit log —
 * refresh at most hourly so token auth doesn't write on every tap. */
export const LAST_USED_THROTTLE_MS = 60 * 60 * 1000;

export function evaluateShortcutAuth(input: {
  bearer: string;
  method: string;
  path: string;
  tokenRow: TokenRowLike | undefined;
  now?: Date;
}): ShortcutAuthDecision {
  if (!isShortcutToken(input.bearer)) return { kind: "not-a-shortcut-token" };
  if (!isShortcutRouteAllowed(input.method, input.path)) return { kind: "deny" };
  const row = input.tokenRow;
  if (!row || row.revokedAt !== null) return { kind: "deny" };
  const nowMs = (input.now ?? new Date()).getTime();
  const refreshLastUsed =
    row.lastUsedAt === null || nowMs - row.lastUsedAt.getTime() >= LAST_USED_THROTTLE_MS;
  return { kind: "allow", refreshLastUsed };
}
```

And `artifacts/api-server/src/lib/shortcut-cooldowns.ts`:

```ts
import { createCooldown } from "./ai/breakdown-cooldown";

// Spec D8: per-user interval guards on the Pocket Gate surface, using the
// house cooldown primitive (one call per interval; in-memory, single-instance).
// Mint is anti-spam only — the 5-active-token cap is the real bound, and
// back-to-back "iPhone"/"iPad" mints must stay pleasant.
export const CAPTURE_COOLDOWN_MS = 6_000; // ~10/min
export const TODAY_COOLDOWN_MS = 2_000; // ~30/min
export const MINT_COOLDOWN_MS = 10_000;

export const captureCooldown = createCooldown(CAPTURE_COOLDOWN_MS);
export const todayCooldown = createCooldown(TODAY_COOLDOWN_MS);
export const mintCooldown = createCooldown(MINT_COOLDOWN_MS);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/shortcut-token.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/shortcut-token.ts artifacts/api-server/src/lib/shortcut-token.test.ts artifacts/api-server/src/lib/shortcut-cooldowns.ts
git commit -m "feat(api): shortcut-token lib — mint/hash, D4 route whitelist, pure auth decision, cooldowns

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: authMiddleware token branch

**Files:**
- Modify: `artifacts/api-server/src/middlewares/authMiddleware.ts`
- Test: none new — the decision logic was fully unit-tested in Task 2; this task only wires DB rows into it (house style: routes/middleware stay thin and untested, pure libs carry the coverage). Verification = typecheck + full existing suite + Task 9's live checks.

**Interfaces:**
- Consumes (Task 2): `isShortcutToken`, `isShortcutRouteAllowed`, `hashTokenSecret`, `evaluateShortcutAuth`. Consumes (Task 1): `apiTokensTable`.
- Produces: token-authenticated requests arrive at handlers exactly like session requests — `req.isAuthenticated()` true, `req.gameUserId` set, `req.user` synthesized. No handler changes needed anywhere.

- [ ] **Step 1: Add imports** at the top of `authMiddleware.ts`:

```ts
import { eq } from "drizzle-orm";
import { db, apiTokensTable, usersTable } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  evaluateShortcutAuth, hashTokenSecret, isShortcutRouteAllowed, isShortcutToken,
} from "../lib/shortcut-token";
```

(Check the file's existing imports first — it currently imports from `../lib/auth` only; add the new ones without disturbing those.)

- [ ] **Step 2: Add the branch.** In `authMiddleware`, immediately after the existing `const isBearerAuth = …` line (currently line ~67) and BEFORE `const sid = getSessionId(req);`, insert:

```ts
  // Pocket Gate (spec D4): an fqs_ bearer is a shortcut token, never a session
  // id. Handle it entirely here — valid tokens authenticate the three
  // whitelisted routes; everything else falls through unauthenticated and the
  // route's own isAuthenticated() check returns the usual 401.
  const bearer = isBearerAuth ? authHeader.slice(7) : undefined;
  if (bearer !== undefined && isShortcutToken(bearer)) {
    await applyShortcutTokenAuth(req, bearer);
    next();
    return;
  }
```

- [ ] **Step 3: Add the helper** below `refreshIfExpired` (module scope, same file):

```ts
async function applyShortcutTokenAuth(req: Request, bearer: string): Promise<void> {
  // Default-deny: off-whitelist requests never even touch the database.
  if (!isShortcutRouteAllowed(req.method, req.path)) return;

  const [row] = await db.select().from(apiTokensTable)
    .where(eq(apiTokensTable.tokenHash, hashTokenSecret(bearer)));
  const decision = evaluateShortcutAuth({
    bearer, method: req.method, path: req.path, tokenRow: row,
  });
  if (decision.kind !== "allow" || !row) return;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, row.userId));
  if (!user) return;

  // Same contract the session path produces; handlers only ever read gameUserId.
  req.user = {
    id: user.externalId ?? String(user.id),
    email: null,
    firstName: user.displayName ?? user.username,
    lastName: null,
    profileImageUrl: null,
  };
  req.gameUserId = user.id;

  if (decision.refreshLastUsed) {
    // Fire-and-forget: an hourly freshness marker isn't worth request latency.
    void (async () => {
      await db.update(apiTokensTable)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiTokensTable.id, row.id));
    })().catch((err) => logger.warn({ err }, "api token last_used update failed"));
  }
}
```

- [ ] **Step 4: Typecheck + full api-server suite (session-path regression)**

Run: `pnpm run typecheck && pnpm --filter @workspace/api-server test`
Expected: clean typecheck; every existing test still green.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/middlewares/authMiddleware.ts
git commit -m "feat(api): authMiddleware branch for fqs_ shortcut tokens (default-deny whitelist)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: token management routes (session-only)

**Files:**
- Create: `artifacts/api-server/src/routes/shortcut-tokens.ts`
- Modify: `artifacts/api-server/src/routes/index.ts` (import + `router.use` after `accountRouter`)
- Test: none new (thin routes; cap/label logic is trivial and the D4 tests already prove tokens can't reach these paths). Verification = typecheck + suite.

**Interfaces:**
- Consumes (Task 1): `apiTokensTable`. Consumes (Task 2): `mintTokenSecret`, `mintCooldown`.
- Produces (Task 7/8 rely on these shapes): `GET /api/shortcut-tokens` → `[{ id, label, createdAt, lastUsedAt }]` (active only, oldest first). `POST /api/shortcut-tokens` `{ label? }` → 201 `{ id, label, createdAt, token }` (`token` only ever here); 400 at cap with the exact copy below; 429 under cooldown. `DELETE /api/shortcut-tokens/:id` → `{ success: true }` (idempotent). `MAX_ACTIVE_TOKENS = 5` exported.

- [ ] **Step 1: Write the routes file** — `artifacts/api-server/src/routes/shortcut-tokens.ts`:

```ts
import { Router, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, apiTokensTable } from "@workspace/db";
import { mintTokenSecret } from "../lib/shortcut-token";
import { mintCooldown } from "../lib/shortcut-cooldowns";

const router: IRouter = Router();

export const MAX_ACTIVE_TOKENS = 5;
const MAX_LABEL_LEN = 60;

// Pocket Gate token management. Session-auth only BY CONSTRUCTION: these
// paths are off the D4 whitelist, so a shortcut token never authenticates
// here — a leaked token can capture and complete quests, nothing else.

router.get("/shortcut-tokens", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const rows = await db.select({
    id: apiTokensTable.id,
    label: apiTokensTable.label,
    createdAt: apiTokensTable.createdAt,
    lastUsedAt: apiTokensTable.lastUsedAt,
  }).from(apiTokensTable)
    .where(and(eq(apiTokensTable.userId, req.gameUserId), isNull(apiTokensTable.revokedAt)))
    .orderBy(apiTokensTable.createdAt);
  res.json(rows);
});

router.post("/shortcut-tokens", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  if (!mintCooldown.tryAcquire(userId)) {
    res.status(429).json({ error: "Slow down a moment before creating another token." });
    return;
  }

  const labelRaw = typeof req.body?.label === "string" ? req.body.label.trim() : "";
  const label = labelRaw.slice(0, MAX_LABEL_LEN) || "iPhone";

  const active = await db.select({ id: apiTokensTable.id }).from(apiTokensTable)
    .where(and(eq(apiTokensTable.userId, userId), isNull(apiTokensTable.revokedAt)));
  if (active.length >= MAX_ACTIVE_TOKENS) {
    res.status(400).json({ error: `You already have ${MAX_ACTIVE_TOKENS} active tokens — revoke one first.` });
    return;
  }

  const { token, tokenHash } = mintTokenSecret();
  const [row] = await db.insert(apiTokensTable).values({ userId, tokenHash, label }).returning();
  if (!row) { res.status(500).json({ error: "Token insert failed" }); return; }
  // The ONLY place plaintext ever leaves the server.
  res.status(201).json({ id: row.id, label: row.label, createdAt: row.createdAt, token });
});

router.delete("/shortcut-tokens/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw ?? "", 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // Idempotent: revoking an unknown or already-revoked id is a quiet success.
  await db.update(apiTokensTable).set({ revokedAt: new Date() })
    .where(and(
      eq(apiTokensTable.id, id),
      eq(apiTokensTable.userId, req.gameUserId),
      isNull(apiTokensTable.revokedAt),
    ));
  res.json({ success: true });
});

export default router;
```

- [ ] **Step 2: Register the router.** In `artifacts/api-server/src/routes/index.ts`, add `import shortcutTokensRouter from "./shortcut-tokens";` with the other imports and `router.use(shortcutTokensRouter);` directly after `router.use(accountRouter);`.

- [ ] **Step 3: Typecheck + suite**

Run: `pnpm run typecheck && pnpm --filter @workspace/api-server test`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/shortcut-tokens.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat(api): shortcut-token mint/list/revoke routes (session-only, 5-active cap, reveal-once)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: shortcuts lib — capture fields, messages, today payload

**Files:**
- Create: `artifacts/api-server/src/lib/shortcuts.ts`
- Test: `artifacts/api-server/src/lib/shortcuts.test.ts`

**Interfaces:**
- Consumes: `parseQuickAdd` from `@workspace/quick-add` (`(text, { now: Date }) => ParsedQuickAdd { title; dueDate?; dueTime?; priority?; category? }`); `assignPoints(title, priority)` → `{ points, category, … }` and `VALID_CATEGORIES: Set<string>` from `./auto-points`; `resolveTimeZone(tz)` and `localDateKey(instant, tz)` from `./date-buckets`.
- Produces (Task 6 relies on these exact names):
  - `CAPTURE_MAX_LEN = 500`, `TODAY_LIST_CAP = 25`, `ALL_CLEAR_MESSAGE = "Nothing waiting on you today 🌤"`
  - `buildCaptureFields(text: string, opts: { timezone: string | null; now: Date }): CaptureFields` where `CaptureFields = { title; dueDate; dueTime: string | null; priority; category; points; message }` (`dueDate` always a `YYYY-MM-DD` string)
  - `buildTodayPayload(rows: { id: number; title: string }[]): { count: number; message: string; quests: Record<string, number> }`

- [ ] **Step 1: Write the failing tests** — `artifacts/api-server/src/lib/shortcuts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  ALL_CLEAR_MESSAGE, TODAY_LIST_CAP, buildCaptureFields, buildTodayPayload,
} from "./shortcuts";

// 2026-07-21T03:00:00Z = 2026-07-20 22:00 in Chicago — the classic
// west-of-UTC evening where UTC "today" is the user's tomorrow.
const LATE_EVENING_UTC = new Date("2026-07-21T03:00:00Z");

describe("buildCaptureFields (spec D5)", () => {
  it("dates a dateless capture to the user's LOCAL today, not the UTC day", () => {
    const f = buildCaptureFields("buy milk", { timezone: "America/Chicago", now: LATE_EVENING_UTC });
    expect(f.dueDate).toBe("2026-07-20");
    expect(f.title).toBe("buy milk");
    expect(f.message).toBe("Added for today: “buy milk” ⚔️");
  });

  it("falls back to UTC when no timezone is stored", () => {
    const f = buildCaptureFields("buy milk", { timezone: null, now: LATE_EVENING_UTC });
    expect(f.dueDate).toBe("2026-07-21");
  });

  it("honors a parsed relative date, phrased relative to the local today", () => {
    const f = buildCaptureFields("call dentist tomorrow", { timezone: "America/Chicago", now: LATE_EVENING_UTC });
    expect(f.dueDate).toBe("2026-07-21"); // local tomorrow (local today is the 20th)
    expect(f.title).toBe("call dentist");
    expect(f.message).toBe("Added for tomorrow: “call dentist” ⚔️");
  });

  it("phrases dates beyond tomorrow with the weekday", () => {
    const f = buildCaptureFields("dentist friday", { timezone: "UTC", now: new Date("2026-07-21T12:00:00Z") });
    expect(f.dueDate).toBe("2026-07-24");
    expect(f.message).toBe("Added for Fri, Jul 24: “dentist” ⚔️");
  });

  it("keeps a parsed time", () => {
    const f = buildCaptureFields("standup tomorrow at 9am", { timezone: "UTC", now: new Date("2026-07-21T12:00:00Z") });
    expect(f.dueTime).toBe("09:00");
  });

  it("never anchors and always defaults priority to medium with auto points", () => {
    const f = buildCaptureFields("buy milk", { timezone: "UTC", now: LATE_EVENING_UTC });
    expect(f.priority).toBe("medium");
    expect(f.points).toBeGreaterThan(0);
    expect(f.category).toBeTruthy();
    expect("isAnchored" in f).toBe(false); // the route hardcodes isAnchored: false
  });

  it("uses the raw text as title if parsing strips everything", () => {
    const f = buildCaptureFields("tomorrow", { timezone: "UTC", now: new Date("2026-07-21T12:00:00Z") });
    expect(f.title.length).toBeGreaterThan(0);
  });
});

describe("buildTodayPayload (spec D6)", () => {
  it("returns the all-clear on empty — never an empty-sounding message", () => {
    expect(buildTodayPayload([])).toEqual({ count: 0, message: ALL_CLEAR_MESSAGE, quests: {} });
  });

  it("maps titles to ids preserving order", () => {
    const p = buildTodayPayload([{ id: 42, title: "Buy milk" }, { id: 57, title: "Email Sam" }]);
    expect(p.quests).toEqual({ "Buy milk": 42, "Email Sam": 57 });
    expect(p.count).toBe(2);
    expect(p.message).toBe("Pick a quest to mark done");
  });

  it("suffixes duplicate titles, dodging pre-existing ' (2)' collisions", () => {
    const p = buildTodayPayload([
      { id: 1, title: "Email Sam" },
      { id: 2, title: "Email Sam (2)" },
      { id: 3, title: "Email Sam" },
    ]);
    expect(p.quests["Email Sam"]).toBe(1);
    expect(p.quests["Email Sam (2)"]).toBe(2);
    expect(p.quests["Email Sam (3)"]).toBe(3);
    expect(Object.keys(p.quests)).toHaveLength(3);
  });

  it("caps at TODAY_LIST_CAP and says so", () => {
    const rows = Array.from({ length: TODAY_LIST_CAP + 1 }, (_, i) => ({ id: i + 1, title: `Quest ${i + 1}` }));
    const p = buildTodayPayload(rows);
    expect(p.count).toBe(TODAY_LIST_CAP);
    expect(Object.keys(p.quests)).toHaveLength(TODAY_LIST_CAP);
    expect(p.message).toBe(`Pick a quest to mark done (showing ${TODAY_LIST_CAP} of ${TODAY_LIST_CAP + 1})`);
  });
});
```

Note: the `"dentist friday"` and `"tomorrow at 9am"` expectations assume `parseQuickAdd`'s documented deterministic grammar (see `lib/quick-add/src/parse.test.ts`). If a phrase parses differently, fix the TEST's input phrase to one the parser supports (e.g. check that file for its exact "friday"/time fixtures) — do not change the lib to force it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/shortcuts.test.ts`
Expected: FAIL — cannot resolve `./shortcuts`.

- [ ] **Step 3: Write the implementation** — `artifacts/api-server/src/lib/shortcuts.ts`:

```ts
import { parseQuickAdd } from "@workspace/quick-add";
import { assignPoints, VALID_CATEGORIES } from "./auto-points";
import { localDateKey, resolveTimeZone } from "./date-buckets";

export const CAPTURE_MAX_LEN = 500;
export const TODAY_LIST_CAP = 25;
// Anti-shame: an empty list is an all-clear, never an emptiness.
export const ALL_CLEAR_MESSAGE = "Nothing waiting on you today 🌤";

export interface CaptureFields {
  title: string;
  /** Always set: the parsed date, else the user's local today (spec D5). */
  dueDate: string;
  dueTime: string | null;
  priority: string;
  category: string;
  points: number;
  /** Notification-ready confirmation for the Shortcut to display. */
  message: string;
}

/**
 * Insert-ready fields for a Pocket Gate capture. Deterministic parse only —
 * no LLM in the one-tap loop (spec D5) — anchored to the user's local
 * calendar so "tomorrow" and dateless captures land on the right day.
 */
export function buildCaptureFields(
  text: string,
  opts: { timezone: string | null; now: Date },
): CaptureFields {
  const tz = resolveTimeZone(opts.timezone);
  const todayKey = localDateKey(opts.now, tz);
  // Noon avoids DST edges — mirrors POST /tasks/parse.
  const parsed = parseQuickAdd(text, { now: new Date(`${todayKey}T12:00:00`) });
  const title = parsed.title || text.trim();
  const priority = parsed.priority ?? "medium";
  const auto = assignPoints(title, priority);
  const category =
    parsed.category && VALID_CATEGORIES.has(parsed.category) ? parsed.category : auto.category;
  const dueDate = parsed.dueDate ?? todayKey;
  return {
    title,
    dueDate,
    dueTime: parsed.dueTime ?? null,
    priority,
    category,
    points: auto.points,
    message: `Added ${dueDatePhrase(dueDate, todayKey)}: “${title}” ⚔️`,
  };
}

/** "for today" / "for tomorrow" / "for Fri, Jul 24" — phrased against the
 * user's local today, day math on UTC anchors so zones can't shift it. */
function dueDatePhrase(dueDate: string, todayKey: string): string {
  if (dueDate === todayKey) return "for today";
  const diffDays = Math.round(
    (Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / 86_400_000,
  );
  if (diffDays === 1) return "for tomorrow";
  const label = new Date(`${dueDate}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
  return `for ${label}`;
}

export interface TodayPayload {
  count: number;
  message: string;
  /** title → task id, shaped for Shortcuts' native Choose from List (spec D6). */
  quests: Record<string, number>;
}

export function buildTodayPayload(rows: { id: number; title: string }[]): TodayPayload {
  const capped = rows.slice(0, TODAY_LIST_CAP);
  const quests: Record<string, number> = {};
  for (const row of capped) {
    // Duplicate titles get " (2)"-style suffixes; the while-loop also dodges
    // rows whose real title already ends in " (2)".
    let key = row.title;
    for (let n = 2; Object.hasOwn(quests, key); n++) key = `${row.title} (${n})`;
    quests[key] = row.id;
  }
  const message =
    capped.length === 0
      ? ALL_CLEAR_MESSAGE
      : rows.length > TODAY_LIST_CAP
        ? `Pick a quest to mark done (showing ${TODAY_LIST_CAP} of ${rows.length})`
        : "Pick a quest to mark done";
  return { count: capped.length, message, quests };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/shortcuts.test.ts`
Expected: PASS. If the `"dentist friday"` / `"standup tomorrow at 9am"` cases fail on parser grammar, consult `lib/quick-add/src/parse.test.ts` for supported phrases and adjust the test inputs (only the inputs) accordingly.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/shortcuts.ts artifacts/api-server/src/lib/shortcuts.test.ts
git commit -m "feat(api): pocket-gate capture/today lib — tz-anchored dates, dedup dict, anti-shame copy

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: shortcut-facing routes

**Files:**
- Create: `artifacts/api-server/src/routes/shortcuts.ts`
- Modify: `artifacts/api-server/src/routes/index.ts` (import + `router.use` after `tasksRouter`)
- Test: none new (thin routes over the Task 5 lib). Verification = typecheck + suite.

**Interfaces:**
- Consumes (Task 5): `buildCaptureFields`, `buildTodayPayload`, `CAPTURE_MAX_LEN`. Consumes (Task 2): `captureCooldown`, `todayCooldown`. Consumes: `resolveTimeZone`, `localDateKey` from `../lib/date-buckets`; `db, tasksTable, usersTable` from `@workspace/db`.
- Produces (Task 7/recipes rely on): `POST /api/shortcuts/capture` `{ text }` → 201 `{ ok: true, id, title, dueDate, message }`; `GET /api/shortcuts/today` → 200 `{ count, message, quests }`. Both reachable via session or whitelisted token; completion stays on the existing `/tasks/:id/complete`.

- [ ] **Step 1: Write the routes file** — `artifacts/api-server/src/routes/shortcuts.ts`:

```ts
import { Router, type IRouter } from "express";
import { and, desc, eq, or } from "drizzle-orm";
import { db, tasksTable, usersTable } from "@workspace/db";
import { buildCaptureFields, buildTodayPayload, CAPTURE_MAX_LEN } from "../lib/shortcuts";
import { captureCooldown, todayCooldown } from "../lib/shortcut-cooldowns";
import { localDateKey, resolveTimeZone } from "../lib/date-buckets";

const router: IRouter = Router();

// Pocket Gate endpoints (spec §7): consumed by the two iPhone Shortcuts, not
// the web client. The middleware owns session-vs-token auth; these handlers
// only ever see isAuthenticated(). Completion deliberately has no endpoint
// here — the Shortcut calls the real POST /tasks/:id/complete (spec D7).

router.post("/shortcuts/capture", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) { res.status(400).json({ error: "text is required" }); return; }
  if (text.length > CAPTURE_MAX_LEN) { res.status(400).json({ error: "text is too long" }); return; }
  if (!captureCooldown.tryAcquire(userId)) {
    res.status(429).json({ error: "Slow down a moment before capturing again." });
    return;
  }

  const [user] = await db.select({ timezone: usersTable.timezone }).from(usersTable)
    .where(eq(usersTable.id, userId));
  const fields = buildCaptureFields(text, { timezone: user?.timezone ?? null, now: new Date() });

  const [task] = await db.insert(tasksTable).values({
    userId,
    title: fields.title,
    points: fields.points,
    dueDate: fields.dueDate,
    dueTime: fields.dueTime,
    priority: fields.priority,
    category: fields.category,
    isAnchored: false, // D5: capture never auto-anchors
    questlineId: null,
  }).returning();
  if (!task) { res.status(500).json({ error: "Task insert failed" }); return; }

  res.status(201).json({
    ok: true, id: task.id, title: task.title, dueDate: task.dueDate, message: fields.message,
  });
});

router.get("/shortcuts/today", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  if (!todayCooldown.tryAcquire(userId)) {
    res.status(429).json({ error: "Slow down a moment." });
    return;
  }

  const [user] = await db.select({ timezone: usersTable.timezone }).from(usersTable)
    .where(eq(usersTable.id, userId));
  const tz = resolveTimeZone(user?.timezone);
  const todayKey = localDateKey(new Date(), tz);

  // Same buckets as the app's today view (GET /tasks?date=…): quests dated
  // local-today plus incomplete anchored quests, incomplete only, app order.
  const rows = await db.select({ id: tasksTable.id, title: tasksTable.title }).from(tasksTable)
    .where(and(
      eq(tasksTable.userId, userId),
      eq(tasksTable.completed, false),
      or(eq(tasksTable.dueDate, todayKey), eq(tasksTable.isAnchored, true)),
    ))
    .orderBy(desc(tasksTable.isAnchored), desc(tasksTable.createdAt));

  res.json(buildTodayPayload(rows));
});

export default router;
```

- [ ] **Step 2: Register the router.** In `routes/index.ts`, add `import shortcutsRouter from "./shortcuts";` and `router.use(shortcutsRouter);` directly after `router.use(tasksRouter);` (no path overlap with tasksRouter — `/shortcuts/*` is its own namespace).

- [ ] **Step 3: Typecheck + suite**

Run: `pnpm run typecheck && pnpm --filter @workspace/api-server test`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/shortcuts.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat(api): /shortcuts/capture + /shortcuts/today endpoints for the Pocket Gate recipes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: OpenAPI paths + codegen

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (5 paths + 6 schemas)
- Generated (commit, never hand-edit): `lib/api-client-react/src/generated/**`, `lib/api-zod/src/generated/**`
- Test: none — codegen + typecheck are the verification.

**Interfaces:**
- Consumes: response/request shapes exactly as produced by Tasks 4 & 6.
- Produces (Task 8 relies on these generated names, from the operationIds): `useListShortcutTokens`, `useMintShortcutToken`, `useRevokeShortcutToken`, `getListShortcutTokensQueryKey` from `@workspace/api-client-react`, plus `ShortcutTokenSummary`, `ShortcutTokenMinted` types.

- [ ] **Step 1: Add the paths.** In `lib/api-spec/openapi.yaml`, after the `/me:` path block (ends near line 1990), insert — matching the file's exact indentation (2-space, paths at top level):

```yaml
  /shortcut-tokens:
    get:
      operationId: listShortcutTokens
      tags: [shortcuts]
      summary: List active Pocket Gate tokens (metadata only, never hashes)
      responses:
        "200":
          description: Active tokens, oldest first
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/ShortcutTokenSummary"
    post:
      operationId: mintShortcutToken
      tags: [shortcuts]
      summary: Mint a Pocket Gate token — plaintext returned exactly once
      requestBody:
        required: false
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/MintShortcutTokenRequest"
      responses:
        "201":
          description: Minted; `token` appears only in this response
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ShortcutTokenMinted"

  /shortcut-tokens/{id}:
    delete:
      operationId: revokeShortcutToken
      tags: [shortcuts]
      summary: Revoke a Pocket Gate token (idempotent)
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Revoked (or was already gone)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SuccessEnvelope"

  /shortcuts/capture:
    post:
      operationId: shortcutCapture
      tags: [shortcuts]
      summary: One-tap quest capture from the iPhone Shortcut (token or session auth)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/ShortcutCaptureRequest"
      responses:
        "201":
          description: Quest created; `message` is notification-ready
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ShortcutCaptureResponse"

  /shortcuts/today:
    get:
      operationId: shortcutToday
      tags: [shortcuts]
      summary: Today's open quests as a title→id dictionary for Choose from List
      responses:
        "200":
          description: Dated-today plus incomplete anchored quests, capped at 25
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ShortcutTodayPayload"
```

- [ ] **Step 2: Add the schemas.** In `components: schemas:` (alphabetical-ish placement near the other S-names is fine — follow neighbors):

```yaml
    ShortcutTokenSummary:
      type: object
      required: [id, label, createdAt, lastUsedAt]
      properties:
        id:
          type: integer
        label:
          type: [string, 'null']
        createdAt:
          type: string
          format: date-time
        lastUsedAt:
          type: [string, 'null']
          format: date-time
    MintShortcutTokenRequest:
      type: object
      properties:
        label:
          type: string
          maxLength: 60
    ShortcutTokenMinted:
      type: object
      required: [id, label, createdAt, token]
      properties:
        id:
          type: integer
        label:
          type: [string, 'null']
        createdAt:
          type: string
          format: date-time
        token:
          type: string
          description: Full fqs_ secret — shown exactly once, store it in the Shortcut.
    ShortcutCaptureRequest:
      type: object
      required: [text]
      properties:
        text:
          type: string
          maxLength: 500
    ShortcutCaptureResponse:
      type: object
      required: [ok, id, title, dueDate, message]
      properties:
        ok:
          type: boolean
        id:
          type: integer
        title:
          type: string
        dueDate:
          type: string
        message:
          type: string
    ShortcutTodayPayload:
      type: object
      required: [count, message, quests]
      properties:
        count:
          type: integer
        message:
          type: string
        quests:
          type: object
          additionalProperties:
            type: integer
          description: Quest title → task id, duplicate titles suffixed " (2)".
```

- [ ] **Step 3: Run codegen**

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: orval regenerates `lib/api-client-react/src/generated/**` and `lib/api-zod/src/generated/**` including `useListShortcutTokens` / `useMintShortcutToken` / `useRevokeShortcutToken`; the chained `typecheck:libs` passes.

- [ ] **Step 4: Verify the generated hook names** (Task 8 depends on them)

Run: `grep -n "ListShortcutTokens\|MintShortcutToken\|RevokeShortcutToken" lib/api-client-react/src/generated/api.ts | head -20`
Expected: hook + query-key exports present. Note the exact names if they differ and use those in Task 8.

- [ ] **Step 5: Full typecheck**

Run: `pnpm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react/src lib/api-zod/src
git commit -m "feat(api-spec): pocket-gate endpoints + generated clients

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: settings card, set-up guide, ops runbook

**Files:**
- Create: `artifacts/focusquest/src/components/shortcut-tokens-card.tsx`
- Modify: `artifacts/focusquest/src/components/account-dialog.tsx` (render the card between the export section and the danger zone)
- Create: `docs/ops/pocket-gate.md`
- Test: none new — the card is thin UI over generated hooks (house pattern: no component tests; pure web logic would live in `src/lib/`, and this card has none worth extracting).

**Interfaces:**
- Consumes (Task 7): `useListShortcutTokens`, `useMintShortcutToken`, `useRevokeShortcutToken`, `getListShortcutTokensQueryKey` from `@workspace/api-client-react` (confirm exact names against the generated file per Task 7 Step 4); shadcn `Button`, `Input`, `useToast` — same imports the account dialog already uses.
- Produces: `<ShortcutTokensCard />`.

- [ ] **Step 1: Write the card** — `artifacts/focusquest/src/components/shortcut-tokens-card.tsx`:

```tsx
import { useState } from "react";
import { Smartphone, Copy, Check } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListShortcutTokens, useMintShortcutToken, useRevokeShortcutToken,
  getListShortcutTokensQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

/** Pocket Gate: mint/revoke the fqs_ tokens the two iPhone Shortcuts use.
 * Reveal-once by design — the server only stores a hash, so the token is
 * copyable exactly while this panel is open. Plain copy, no dark patterns. */
export function ShortcutTokensCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const tokens = useListShortcutTokens();
  const mint = useMintShortcutToken();
  const revoke = useRevokeShortcutToken();
  const [label, setLabel] = useState("");
  const [minted, setMinted] = useState<{ label: string | null; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState<number | null>(null);

  const refetchList = () =>
    queryClient.invalidateQueries({ queryKey: getListShortcutTokensQueryKey() });

  async function onMint() {
    try {
      const res = await mint.mutateAsync({ data: { label: label.trim() || "iPhone" } });
      setMinted({ label: res.label, token: res.token });
      setCopied(false);
      setLabel("");
      await refetchList();
    } catch {
      toast({ title: "Couldn't create the token", variant: "destructive" });
    }
  }

  async function onCopy(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      toast({ title: "Token copied — paste it into your Shortcut" });
    } catch {
      toast({ title: "Couldn't copy — long-press the token text instead", variant: "destructive" });
    }
  }

  async function onRevoke(id: number) {
    try {
      await revoke.mutateAsync({ id });
      setConfirmRevokeId(null);
      await refetchList();
      toast({ title: "Token revoked" });
    } catch {
      toast({ title: "Couldn't revoke the token", variant: "destructive" });
    }
  }

  const base = window.location.origin;

  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold text-foreground flex items-center gap-2">
        <Smartphone className="w-4 h-4" /> Home Screen Shortcuts
      </div>
      <p className="text-xs text-muted-foreground">
        Add and complete quests from your iPhone home screen — no login, no waiting for
        the app. A token can only capture and complete quests; revoke it here any time.
      </p>

      {minted ? (
        <div className="rounded-lg border border-primary/40 p-2 space-y-1.5">
          <p className="text-xs font-medium">
            “{minted.label ?? "iPhone"}” created — this is the only time it's shown:
          </p>
          <code className="block text-[11px] break-all bg-muted rounded p-1.5">{minted.token}</code>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onCopy(minted.token)}>
              {copied ? <Check className="w-3.5 h-3.5 mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
              {copied ? "Copied" : "Copy token"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setMinted(null)}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (iPhone)"
            aria-label="Token label"
            className="h-8 text-sm"
          />
          <Button variant="outline" size="sm" onClick={onMint} disabled={mint.isPending}>
            {mint.isPending ? "Creating…" : "Create token"}
          </Button>
        </div>
      )}

      {(tokens.data ?? []).length > 0 && (
        <ul className="space-y-1">
          {(tokens.data ?? []).map((t) => (
            <li key={t.id} className="flex items-center justify-between text-xs gap-2">
              <span className="truncate">
                {t.label ?? "Token"}
                <span className="text-muted-foreground">
                  {" · "}
                  {t.lastUsedAt ? `used ${new Date(t.lastUsedAt).toLocaleDateString()}` : "never used"}
                </span>
              </span>
              {confirmRevokeId === t.id ? (
                <span className="flex gap-1 shrink-0">
                  <Button variant="destructive" size="sm" className="h-6 px-2 text-xs" onClick={() => onRevoke(t.id)} disabled={revoke.isPending}>
                    Revoke
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setConfirmRevokeId(null)}>
                    Keep
                  </Button>
                </span>
              ) : (
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs shrink-0 text-muted-foreground" onClick={() => setConfirmRevokeId(t.id)}>
                  Revoke…
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground select-none">
          Set-up guide (build the two Shortcuts, ~3 min)
        </summary>
        <div className="mt-1.5 space-y-2 text-muted-foreground">
          <p className="font-medium text-foreground">“New Quest” — in the Shortcuts app, add:</p>
          <ol className="list-decimal ml-4 space-y-0.5">
            <li>Ask for Input (Text) — prompt: “What's the quest?”</li>
            <li>
              Get Contents of URL — <code className="break-all">{base}/api/shortcuts/capture</code>,
              Method POST, Header <code>Authorization</code> = <code>Bearer &lt;your token&gt;</code>,
              Request Body JSON: <code>text</code> = Provided Input
            </li>
            <li>Get Dictionary Value — key <code>message</code></li>
            <li>Show Notification — the Dictionary Value</li>
          </ol>
          <p className="font-medium text-foreground">“Quest Done” — add:</p>
          <ol className="list-decimal ml-4 space-y-0.5">
            <li>
              Get Contents of URL — <code className="break-all">{base}/api/shortcuts/today</code>,
              Method GET, same Authorization header
            </li>
            <li>Get Dictionary Value — key <code>quests</code>, then Choose from List</li>
            <li>Get Dictionary Value — the Chosen Item's key in <code>quests</code> (this is the quest id)</li>
            <li>
              Get Contents of URL — <code className="break-all">{base}/api/tasks/</code>[id]<code>/complete</code>,
              Method POST, same header, Request Body JSON (empty)
            </li>
            <li>Get Dictionary Value — key <code>pointsAwarded</code></li>
            <li>Show Notification — “Quest complete! +[value] XP”</li>
          </ol>
          <p>
            Then long-press your home screen → add the <span className="text-foreground">Shortcuts widget</span> and
            pick both. They also work from the Lock Screen, Control Center, the Action Button, and
            “Hey Siri, New Quest”.
          </p>
        </div>
      </details>
    </div>
  );
}
```

- [ ] **Step 2: Mount it.** In `account-dialog.tsx`: `import { ShortcutTokensCard } from "@/components/shortcut-tokens-card";` and render `<ShortcutTokensCard />` between the export `</div>` and the danger-zone `<div …border-destructive…>`.

- [ ] **Step 3: Write the ops runbook** — `docs/ops/pocket-gate.md`:

```markdown
# Pocket Gate — ops notes

iPhone home-screen quick actions: Apple Shortcuts → `fqs_` tokens → three
whitelisted routes. Spec: `docs/superpowers/specs/2026-07-21-pocket-gate-design.md`.

## Surface

| Call | Auth | Notes |
|---|---|---|
| `POST /api/shortcut-tokens` `{label?}` | session only | 201; plaintext `token` in this response only; cap 5 active |
| `GET /api/shortcut-tokens` | session only | metadata, never hashes |
| `DELETE /api/shortcut-tokens/:id` | session only | idempotent revoke |
| `POST /api/shortcuts/capture` `{text}` | token or session | deterministic parse, dateless → local today, never anchored |
| `GET /api/shortcuts/today` | token or session | `{count, message, quests: {title→id}}`, cap 25 |
| `POST /api/tasks/:id/complete` | token or session | the app's real completion route, whitelisted for tokens |

A token authenticates ONLY those last three calls (default-deny in
authMiddleware). Storage is sha256-only: `select token_hash from api_tokens`
can never leak a usable secret.

## Smoke test (PowerShell, after deploy)

Mint a token in the app UI (account dialog → Home Screen Shortcuts), then:

    $h = @{ Authorization = "Bearer fqs_…" }
    Invoke-RestMethod -Method Post -Uri "https://<app-domain>/api/shortcuts/capture" -Headers $h -ContentType "application/json" -Body '{"text":"pocket gate smoke test"}'
    Invoke-RestMethod -Uri "https://<app-domain>/api/shortcuts/today" -Headers $h
    # complete the smoke-test quest with the id from either response:
    Invoke-RestMethod -Method Post -Uri "https://<app-domain>/api/tasks/<id>/complete" -Headers $h -ContentType "application/json" -Body '{}'
    # default-deny proof — MUST return 401:
    Invoke-RestMethod -Uri "https://<app-domain>/api/shortcut-tokens" -Headers $h

## Recipes

The user-facing set-up guide lives in the app (account dialog → Set-up guide);
the same steps are in the spec §10. Rate limits: capture 6s, today 2s, mint 10s
per user (in-memory, reset on deploy). Revocation is immediate.
```

- [ ] **Step 4: Typecheck + web suite**

Run: `pnpm run typecheck && pnpm --filter @workspace/focusquest test`
Expected: clean; existing web tests green.

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/components/shortcut-tokens-card.tsx artifacts/focusquest/src/components/account-dialog.tsx docs/ops/pocket-gate.md
git commit -m "feat(web): Home Screen Shortcuts card — reveal-once mint, revoke, in-app recipe guide

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: workspace verification (run by the orchestrator, not a subagent)

- [ ] **Step 1:** `pnpm run typecheck` — clean.
- [ ] **Step 2:** `pnpm --filter @workspace/api-server test` and `pnpm --filter @workspace/focusquest test` and `pnpm --filter @workspace/quick-add test` (if script exists) — all green; note the totals.
- [ ] **Step 3:** `pnpm run build` — clean production build.
- [ ] **Step 4:** Commit the spec + plan docs; push; open the PR (see spec §15); run the house code review; fix findings; merge.
- [ ] **Step 5:** Post-merge: `pnpm --filter @workspace/db migrate` against Neon (watch the `.env` export gotcha, [[reference-dev-commands]]), confirm Render deploy, run the `docs/ops/pocket-gate.md` smoke test with a real minted token.
