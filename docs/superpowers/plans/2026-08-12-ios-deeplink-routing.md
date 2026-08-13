# iOS Deep-Link Routing Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tapping an iOS notification land the user on the correct, auth-gated native destination (`/focus`, `/reflection`, or home), holding cold-start taps until session restore completes and replaying them after login.

**Architecture:** A pure normalizer (`normalizeDeepLink`) and a pure decision reducer (`nextNav`) carry the correctness core and are unit-tested in node/Vitest. A `DeepLinkRouter` component mounted **inside** `AuthProvider` owns the side effects (notification listeners + `router.push`), driven by those pure functions. Two real native routes (`app/focus.tsx`, `app/reflection.tsx`) each perform one authenticated read and render a minimal native view. Full web parity of those screens is out of scope (deferred to specs #4b/#4c).

**Tech Stack:** Expo Router 5, React Native 0.79, expo-notifications, `@workspace/api-client-react` (React Query generated hooks), Vitest (node env).

## Global Constraints

- **Design source:** `docs/superpowers/specs/2026-08-12-ios-deeplink-routing-design.md`. Everything here implements that spec; do not add server changes, WebView routing, auto-login-on-tap, or full Focus/Reflection parity.
- **Package:** all code lives in `artifacts/focusquest-mobile`. The package name is `focusquest-mobile`.
- **Test toolchain:** Vitest runs in `node` env with **pure-function tests only** (see `auth-config.test.ts`, `pkce.test.ts`). There is NO React Native render-testing library installed. Do NOT add one. Pure logic (`normalizeDeepLink`, `nextNav`) is unit-tested; React/Expo-integration files (`DeepLinkRouter`, route components) are verified by `typecheck` + the device gates — matching how `auth-context.tsx` and `register-device.ts` are already handled (no unit tests).
- **Focused test run:** `pnpm --filter focusquest-mobile exec vitest run <path>`. Full package tests: `pnpm --filter focusquest-mobile test`. Typecheck: `pnpm --filter focusquest-mobile typecheck`.
- **Git hygiene (branch-guard):** work on branch `feat/ios-deeplink-routing` (already created; the design commit `9bb79e7` is on it). Stage with **explicit paths only** (`git add -- <path> <path>`). NEVER run `git add -A`/`git add .`. NEVER stage the 13 phantom `lib/api-zod/src/generated/types/` files — they must not appear in any commit.
- **Route allowlist:** the only known deep-link routes are `/`, `/focus`, `/reflection`. Everything else collapses to `/`.

---

### Task 1: Pure deep-link normalizer

**Files:**
- Create: `artifacts/focusquest-mobile/src/routing/url-routing.ts`
- Test: `artifacts/focusquest-mobile/src/routing/url-routing.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export type KnownRoute = "/" | "/focus" | "/reflection";`
  - `export function normalizeDeepLink(url: string | undefined | null): KnownRoute;`

- [ ] **Step 1: Write the failing test**

Create `artifacts/focusquest-mobile/src/routing/url-routing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeDeepLink } from "./url-routing";

describe("normalizeDeepLink", () => {
  it("keeps known routes", () => {
    expect(normalizeDeepLink("/focus")).toBe("/focus");
    expect(normalizeDeepLink("/reflection")).toBe("/reflection");
  });

  it("maps home and empty-ish inputs to /", () => {
    expect(normalizeDeepLink("/")).toBe("/");
    expect(normalizeDeepLink("")).toBe("/");
    expect(normalizeDeepLink("   ")).toBe("/");
    expect(normalizeDeepLink(undefined)).toBe("/");
    expect(normalizeDeepLink(null)).toBe("/");
  });

  it("strips query and hash before matching", () => {
    expect(normalizeDeepLink("/focus?src=push")).toBe("/focus");
    expect(normalizeDeepLink("/reflection#top")).toBe("/reflection");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeDeepLink("  /focus  ")).toBe("/focus");
  });

  it("collapses unknown and web-only routes to /", () => {
    expect(normalizeDeepLink("/settings")).toBe("/");
    expect(normalizeDeepLink("/rewards")).toBe("/");
    expect(normalizeDeepLink("focus")).toBe("/"); // no leading slash
    expect(normalizeDeepLink("https://app.example.com/focus")).toBe("/");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter focusquest-mobile exec vitest run src/routing/url-routing.test.ts`
Expected: FAIL — `Failed to resolve import "./url-routing"` / `normalizeDeepLink is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `artifacts/focusquest-mobile/src/routing/url-routing.ts`:

```ts
export type KnownRoute = "/" | "/focus" | "/reflection";

const KNOWN: ReadonlySet<string> = new Set<KnownRoute>(["/focus", "/reflection"]);

/**
 * Normalize a notification `data.url` into a route that actually exists in the
 * native app. Query/hash are stripped; anything not in the allowlist (including
 * "/", empty, null, and web-only paths) collapses to home ("/").
 */
export function normalizeDeepLink(url: string | undefined | null): KnownRoute {
  if (typeof url !== "string") return "/";
  const trimmed = url.trim();
  if (trimmed === "") return "/";
  const path = trimmed.split(/[?#]/, 1)[0];
  return KNOWN.has(path) ? (path as KnownRoute) : "/";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter focusquest-mobile exec vitest run src/routing/url-routing.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add -- artifacts/focusquest-mobile/src/routing/url-routing.ts artifacts/focusquest-mobile/src/routing/url-routing.test.ts
git commit -m "feat(mobile): pure deep-link URL normalizer with route allowlist"
```

---

### Task 2: Pure navigation-decision reducer

**Files:**
- Create: `artifacts/focusquest-mobile/src/routing/nav-decision.ts`
- Test: `artifacts/focusquest-mobile/src/routing/nav-decision.test.ts`

**Interfaces:**
- Consumes: `normalizeDeepLink`, `KnownRoute` from `./url-routing` (Task 1).
- Produces:
  - `export type AuthStatus = "loading" | "authed" | "anon";`
  - `export function nextNav(status: AuthStatus, pendingUrl: string | null): KnownRoute | null;`
    (`null` = do nothing this pass; a `KnownRoute` = navigate there then clear pending.)

- [ ] **Step 1: Write the failing test**

Create `artifacts/focusquest-mobile/src/routing/nav-decision.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextNav } from "./nav-decision";

describe("nextNav", () => {
  it("never navigates while auth is loading", () => {
    expect(nextNav("loading", "/focus")).toBeNull();
    expect(nextNav("loading", null)).toBeNull();
  });

  it("navigates to the normalized route when authed with a pending url", () => {
    expect(nextNav("authed", "/focus")).toBe("/focus");
    expect(nextNav("authed", "/reflection")).toBe("/reflection");
    expect(nextNav("authed", "/unknown")).toBe("/"); // normalized fallback
  });

  it("does nothing when authed with no pending url", () => {
    expect(nextNav("authed", null)).toBeNull();
  });

  it("holds (does not navigate) while anon with a pending url", () => {
    expect(nextNav("anon", "/focus")).toBeNull();
  });

  it("replays the held destination once anon becomes authed", () => {
    // pendingUrl survives the anon pass...
    expect(nextNav("anon", "/reflection")).toBeNull();
    // ...and fires on the authed pass.
    expect(nextNav("authed", "/reflection")).toBe("/reflection");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter focusquest-mobile exec vitest run src/routing/nav-decision.test.ts`
Expected: FAIL — cannot resolve `./nav-decision` / `nextNav is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `artifacts/focusquest-mobile/src/routing/nav-decision.ts`:

```ts
import { normalizeDeepLink, type KnownRoute } from "./url-routing";

export type AuthStatus = "loading" | "authed" | "anon";

/**
 * Decide where a pending deep link should send the user, given current auth.
 * Returns the route to navigate to (caller then clears pendingUrl), or null to
 * wait. Cold-start taps arriving before session restore (`loading`) wait; taps
 * while logged out (`anon`) are held until the user authenticates.
 */
export function nextNav(status: AuthStatus, pendingUrl: string | null): KnownRoute | null {
  if (status !== "authed") return null;
  if (pendingUrl === null) return null;
  return normalizeDeepLink(pendingUrl);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter focusquest-mobile exec vitest run src/routing/nav-decision.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -- artifacts/focusquest-mobile/src/routing/nav-decision.ts artifacts/focusquest-mobile/src/routing/nav-decision.test.ts
git commit -m "feat(mobile): pure auth-gated navigation-decision reducer"
```

---

### Task 3: Native Focus route

**Files:**
- Create: `artifacts/focusquest-mobile/app/focus.tsx`

**Interfaces:**
- Consumes: `useAuth` from `../src/auth/auth-context`; `useGetActiveFocusSession` from `@workspace/api-client-react`; `Stack`, `Redirect` from `expo-router`.
- Produces: an expo-router route at path `/focus` (default export React component).

**Notes for the implementer:**
- The global `Stack` sets `headerShown: false` (see `app/_layout.tsx`). Re-enable a header for THIS screen via `<Stack.Screen options={{ headerShown: true, title: "Focus Session" }} />` so the user gets a title + native back button.
- `useGetActiveFocusSession()` returns a React Query result whose `.data` is the active `FocusSession` (fields include `status: string`, `startedAt: string`) or `null`/`undefined` when there is no active session (same shape the web `focus.tsx` consumes via `activeQuery.data ?? null`).
- Auth guard: if `status === "loading"` show a loading line; if `status !== "authed"` return `<Redirect href="/" />`. This is intentional belt-and-suspenders with the `DeepLinkRouter` state machine.

- [ ] **Step 1: Create the route component**

Create `artifacts/focusquest-mobile/app/focus.tsx`:

```tsx
import { View, Text } from "react-native";
import { Stack, Redirect } from "expo-router";
import { useGetActiveFocusSession } from "@workspace/api-client-react";
import { useAuth } from "../src/auth/auth-context";

export default function FocusRoute() {
  const { status } = useAuth();
  const active = useGetActiveFocusSession({ query: { enabled: status === "authed" } });

  if (status === "loading") return <Centered><Text>Loading…</Text></Centered>;
  if (status !== "authed") return <Redirect href="/" />;

  const session = active.data ?? null;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Focus Session" }} />
      <Centered>
        <Text style={{ fontSize: 18, fontWeight: "600" }}>Focus</Text>
        <Text>
          {active.isLoading
            ? "Checking for an active session…"
            : session
              ? `Active session — status: ${session.status}`
              : "No active session right now."}
        </Text>
      </Centered>
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, gap: 12, alignItems: "center", justifyContent: "center", padding: 24 }}>
      {children}
    </View>
  );
}
```

If `useGetActiveFocusSession` does not accept a `{ query: { enabled } }` option in this generated client version, remove that argument and call `useGetActiveFocusSession()` — the `status !== "authed"` early-return already prevents the fetch from mattering. Confirm against the exported signature before finalizing.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter focusquest-mobile typecheck`
Expected: PASS (no type errors). If the `enabled` option errors, apply the fallback in Step 1's note and re-run.

- [ ] **Step 3: Commit**

```bash
git add -- artifacts/focusquest-mobile/app/focus.tsx
git commit -m "feat(mobile): native Focus route with live active-session read"
```

---

### Task 4: Native Reflection route

**Files:**
- Create: `artifacts/focusquest-mobile/app/reflection.tsx`

**Interfaces:**
- Consumes: `useAuth` from `../src/auth/auth-context`; `useGetTodayReflection` from `@workspace/api-client-react`; `Stack`, `Redirect` from `expo-router`.
- Produces: an expo-router route at path `/reflection` (default export React component).

**Notes for the implementer:**
- `useGetTodayReflection` takes params `{ tz, draft? }` (web calls `useGetTodayReflection({ tz, draft: true })`). Derive the timezone in RN with `Intl.DateTimeFormat().resolvedOptions().timeZone` (works under Hermes) — do NOT import the web app's `@/lib/timezone`, which is not part of this package.
- `.data?.reflection` is a `Reflection | null` with fields `prompt: string` and `answeredAt: string | null`.
- Same auth-guard pattern as Task 3.

- [ ] **Step 1: Create the route component**

Create `artifacts/focusquest-mobile/app/reflection.tsx`:

```tsx
import { View, Text } from "react-native";
import { Stack, Redirect } from "expo-router";
import { useGetTodayReflection } from "@workspace/api-client-react";
import { useAuth } from "../src/auth/auth-context";

export default function ReflectionRoute() {
  const { status } = useAuth();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = useGetTodayReflection({ tz }, { query: { enabled: status === "authed" } });

  if (status === "loading") return <Centered><Text>Loading…</Text></Centered>;
  if (status !== "authed") return <Redirect href="/" />;

  const reflection = today.data?.reflection ?? null;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Reflection" }} />
      <Centered>
        <Text style={{ fontSize: 18, fontWeight: "600" }}>Today's reflection</Text>
        <Text style={{ textAlign: "center" }}>
          {today.isLoading
            ? "Loading today's prompt…"
            : reflection
              ? `${reflection.prompt}${reflection.answeredAt ? " (answered ✓)" : ""}`
              : "No reflection prompt yet today."}
        </Text>
      </Centered>
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, gap: 12, alignItems: "center", justifyContent: "center", padding: 24 }}>
      {children}
    </View>
  );
}
```

If the generated `useGetTodayReflection` signature differs (e.g. params/options positions), match the shape used in `artifacts/focusquest/src/pages/reflection.tsx` (`useGetTodayReflection({ tz, draft: true })`) and drop the options arg if `enabled` is unsupported; the auth early-return still gates the fetch.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter focusquest-mobile typecheck`
Expected: PASS. Apply the fallback in Step 1's note if the options arg errors, then re-run.

- [ ] **Step 3: Commit**

```bash
git add -- artifacts/focusquest-mobile/app/reflection.tsx
git commit -m "feat(mobile): native Reflection route with live today-reflection read"
```

---

### Task 5: Auth-aware DeepLinkRouter + wire into root layout

**Files:**
- Create: `artifacts/focusquest-mobile/src/routing/deep-link-routing.tsx`
- Modify: `artifacts/focusquest-mobile/app/_layout.tsx` (remove the notification-response `useEffect` at ~lines 33–61; mount `<DeepLinkRouter />` inside `AuthProvider`).

**Interfaces:**
- Consumes: `nextNav`, `AuthStatus` from `../src/routing/nav-decision`; `useAuth` from `../src/auth/auth-context`; `useRouter` from `expo-router`; `expo-notifications`.
- Produces: `export function DeepLinkRouter(): null;` — a side-effect-only component that reads notification taps, holds a single pending url, and navigates per `nextNav`.

**Notes for the implementer:**
- `DeepLinkRouter` MUST render as a child of `AuthProvider` (so `useAuth()` resolves) and of the expo-router root (so `useRouter()` works). It returns `null`.
- Keep `Notifications.setNotificationHandler(...)` and all the API-client bootstrap in `_layout.tsx` untouched. Only the notification-response `useEffect` (and the now-unused `useRouter` import in `RootLayout`) move out.

- [ ] **Step 1: Create the DeepLinkRouter**

Create `artifacts/focusquest-mobile/src/routing/deep-link-routing.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { useAuth } from "../auth/auth-context";
import { nextNav } from "./nav-decision";

function urlOf(response: Notifications.NotificationResponse | null | undefined): string | null {
  const url = response?.notification.request.content.data?.url;
  return typeof url === "string" && url.trim() !== "" ? url : null;
}

/**
 * Side-effect-only. Collects notification taps (live + cold start) into a single
 * pending url, then navigates once auth is settled — holding cold-start/anon taps
 * until session restore and login complete (see nextNav).
 */
export function DeepLinkRouter(): null {
  const { status } = useAuth();
  const router = useRouter();
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  // Collect taps: live responses + the cold-start launch response.
  useEffect(() => {
    let cancelled = false;

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const url = urlOf(response);
      if (url) setPendingUrl(url);
    });

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (cancelled) return;
      const url = urlOf(response);
      if (url) setPendingUrl(url);
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  // Navigate when auth is settled; clear pending after a navigation fires.
  useEffect(() => {
    const route = nextNav(status, pendingUrl);
    if (route) {
      router.push(route);
      setPendingUrl(null);
    }
  }, [status, pendingUrl, router]);

  return null;
}
```

- [ ] **Step 2: Wire it into the root layout**

Edit `artifacts/focusquest-mobile/app/_layout.tsx`:

1. Update imports at the top — remove `useRouter` from the expo-router import (keep `Stack`), and add the `DeepLinkRouter` import:

```tsx
import { Stack } from "expo-router";
```

```tsx
import { AuthProvider } from "../src/auth/auth-context";
import { DeepLinkRouter } from "../src/routing/deep-link-routing";
```

2. Delete the entire notification-response effect block from `RootLayout` (the `const router = useRouter();` line and the `useEffect(() => { ... routeToResponse ... }, [router]);` block). Also remove the now-unused `useEffect` import if nothing else uses it (the file's remaining top-level code does not).

3. Replace the returned JSX so `DeepLinkRouter` sits inside `AuthProvider`:

```tsx
export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <DeepLinkRouter />
        <Stack screenOptions={{ headerShown: false }} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
```

After the edit, `RootLayout` no longer imports or calls `useRouter`/`useEffect`, and the `Notifications.setNotificationHandler(...)` call plus the API-client bootstrap block remain exactly as before.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter focusquest-mobile typecheck`
Expected: PASS. Common failure: leftover unused `useRouter`/`useEffect` import → remove it.

- [ ] **Step 4: Run the full package test suite (guard against regressions)**

Run: `pnpm --filter focusquest-mobile test`
Expected: PASS — the existing suites plus the two new pure suites (`url-routing`, `nav-decision`) are green.

- [ ] **Step 5: Commit**

```bash
git add -- artifacts/focusquest-mobile/src/routing/deep-link-routing.tsx artifacts/focusquest-mobile/app/_layout.tsx
git commit -m "feat(mobile): auth-gated deep-link router with cold-start hold + replay"
```

---

### Task 6: Device-verification runbook section

**Files:**
- Modify: `docs/superpowers/specs/2026-08-12-ios-device-track-runbook.md` (append a new section).

**Notes for the implementer:**
- This is the hand-off Chad executes on his iPhone after a dev-client rebuild. Append; do not rewrite existing sections. Match the existing runbook's heading style (open the file first and mirror its formatting).

- [ ] **Step 1: Append the runbook section**

Append to `docs/superpowers/specs/2026-08-12-ios-device-track-runbook.md`:

```markdown
## G3 deep-link routing verification (device-track #4)

Prereq: rebuild and install the dev-client so the new `/focus` and `/reflection`
routes and the `DeepLinkRouter` are present:

    pnpm --filter focusquest-mobile exec eas build --profile development --platform ios
    # install the resulting dev-client build on the device, then:
    pnpm --filter focusquest-mobile start

Run each tap path and confirm the landing screen:

1. **`/focus`** — trigger a body-double ally start (server sends `data.url: "/focus"`).
   Tap the notification. Expect: native "Focus Session" screen with a header + back
   button, showing "Active session — status: …" or "No active session right now."
2. **`/reflection`** — trigger/await the evening reflection prompt (`data.url: "/reflection"`).
   Tap it. Expect: native "Reflection" screen showing today's prompt (with "(answered ✓)"
   if already answered) or "No reflection prompt yet today."
3. **Home / no-url** — trigger a context nudge (`data.url: "/"`) or an accountability
   nudge (no url). Tap it. Expect: the app opens to the home/index screen; no unmatched-route error.
4. **Cold-start while logged out** — sign out, fully quit the app, then have a `/focus`
   or `/reflection` push delivered and tap it from a cold start. Expect: the app opens
   to the login screen (NOT the target, NOT an error). Log in. Expect: immediately after
   login completes, the app navigates to the tapped destination (the held deep link replays).

Record pass/fail per path. Any unmatched-route screen, a tap that lands on the wrong
destination, or a cold-start tap that routes into the anon shell before login is a failure.
```

- [ ] **Step 2: Commit**

```bash
git add -- docs/superpowers/specs/2026-08-12-ios-device-track-runbook.md
git commit -m "docs(ios): device runbook section for deep-link routing (G3 #4)"
```

---

## Self-Review

**Spec coverage:**
- Pure `normalizeDeepLink` normalizer + allowlist → Task 1. ✓
- `nextNav` state-machine reducer (all four rows incl. anon→authed replay) → Task 2. ✓
- `DeepLinkRouter` mounted inside `AuthProvider`, listeners + cold start + pending url → Task 5. ✓
- Removal of the old `_layout.tsx` notification effect → Task 5, Step 2. ✓
- Native `focus`/`reflection` routes with one live authenticated read + auth guard → Tasks 3, 4. ✓
- Silent-hold-then-replay UX (anon cold-start) → encoded in `nextNav` (Task 2) + `DeepLinkRouter` retaining pendingUrl (Task 5). ✓
- Unknown/`/`/absent-url fallback to home → Task 1 + Task 5's `urlOf` (absent url ⇒ no pending set). ✓
- Testing philosophy (pure unit tests; integration via typecheck/device) → Global Constraints + per-task steps. ✓
- Device verification runbook → Task 6. ✓

**Placeholder scan:** No TBD/TODO/"add error handling"/"similar to Task N"; every code step shows complete code. The two "if the generated signature differs" notes are concrete fallbacks with an exact alternative, not placeholders. ✓

**Type consistency:** `KnownRoute` defined in Task 1, imported by Task 2; `AuthStatus` defined in Task 2, consumed by Task 5; `nextNav(status, pendingUrl)` signature identical across Tasks 2 and 5; `DeepLinkRouter(): null` matches its usage in Task 5's JSX. Route paths `/focus`, `/reflection` are consistent between the allowlist (Task 1), the route files (Tasks 3–4), and `router.push` targets (Task 5). ✓
