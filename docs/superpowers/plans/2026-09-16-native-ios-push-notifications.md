# Native iOS Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the server's existing "One Voice" push notifications to the native iOS app via direct APNs, with deep-link tap routing.

**Architecture:** Add a server-side APNs HTTP/2 transport (token/.p8 auth) mirroring the existing Expo transport, wire it into the per-channel `dispatchToUser` fan-out, and stamp a deep-link `data.target` onto each payload from a central kind→route table. On iOS, register an APNs token via `POST /devices`, and route notification taps to the matching screen through a deep-link coordinator.

**Tech Stack:** TypeScript / Express / Vitest / Drizzle (server); Swift / SwiftUI / UserNotifications / UIKit adaptor (iOS). `jsonwebtoken` + Node `http2` for APNs.

**Spec:** `docs/superpowers/specs/2026-09-16-native-ios-push-notifications-design.md`

## Global Constraints

- **pnpm only** — `npm`/`yarn` blocked by root preinstall guard.
- **Game logic stays server-side**; iOS renders/handles API-computed state.
- **Ships as one cross-surface unit** (server + iOS) per `CLAUDE.md`.
- **Drizzle migrations** must commit `meta/_journal.json` + snapshot alongside the `.sql`.
- **Transports never throw** — return one receipt per message so the dispatcher can prune dead tokens.
- **APNs no-ops when unconfigured** (env vars absent) so dev/CI stay green.
- Server tests: `pnpm --filter ./artifacts/api-server test`. Typecheck: `pnpm run typecheck`.
- iOS build: `cd ios && xcodebuild -project FocusQuest.xcodeproj -scheme FocusQuest -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build` (16 Pro sim is not installed; 17 Pro is).

---

### Task 1: APNs message-building pure functions

**Files:**
- Create: `artifacts/api-server/src/lib/apns-push.ts`
- Test: `artifacts/api-server/src/lib/apns-push.test.ts`

**Interfaces:**
- Consumes: `PushPayload` from `./push-notifications` (`{ title: string; body: string; data?: Record<string, unknown> }`).
- Produces:
  - `interface ApnsRequest { token: string; headers: Record<string,string>; body: string }`
  - `type ApnsReceipt = { status: "ok" } | { status: "error"; reason?: string }`
  - `type ApnsTransport = (requests: ApnsRequest[]) => Promise<ApnsReceipt[]>`
  - `buildApnsRequests(tokens: string[], payload: PushPayload, bundleId: string): ApnsRequest[]`
  - `deadTokensFromApnsReceipts(tokens: string[], receipts: ApnsReceipt[]): string[]`
  - `sendApnsPush(requests: ApnsRequest[], transport: ApnsTransport): Promise<ApnsReceipt[]>`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { buildApnsRequests, deadTokensFromApnsReceipts, sendApnsPush } from "./apns-push";

const payload = { title: "T", body: "B", data: { target: { screen: "focus" } } };

describe("buildApnsRequests", () => {
  it("maps each token to an APNs request with aps alert + data merged", () => {
    const [req] = buildApnsRequests(["TOKA"], payload, "app.focusquest");
    expect(req.token).toBe("TOKA");
    expect(req.headers["apns-topic"]).toBe("app.focusquest");
    expect(req.headers["apns-push-type"]).toBe("alert");
    expect(JSON.parse(req.body)).toEqual({
      aps: { alert: { title: "T", body: "B" }, sound: "default" },
      target: { screen: "focus" },
    });
  });

  it("returns an empty array for no tokens", () => {
    expect(buildApnsRequests([], payload, "app.focusquest")).toEqual([]);
  });
});

describe("deadTokensFromApnsReceipts", () => {
  it("returns tokens whose receipt is a permanent unregistered/bad-token error", () => {
    const receipts = [
      { status: "ok" as const },
      { status: "error" as const, reason: "Unregistered" },
      { status: "error" as const, reason: "BadDeviceToken" },
      { status: "error" as const, reason: "TooManyRequests" },
    ];
    expect(deadTokensFromApnsReceipts(["A", "B", "C", "D"], receipts)).toEqual(["B", "C"]);
  });
});

describe("sendApnsPush", () => {
  it("returns [] without calling transport when there are no requests", async () => {
    let called = false;
    const t = async () => { called = true; return []; };
    expect(await sendApnsPush([], t)).toEqual([]);
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ./artifacts/api-server test -- apns-push`
Expected: FAIL — cannot find module `./apns-push`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { PushPayload } from "./push-notifications";

export interface ApnsRequest {
  token: string;
  headers: Record<string, string>;
  body: string;
}

export type ApnsReceipt = { status: "ok" } | { status: "error"; reason?: string };
export type ApnsTransport = (requests: ApnsRequest[]) => Promise<ApnsReceipt[]>;

// Apple reasons that mean "this token will never work again" → prune it.
const DEAD_REASONS = new Set(["Unregistered", "BadDeviceToken", "DeviceTokenNotForTopic"]);

export function buildApnsRequests(
  tokens: string[],
  payload: PushPayload,
  bundleId: string,
): ApnsRequest[] {
  return tokens.map((token) => ({
    token,
    headers: {
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
    },
    body: JSON.stringify({
      aps: { alert: { title: payload.title, body: payload.body }, sound: "default" },
      ...(payload.data ?? {}),
    }),
  }));
}

export function deadTokensFromApnsReceipts(
  tokens: string[],
  receipts: ApnsReceipt[],
): string[] {
  const dead: string[] = [];
  receipts.forEach((r, i) => {
    if (r.status === "error" && r.reason && DEAD_REASONS.has(r.reason) && tokens[i]) {
      dead.push(tokens[i]);
    }
  });
  return dead;
}

export async function sendApnsPush(
  requests: ApnsRequest[],
  transport: ApnsTransport,
): Promise<ApnsReceipt[]> {
  if (requests.length === 0) return [];
  return transport(requests);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter ./artifacts/api-server test -- apns-push`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/apns-push.ts artifacts/api-server/src/lib/apns-push.test.ts
git commit -m "feat(api): APNs message-building + dead-token detection (pure)"
```

---

### Task 2: APNs provider JWT + default HTTP/2 transport

**Files:**
- Modify: `artifacts/api-server/src/lib/apns-push.ts`
- Test: `artifacts/api-server/src/lib/apns-push.test.ts` (extend)

**Interfaces:**
- Consumes: `ApnsRequest`, `ApnsReceipt`, `ApnsTransport` from Task 1.
- Produces:
  - `interface ApnsConfig { authKey: string; keyId: string; teamId: string; bundleId: string; environment: "sandbox" | "production" }`
  - `apnsConfigFromEnv(env?: NodeJS.ProcessEnv): ApnsConfig | null` — returns null if any required var is missing.
  - `buildProviderJwt(cfg: ApnsConfig, nowSec: number): string` — ES256 JWT, header `{alg:"ES256",kid}`, claims `{iss:teamId,iat}`.
  - `apnsHttpTransport(cfg: ApnsConfig): ApnsTransport` — sends over Node `http2` to the host implied by `cfg.environment`; never throws (maps network failure to `{status:"error"}`).
  - `apnsHost(environment): string` — `api.sandbox.push.apple.com` | `api.push.apple.com`.

**Interface note:** `jsonwebtoken` is already a server dependency (used by auth). Confirm with `grep '"jsonwebtoken"' artifacts/api-server/package.json`; if absent, add it (`pnpm --filter ./artifacts/api-server add jsonwebtoken` + `-D @types/jsonwebtoken`) as Step 0 of this task.

- [ ] **Step 1: Write the failing test**

```typescript
import jwt from "jsonwebtoken";
import { apnsConfigFromEnv, buildProviderJwt, apnsHost } from "./apns-push";

// A throwaway EC P-256 private key for signing in tests only.
const TEST_P8 = process.env.TEST_APNS_P8 ?? ""; // set in test via generated key (see below)

describe("apnsConfigFromEnv", () => {
  it("returns null when a required var is missing", () => {
    expect(apnsConfigFromEnv({ APNS_KEY_ID: "K" } as NodeJS.ProcessEnv)).toBeNull();
  });
  it("builds a config when all vars present", () => {
    const cfg = apnsConfigFromEnv({
      APNS_AUTH_KEY: "KEY", APNS_KEY_ID: "K1", APNS_TEAM_ID: "T1",
      APNS_BUNDLE_ID: "app.fq", APNS_ENV: "production",
    } as NodeJS.ProcessEnv);
    expect(cfg).toEqual({
      authKey: "KEY", keyId: "K1", teamId: "T1", bundleId: "app.fq", environment: "production",
    });
  });
});

describe("apnsHost", () => {
  it("selects sandbox vs production", () => {
    expect(apnsHost("sandbox")).toBe("api.sandbox.push.apple.com");
    expect(apnsHost("production")).toBe("api.push.apple.com");
  });
});

describe("buildProviderJwt", () => {
  it("signs an ES256 token with kid header and teamId issuer", () => {
    // Generate an EC key at test time so no secret is committed.
    const { generateKeyPairSync } = require("node:crypto");
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    const cfg = { authKey: pem, keyId: "KID9", teamId: "TEAM7", bundleId: "app.fq", environment: "sandbox" as const };
    const token = buildProviderJwt(cfg, 1_700_000_000);
    const decoded = jwt.decode(token, { complete: true }) as any;
    expect(decoded.header.alg).toBe("ES256");
    expect(decoded.header.kid).toBe("KID9");
    expect(decoded.payload.iss).toBe("TEAM7");
    expect(decoded.payload.iat).toBe(1_700_000_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ./artifacts/api-server test -- apns-push`
Expected: FAIL — `apnsConfigFromEnv`/`buildProviderJwt`/`apnsHost` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `apns-push.ts`)

```typescript
import jwt from "jsonwebtoken";
import http2 from "node:http2";

export interface ApnsConfig {
  authKey: string;
  keyId: string;
  teamId: string;
  bundleId: string;
  environment: "sandbox" | "production";
}

export function apnsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ApnsConfig | null {
  const authKey = env.APNS_AUTH_KEY, keyId = env.APNS_KEY_ID, teamId = env.APNS_TEAM_ID;
  const bundleId = env.APNS_BUNDLE_ID, environment = env.APNS_ENV;
  if (!authKey || !keyId || !teamId || !bundleId) return null;
  if (environment !== "sandbox" && environment !== "production") return null;
  return { authKey, keyId, teamId, bundleId, environment };
}

export function apnsHost(environment: "sandbox" | "production"): string {
  return environment === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
}

export function buildProviderJwt(cfg: ApnsConfig, nowSec: number): string {
  return jwt.sign({ iss: cfg.teamId, iat: nowSec }, cfg.authKey, {
    algorithm: "ES256",
    header: { alg: "ES256", kid: cfg.keyId },
  });
}

// Provider JWT is reusable up to ~60 min; re-sign at 40 min. Cached per config.
let cachedJwt: { token: string; expiresSec: number } | null = null;
function providerJwt(cfg: ApnsConfig): string {
  const nowSec = Math.floor(Date.now() / 1000);
  if (cachedJwt && cachedJwt.expiresSec > nowSec) return cachedJwt.token;
  const token = buildProviderJwt(cfg, nowSec);
  cachedJwt = { token, expiresSec: nowSec + 40 * 60 };
  return token;
}

export function apnsHttpTransport(cfg: ApnsConfig): ApnsTransport {
  return async (requests) => {
    if (requests.length === 0) return [];
    const client = http2.connect(`https://${apnsHost(cfg.environment)}`);
    const auth = providerJwt(cfg);
    const send = (r: ApnsRequest): Promise<ApnsReceipt> =>
      new Promise((resolve) => {
        const stream = client.request({
          ":method": "POST",
          ":path": `/3/device/${r.token}`,
          authorization: `bearer ${auth}`,
          "content-type": "application/json",
          ...r.headers,
        });
        let status = 0, data = "";
        stream.on("response", (h) => { status = Number(h[":status"]); });
        stream.on("data", (c) => { data += c; });
        stream.on("end", () => {
          if (status === 200) return resolve({ status: "ok" });
          let reason: string | undefined;
          try { reason = JSON.parse(data).reason; } catch { /* non-JSON */ }
          resolve({ status: "error", reason });
        });
        stream.on("error", () => resolve({ status: "error" }));
        stream.end();
      });
    try {
      return await Promise.all(requests.map(send));
    } finally {
      client.close();
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter ./artifacts/api-server test -- apns-push`
Expected: PASS. (The transport itself is not unit-tested against a live socket; it is exercised through the injected fake in Task 3.)

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/apns-push.ts artifacts/api-server/src/lib/apns-push.test.ts artifacts/api-server/package.json
git commit -m "feat(api): APNs provider JWT + http2 transport (no-op when unconfigured)"
```

---

### Task 3: Wire APNs into the dispatch fan-out

**Files:**
- Modify: `artifacts/api-server/src/lib/device-dispatch.ts`
- Test: `artifacts/api-server/src/lib/device-dispatch.test.ts` (extend existing)

**Interfaces:**
- Consumes: `ApnsReceipt`, `deadTokensFromApnsReceipts` from Task 1.
- Produces: extended `DispatchDeps` with `listApnsTokens(userId: number): Promise<string[]>` and `sendApns(tokens: string[], payload: PushPayload): Promise<ApnsReceipt[]>`; `DispatchResult` gains `apnsSent: number`.

- [ ] **Step 1: Write the failing test** (add to `device-dispatch.test.ts`)

```typescript
it("dispatches to APNs tokens and prunes dead ones", async () => {
  const pruned: string[] = [];
  const deps = {
    sendWeb: async () => 0,
    listExpoTokens: async () => [],
    sendExpo: async () => [],
    listApnsTokens: async () => ["APN_A", "APN_B"],
    sendApns: async () => [{ status: "ok" as const }, { status: "error" as const, reason: "Unregistered" }],
    pruneTokens: async (t: string[]) => { pruned.push(...t); },
  };
  const result = await dispatchToUser(deps, 1, { title: "T", body: "B" });
  expect(result.apnsSent).toBe(1);
  expect(pruned).toEqual(["APN_B"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ./artifacts/api-server test -- device-dispatch`
Expected: FAIL — `listApnsTokens`/`sendApns` not on `DispatchDeps`; `apnsSent` undefined.

- [ ] **Step 3: Write minimal implementation** (edit `device-dispatch.ts`)

Add imports and extend the interfaces + function:

```typescript
import { deadTokensFromApnsReceipts, type ApnsReceipt } from "./apns-push";

export interface DispatchDeps {
  listExpoTokens(userId: number): Promise<string[]>;
  sendExpo(tokens: string[], payload: PushPayload): Promise<ExpoReceipt[]>;
  listApnsTokens(userId: number): Promise<string[]>;
  sendApns(tokens: string[], payload: PushPayload): Promise<ApnsReceipt[]>;
  pruneTokens(tokens: string[]): Promise<void>;
  sendWeb(userId: number, payload: PushPayload): Promise<number>;
}

export interface DispatchResult {
  webSent: number;
  expoSent: number;
  apnsSent: number;
  pruned: number;
}
```

Then, inside `dispatchToUser`, after the Expo block, before `return`:

```typescript
  const apnsTokens = await deps.listApnsTokens(userId);
  let apnsSent = 0, apnsDead: string[] = [];
  if (apnsTokens.length > 0) {
    const apnsReceipts = await deps.sendApns(apnsTokens, payload);
    apnsSent = apnsReceipts.filter((r) => r.status === "ok").length;
    apnsDead = deadTokensFromApnsReceipts(apnsTokens, apnsReceipts);
    if (apnsDead.length > 0) await deps.pruneTokens(apnsDead);
  }
```

Update the early-return and final-return to include `apnsSent` and add `apnsDead.length` to `pruned`. The existing early `return { webSent, expoSent: 0, pruned: 0 }` (when no expo tokens) must become the full flow — restructure so APNs runs even when there are no Expo tokens:

```typescript
export async function dispatchToUser(
  deps: DispatchDeps, userId: number, payload: PushPayload,
): Promise<DispatchResult> {
  const webSent = await deps.sendWeb(userId, payload);

  const expoTokens = await deps.listExpoTokens(userId);
  let expoSent = 0, expoDead: string[] = [];
  if (expoTokens.length > 0) {
    const receipts = await deps.sendExpo(expoTokens, payload);
    expoSent = receipts.filter((r) => r.status === "ok").length;
    expoDead = deadTokensFromReceipts(expoTokens, receipts);
  }

  const apnsTokens = await deps.listApnsTokens(userId);
  let apnsSent = 0, apnsDead: string[] = [];
  if (apnsTokens.length > 0) {
    const apnsReceipts = await deps.sendApns(apnsTokens, payload);
    apnsSent = apnsReceipts.filter((r) => r.status === "ok").length;
    apnsDead = deadTokensFromApnsReceipts(apnsTokens, apnsReceipts);
  }

  const dead = [...expoDead, ...apnsDead];
  if (dead.length > 0) await deps.pruneTokens(dead);

  return { webSent, expoSent, apnsSent, pruned: dead.length };
}
```

- [ ] **Step 4: Run tests to verify they pass** (existing Expo tests must still pass)

Run: `pnpm --filter ./artifacts/api-server test -- device-dispatch`
Expected: PASS, including the pre-existing Expo cases.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/device-dispatch.ts artifacts/api-server/src/lib/device-dispatch.test.ts
git commit -m "feat(api): fan out pushes to APNs alongside web + Expo"
```

---

### Task 4: Deep-link route table + payload stamping

**Files:**
- Modify: `artifacts/api-server/src/lib/notification-envelope.ts`
- Test: `artifacts/api-server/src/lib/notification-envelope.test.ts` (extend)

**Interfaces:**
- Consumes: `CandidateKind`, `KIND_META` (existing).
- Produces:
  - `interface RouteTarget { screen: string; params?: Record<string, string> }`
  - `KIND_ROUTE: Record<CandidateKind, RouteTarget>` (a route for **every** kind).
  - `stampTarget(kind: CandidateKind, payload: PushPayload): PushPayload` — returns a payload whose `data.target` is `KIND_ROUTE[kind]` (merged with any existing `data`).

- [ ] **Step 1: Write the failing test**

```typescript
import { KIND_META, KIND_ROUTE, stampTarget } from "./notification-envelope";

describe("KIND_ROUTE", () => {
  it("has a route for every CandidateKind (no push can be un-routable)", () => {
    for (const kind of Object.keys(KIND_META)) {
      expect(KIND_ROUTE[kind as keyof typeof KIND_ROUTE]).toBeDefined();
      expect(typeof KIND_ROUTE[kind as keyof typeof KIND_ROUTE].screen).toBe("string");
    }
  });
});

describe("stampTarget", () => {
  it("attaches the kind's route as data.target, preserving existing data", () => {
    const out = stampTarget("context_nudge", { title: "T", body: "B", data: { x: 1 } });
    expect(out.data).toEqual({ x: 1, target: KIND_ROUTE.context_nudge });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ./artifacts/api-server test -- notification-envelope`
Expected: FAIL — `KIND_ROUTE`/`stampTarget` not exported.

- [ ] **Step 3: Write minimal implementation** (add to `notification-envelope.ts`)

```typescript
import type { PushPayload } from "./push-notifications";

export interface RouteTarget { screen: string; params?: Record<string, string> }

// Every CandidateKind maps to a screen the iOS app can open on tap. Keep this
// exhaustive — the test in this file fails if any kind is missing a route.
export const KIND_ROUTE: Record<CandidateKind, RouteTarget> = {
  hyperfocus:          { screen: "focus" },
  hunger_warning:      { screen: "hero" },
  context_nudge:       { screen: "today" },
  reflection_prompt:   { screen: "reflection" },
  companion_milestone: { screen: "hero" },
  hero_flavor:         { screen: "hero" },
};

export function stampTarget(kind: CandidateKind, payload: PushPayload): PushPayload {
  return { ...payload, data: { ...(payload.data ?? {}), target: KIND_ROUTE[kind] } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter ./artifacts/api-server test -- notification-envelope`
Expected: PASS.

- [ ] **Step 5: Integrate `stampTarget` at the send site**

Find where the envelope's selected candidate becomes a dispatched payload (the scheduler's `runEnvelopePass`/producer that calls `bestEffortDispatch` or `pushToUser`). Wrap the payload: `pushToUser(userId, stampTarget(kind, payload))`. Add/extend a test at that call site asserting the dispatched payload carries `data.target`.

Run: `pnpm --filter ./artifacts/api-server test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/lib/notification-envelope.ts artifacts/api-server/src/lib/notification-envelope.test.ts
git commit -m "feat(api): stamp deep-link target on every push from a central kind->route map"
```

---

### Task 5: `devices.environment` column + route accepts it

**Files:**
- Modify: `lib/db/src/schema/device-tokens.ts`
- Modify: `artifacts/api-server/src/routes/devices.ts`
- Create: migration under `lib/db` (generated) — `.sql` + `meta/_journal.json` + snapshot.

**Interfaces:**
- Produces: `deviceTokensTable.environment` (text, nullable — Expo rows have none); `POST /devices` accepts optional `environment: "sandbox" | "production"` and persists it.

- [ ] **Step 1: Add the column to the schema**

In `lib/db/src/schema/device-tokens.ts`, add after `platform`:

```typescript
    environment: text("environment"), // 'sandbox' | 'production' for apns; null for expo
```

- [ ] **Step 2: Generate the migration**

Run (from `lib/db`): `pnpm drizzle-kit generate` (match the repo's existing generate script — check `lib/db/package.json` for the exact command).
Expected: a new `NNNN_*.sql` plus updated `meta/_journal.json` and a snapshot JSON.

- [ ] **Step 3: Accept `environment` in the route**

In `artifacts/api-server/src/routes/devices.ts`, extend the POST body destructure and insert:

```typescript
  const { token, provider, environment } = req.body as {
    token?: string; provider?: string; environment?: string;
  };
  if (!token || (provider !== "expo" && provider !== "apns")) {
    res.status(400).json({ error: "token and provider ('expo'|'apns') are required" });
    return;
  }
  const env = environment === "sandbox" || environment === "production" ? environment : null;
  await db.insert(deviceTokensTable)
    .values({ userId, provider, token, platform: "ios", environment: env })
    .onConflictDoUpdate({
      target: [deviceTokensTable.provider, deviceTokensTable.token],
      set: { userId, environment: env, lastSeenAt: new Date() },
    });
```

- [ ] **Step 4: Typecheck + build the db package**

Run: `pnpm run typecheck` and `pnpm --filter @workspace/db build` (so `dist` reflects the new column for consumers).
Expected: PASS.

- [ ] **Step 5: Commit (migration files together)**

```bash
git add lib/db/src/schema/device-tokens.ts lib/db/drizzle artifacts/api-server/src/routes/devices.ts
git commit -m "feat(db): store apns environment on device tokens; route persists it"
```

(Verify the migration `.sql`, `meta/_journal.json`, and snapshot are all staged — a lone `.sql` desyncs the journal.)

---

### Task 6: Assemble APNs deps in the live dispatcher

**Files:**
- Modify: `artifacts/api-server/src/lib/push-dispatch-live.ts`

**Interfaces:**
- Consumes: `apnsConfigFromEnv`, `apnsHttpTransport`, `buildApnsRequests`, `sendApnsPush` (Tasks 1–2); extended `DispatchDeps` (Task 3); `deviceTokensTable.environment` (Task 5).
- Produces: `buildDispatchDeps()` now also provides `listApnsTokens` + `sendApns`.

- [ ] **Step 1: Add APNs wiring to `buildDispatchDeps`**

```typescript
import {
  apnsConfigFromEnv, apnsHttpTransport, buildApnsRequests, sendApnsPush,
} from "./apns-push";

// ...inside buildDispatchDeps(), add to the returned object:
    listApnsTokens: async (userId) => {
      const rows = await db
        .select({ token: deviceTokensTable.token })
        .from(deviceTokensTable)
        .where(and(
          eq(deviceTokensTable.userId, userId),
          eq(deviceTokensTable.provider, "apns"),
        ));
      return rows.map((r) => r.token);
    },
    sendApns: async (tokens, payload) => {
      const cfg = apnsConfigFromEnv();
      if (!cfg) return tokens.map(() => ({ status: "ok" as const })); // unconfigured: no-op, prune nothing
      return sendApnsPush(buildApnsRequests(tokens, payload, cfg.bundleId), apnsHttpTransport(cfg));
    },
```

Note: when unconfigured, returning `ok` for each token means "sent nothing, prune nothing" — dev/CI never delete tokens. (Environment-aware host selection uses the single `APNS_ENV`; per-token environment routing is a follow-up if mixed dev/prod tokens ever coexist in one deploy.)

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 3: Run the full api-server suite**

Run: `pnpm --filter ./artifacts/api-server test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/lib/push-dispatch-live.ts
git commit -m "feat(api): wire live APNs token lookup + send into dispatch deps"
```

---

### Task 7: iOS — Push Notifications capability + entitlement

**Files:**
- Modify: `ios/FocusQuest/FocusQuest.entitlements` (create if absent)
- Modify: `ios/FocusQuest.xcodeproj/project.pbxproj` (capability + entitlements file reference)

**Interfaces:**
- Produces: the app target has `aps-environment` entitlement so `registerForRemoteNotifications()` yields a token.

- [ ] **Step 1: Add the entitlement**

Ensure `ios/FocusQuest/FocusQuest.entitlements` contains:

```xml
<key>aps-environment</key>
<string>development</string>
```

(Xcode manages `development` vs `production` per build config at signing time; `development` is correct for Debug/sim and TestFlight uses `production` automatically under automatic signing.)

- [ ] **Step 2: Reference the entitlement + enable the capability**

In Xcode: target → Signing & Capabilities → **+ Capability → Push Notifications**. This adds the `.entitlements` file to `CODE_SIGN_ENTITLEMENTS` and the aps environment. Commit the resulting `project.pbxproj` + `.entitlements` changes.

- [ ] **Step 3: Verify the build still succeeds**

Run: `cd ios && xcodebuild -project FocusQuest.xcodeproj -scheme FocusQuest -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build`
Expected: BUILD SUCCEEDED (0 warnings — repo quality bar).

- [ ] **Step 4: Commit**

```bash
git add ios/FocusQuest/FocusQuest.entitlements ios/FocusQuest.xcodeproj/project.pbxproj
git commit -m "feat(ios): add Push Notifications capability + aps-environment entitlement"
```

---

### Task 8: iOS — register APNs token via `POST /devices`

**Files:**
- Create: `ios/FocusQuest/Services/DeviceService.swift`
- Create/Modify: an app-delegate adaptor on the app entry (`ios/FocusQuest/FocusQuestApp.swift` or equivalent `@main`)
- Modify: `ios/FocusQuest/Services/NotificationManager.swift`

**Interfaces:**
- Consumes: `APIClient.shared.post` (existing), the app's `aps-environment` value.
- Produces:
  - `enum DeviceService { static func register(token: String, environment: String) async throws }`
  - `NotificationManager` requests authorization and calls `registerForRemoteNotifications()`.
  - App delegate forwards `didRegisterForRemoteNotificationsWithDeviceToken`.

- [ ] **Step 1: Add `DeviceService`**

```swift
import Foundation

/// Registers/unregisters this device's APNs token with the API.
enum DeviceService {
    struct RegisterInput: Encodable { let token: String; let provider = "apns"; let environment: String }

    static func register(token: String, environment: String) async throws {
        _ = try await APIClient.shared.post("devices", body: RegisterInput(token: token, environment: environment))
    }

    static func unregister(token: String) async throws {
        try await APIClient.shared.send("devices/\(token)", method: .delete)
    }

    /// aps-environment baked into the build: "sandbox" for development, else "production".
    static var currentEnvironment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }
}
```

(If `APIClient.post` requires a `Decodable` response, define a tiny `struct SuccessResponse: Decodable { let success: Bool }` and type the call, matching how other Services decode `{ success: true }`.)

- [ ] **Step 2: Add an app-delegate adaptor that forwards the token**

In the `@main` App struct, add:

```swift
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { try? await DeviceService.register(token: hex, environment: DeviceService.currentEnvironment) }
    }
    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Non-fatal: local notifications still work. Logged, not surfaced.
        print("APNs registration failed: \(error.localizedDescription)")
    }
}
```

And in the App struct: `@UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate`.

- [ ] **Step 3: Request authorization + register in `NotificationManager`**

Extend the existing authorization flow so that, after the user grants notification permission, it registers for remote too:

```swift
func requestAuthorizationAndRegister() {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
        guard granted else { return }
        DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
    }
}
```

Call `requestAuthorizationAndRegister()` where the app currently asks for local-notification permission (keep the local-nudge path intact).

- [ ] **Step 4: Verify build + token registration on the simulator**

Run the build command from Task 7 Step 3.
Note: the iOS **simulator** yields an APNs token only on macOS 13+/recent Xcode; if the sim returns no token, verification of the *network* call happens on a physical device (owner step). The build passing + no compile errors is the CI gate here.
Expected: BUILD SUCCEEDED.

- [ ] **Step 5: Commit**

```bash
git add ios/FocusQuest/Services/DeviceService.swift ios/FocusQuest/Services/NotificationManager.swift ios/FocusQuest/FocusQuestApp.swift
git commit -m "feat(ios): register APNs device token with the API on authorization"
```

---

### Task 9: iOS — deep-link coordinator + tap routing

**Files:**
- Create: `ios/FocusQuest/Services/DeepLinkCoordinator.swift`
- Modify: `ios/FocusQuest/Services/NotificationManager.swift` (delegate)
- Modify: the root navigation host view (the `TabView`/root screen)

**Interfaces:**
- Consumes: `userInfo["target"]` = `{ screen: String, params?: [String:String] }` (stamped server-side in Task 4).
- Produces:
  - `enum AppScreen: String { case today, hero, focus, reflection, party }` (extend to match existing tabs/screens)
  - `final class DeepLinkCoordinator: ObservableObject { @Published var pending: AppScreen? }`
  - `NotificationManager` conforms to `UNUserNotificationCenterDelegate` and sets `coordinator.pending` on tap + cold launch.

- [ ] **Step 1: Add the coordinator**

```swift
import SwiftUI

enum AppScreen: String, CaseIterable { case today, hero, focus, reflection, party }

@MainActor
final class DeepLinkCoordinator: ObservableObject {
    static let shared = DeepLinkCoordinator()
    @Published var pending: AppScreen?

    func handle(userInfo: [AnyHashable: Any]) {
        guard let target = userInfo["target"] as? [String: Any],
              let screen = target["screen"] as? String,
              let dest = AppScreen(rawValue: screen) else { return }
        pending = dest
    }
}
```

- [ ] **Step 2: Route taps + foreground + cold launch in `NotificationManager`**

```swift
extension NotificationManager: UNUserNotificationCenterDelegate {
    func userNotificationCenter(_ c: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse) async {
        await DeepLinkCoordinator.shared.handle(userInfo: response.notification.request.content.userInfo)
    }
    func userNotificationCenter(_ c: UNUserNotificationCenter,
                                willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        return [.banner, .sound]   // show while foregrounded; tap still routes via didReceive
    }
}
```

Ensure `UNUserNotificationCenter.current().delegate = <the NotificationManager instance>` is set at launch (in the AppDelegate from Task 8).

- [ ] **Step 3: Observe `pending` in the root view**

In the root navigation host, inject `@StateObject var coordinator = DeepLinkCoordinator.shared`, bind the `TabView` selection, and `.onChange(of: coordinator.pending)` switch the selected tab / push the screen, then clear `pending`.

```swift
.onChange(of: coordinator.pending) { _, screen in
    guard let screen else { return }
    selectedTab = tabFor(screen)   // map AppScreen -> existing tab enum
    coordinator.pending = nil
}
```

- [ ] **Step 4: Verify build**

Run the Task 7 Step 3 build command.
Expected: BUILD SUCCEEDED, 0 warnings.

- [ ] **Step 5: Verify tap routing on the simulator with a synthetic push**

Create `payload.apns`:

```json
{ "aps": { "alert": { "title": "Reflect", "body": "How did today go?" } }, "target": { "screen": "reflection" } }
```

Run (app installed + booted on the sim): `xcrun simctl push booted <bundle-id> payload.apns`
Expected: notification appears; tapping it selects the Reflection screen. (This validates client handling without live APNs.)

- [ ] **Step 6: Commit**

```bash
git add ios/FocusQuest/Services/DeepLinkCoordinator.swift ios/FocusQuest/Services/NotificationManager.swift <root view file>
git commit -m "feat(ios): route notification taps to the target screen via a deep-link coordinator"
```

---

### Task 10: iOS — deregister token on logout

**Files:**
- Modify: `ios/FocusQuest/Services/AuthService.swift`

**Interfaces:**
- Consumes: `DeviceService.unregister(token:)` (Task 8); the current APNs token (cache the hex from `didRegister...` in `DeviceService`/`UserDefaults`).

- [ ] **Step 1: Cache the token at registration**

In `DeviceService.register`, store the hex in `UserDefaults.standard.set(token, forKey: "apnsToken")` so logout can read it back.

- [ ] **Step 2: Call unregister during logout**

In `AuthService`'s logout path, before clearing the session:

```swift
if let token = UserDefaults.standard.string(forKey: "apnsToken") {
    try? await DeviceService.unregister(token: token)
    UserDefaults.standard.removeObject(forKey: "apnsToken")
}
```

- [ ] **Step 3: Verify build**

Run the Task 7 Step 3 build command.
Expected: BUILD SUCCEEDED.

- [ ] **Step 4: Commit**

```bash
git add ios/FocusQuest/Services/AuthService.swift ios/FocusQuest/Services/DeviceService.swift
git commit -m "feat(ios): deregister APNs token on logout"
```

---

## Owner prerequisites (before end-to-end delivery works)

These are not code tasks and cannot be automated (no access to the Apple Developer account or key material):

1. Apple Developer portal → App ID → enable **Push Notifications**.
2. Create an **APNs Auth Key (.p8)**; note **Key ID** and **Team ID**.
3. On Render, set env: `APNS_AUTH_KEY` (the .p8 contents), `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_ENV` (`sandbox` for TestFlight-dev, `production` for App Store).
4. End-to-end verification on a **physical device** (the simulator can't receive live APNs pushes).

## Final verification (whole feature)

- `pnpm run typecheck` — PASS
- `pnpm --filter ./artifacts/api-server test` — PASS
- iOS simulator build — BUILD SUCCEEDED, 0 warnings
- Synthetic `simctl push` — tapping routes to the correct screen
- Then open a PR (server + iOS together), per `CLAUDE.md`.

## Self-review notes

- **Spec coverage:** APNs transport (T1–2), dispatch fan-out (T3), deep-link stamp (T4), env column/migration (T5), live wiring (T6), iOS entitlement (T7), registration (T8), tap routing (T9), logout deregister (T10), owner prereqs (section). All spec sections mapped.
- **Ambiguity resolved:** "all existing push types" = every `CandidateKind` in `KIND_META`; the exhaustiveness test enforces a route for each. If a producer emits a push outside the envelope, add its kind to `KIND_META`/`KIND_ROUTE` (surfaced by the test).
- **Type consistency:** `ApnsReceipt`, `ApnsRequest`, `ApnsTransport`, `DispatchDeps.listApnsTokens/sendApns`, `DispatchResult.apnsSent`, `KIND_ROUTE`, `stampTarget`, `DeviceService`, `DeepLinkCoordinator`, `AppScreen` are consistent across tasks.
