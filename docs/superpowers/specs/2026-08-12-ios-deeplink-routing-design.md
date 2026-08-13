# iOS Deep-Link Routing Spine — Design (device-track #4)

**Date:** 2026-08-12
**Status:** Approved (design)
**Artifact:** `artifacts/focusquest-mobile` (Expo / React Native dev-client)
**Predecessors:** device-track #1 mobile client (PR #97), #2 docs reconcile (PR #98), #3 native push fan-out (PR #99)
**Successors (separate specs):** #4b native Focus screen (full parity), #4c native Reflection screen (full parity)

## Purpose

Make tapping an iOS notification land the user on the correct, auth-gated destination
in the native shell. This is the routing **spine** only — real native `focus` and
`reflection` routes are introduced here as genuine (minimal) destinations, but their
full web-parity behavior is deferred to specs #4b and #4c.

This closes the deep-link proof the device-track runbook left open (the true G3
end-to-end tap verification).

## Scope decisions (settled during brainstorming)

- **Routing model:** native screens per destination (not a WebView bridge, not stubs).
- **Screen depth in THIS spec:** routing spine + real native routes each doing **one
  live authenticated read**. Full web parity is out of scope here (→ #4b / #4c).
- **Anon cold-start tap UX:** silently **hold** the intended destination, land the user
  on the normal login screen, and auto-carry them to the target **after** login
  completes. No auto-triggering of the Auth0 browser on launch.

## Destination reality (what the server actually sends)

The native push path is `pushToUser` → `dispatchToUser` → `device_tokens`. The
`data.url` values that reach the client:

| `data.url`    | Source                                                              | Native route    |
| ------------- | ------------------------------------------------------------------- | --------------- |
| `/`           | context nudges (due-today, power-window, quick-win) via scheduler    | `app/index.tsx` (exists) |
| `/focus`      | body-double ally start (`body-double.ts:83`)                        | `app/focus.tsx` (new) |
| `/reflection` | evening reflection prompt (`notification-scheduler.ts:258`)          | `app/reflection.tsx` (new) |
| *(no url)*    | accountability nudges (`accountability.ts:403`)                     | none — app opens to home |

Any other/unknown/web-only url collapses to home (`/`).

## Problem being fixed

Current `routeToResponse` in `app/_layout.tsx`:

1. Lives **outside** `AuthProvider`, so it cannot read auth status.
2. Calls `router.push(url)` blindly → unknown/web-only urls hit expo-router's
   unmatched route and dead-end.
3. Reads `getLastNotificationResponseAsync()` on mount — cold-start taps fire
   **before** `AuthProvider`'s `getToken()` resolves, routing into an anon shell.
4. There are no `/focus` or `/reflection` routes to land on.

## Architecture — three units

### 1. `src/routing/url-routing.ts` — pure normalizer (no React)

```ts
export type KnownRoute = "/" | "/focus" | "/reflection";
export function normalizeDeepLink(url: string | undefined | null): KnownRoute;
```

An allowlist maps known destinations to real routes. `/`, empty string, `null`,
`undefined`, unknown paths, and web-only urls all collapse to `"/"`. Pure and
exhaustively unit-testable. Single source of truth for "what routes exist."

Normalization rules:

- Trim; strip any query/hash so `/focus?x=1` still matches `/focus`.
- Compare the path against the allowlist `{"/focus", "/reflection"}`.
- Everything else (including `"/"`, `""`, unknown) → `"/"`.

### 2. `src/routing/deep-link-routing.tsx` — auth-aware routing, mounted INSIDE `AuthProvider`

Routing moves out of `RootLayout` and into the auth-aware subtree (a
`DeepLinkProvider` component / `useDeepLinkRouting` hook rendered under
`AuthProvider`) so it can read `useAuth().status`. Responsibilities:

- Subscribe to `Notifications.addNotificationResponseReceivedListener` (live taps,
  covers foreground and background-tap-while-running).
- Read `Notifications.getLastNotificationResponseAsync()` **once** (cold start).
- Store a single `pendingUrl` (the most recent tapped url awaiting navigation).
- Run one effect implementing the state machine below; navigate only when auth
  is settled.

`RootLayout` keeps `Notifications.setNotificationHandler(...)` and the providers,
but its notification-response `useEffect` (current lines ~36–61) is removed — that
logic relocates here.

### 3. Native routes — `app/focus.tsx`, `app/reflection.tsx`

Each route:

- Performs one authenticated GET — Focus: `useGetActiveFocusSession()`;
  Reflection: `useGetTodayReflection()` — exercising the Keychain bearer-token flow.
- Renders a minimal native view: a `Stack.Screen` header with a title + back nav,
  plus the fetched fact (e.g. "Active session: …" / "No active session";
  "Today's reflection: answered / not yet").
- Is auth-guarded: if `status !== "authed"`, redirect to `/` (home/login). This is
  belt-and-suspenders with the state machine — a route should never render its
  authed content for an anon user even if reached directly.

These are real destinations, not stubs; #4b/#4c grow their internals into full parity.

## The state machine (correctness core)

Expressed as a pure reducer for testability:

```ts
export function nextNav(
  status: "loading" | "authed" | "anon",
  pendingUrl: string | null,
): KnownRoute | null; // null = do nothing this pass
```

| Auth status              | pendingUrl | Result                                         |
| ------------------------ | ---------- | ---------------------------------------------- |
| `loading`                | any        | `null` — never navigate mid-restore            |
| `authed`                 | set        | `normalizeDeepLink(pendingUrl)` → navigate, then clear pending |
| `authed`                 | null       | `null`                                         |
| `anon`                   | set        | `null` — **hold**; stay on login (index)       |
| `anon` → `authed` (login)| still set  | effect refires → navigate → clear              |

The provider owns the side effects (calling `router` and clearing `pendingUrl`);
`nextNav` owns the decision. A cold-start tap while logged out lands on login and,
the instant login completes, carries the user to their intended screen. Absent-url
taps set nothing → app opens to home.

Navigation uses `router.push` (home remains the stack root, so back returns home).
Pending is cleared immediately after a navigate to prevent re-navigation on
re-render.

## Data flow

```
notification tap ─┬─ live: addNotificationResponseReceivedListener ─┐
                  └─ cold start: getLastNotificationResponseAsync ──┴─→ setPendingUrl(data.url)
                                                                          │
                        useAuth().status ──────────────────────────────► effect: nextNav(status, pendingUrl)
                                                                          │
                                                    ┌── null → wait ──────┘
                                                    └── KnownRoute → router.push(route); clear pending
```

## Testing (TDD, per repo convention)

- **`normalizeDeepLink`** — pure, exhaustive: `/focus`, `/reflection`, `/`, `""`,
  `undefined`, `null`, unknown path, path with query/hash, non-leading-slash.
- **`nextNav`** — all rows of the table, with the `anon → authed` replay as the key
  case (pendingUrl survives the anon pass and fires on the authed pass).
- **Route components** — minimal render tests: authed path fires the GET; anon path
  redirects to `/`.

Follow the mobile app's existing Vitest setup (`vitest.config.ts`). Pure functions
(`normalizeDeepLink`, `nextNav`) carry the bulk of coverage; component tests stay thin.

## Files

New:

- `artifacts/focusquest-mobile/src/routing/url-routing.ts`
- `artifacts/focusquest-mobile/src/routing/url-routing.test.ts`
- `artifacts/focusquest-mobile/src/routing/deep-link-routing.tsx`
- `artifacts/focusquest-mobile/src/routing/deep-link-routing.test.ts` (nextNav reducer + any hook-level tests)
- `artifacts/focusquest-mobile/app/focus.tsx`
- `artifacts/focusquest-mobile/app/reflection.tsx`
- (optional) `app/focus.test.tsx`, `app/reflection.test.tsx` if component tests warrant separate files

Modified:

- `artifacts/focusquest-mobile/app/_layout.tsx` — remove the notification-response
  `useEffect`; mount the `DeepLinkProvider`/`useDeepLinkRouting` inside `AuthProvider`.

Untouched: `src/auth/*`, `src/push/*`, `src/api/*`, `app.config.ts` (scheme
`focusquest://` already correct), server (`artifacts/api-server`).

## Non-goals (this spec)

- Full web parity of Focus or Reflection (→ #4b / #4c).
- Any server change — the native push path and `data.url` values already ship (#99).
- WebView/in-app-browser routing — explicitly rejected in favor of native screens.
- Auto-triggering login on tap — rejected in favor of silent-hold-then-replay.

## Execution model (matches the #99 run)

Subagent-driven development: implementers/reviewers on sonnet, final review on opus.
**No worktrees** (OneDrive locks). Branch-guard + explicit-path commits; never stage
the 13 `lib/api-zod/src/generated/types/` phantom files.

## Device-gated verification (Chad's side — needs the iPhone)

After merge, a dev-client rebuild + on-device check of all three tap paths:

1. `/focus` tap (trigger a body-double ally start) → lands on native Focus route.
2. `/reflection` tap (trigger/await the evening reflection prompt) → lands on native
   Reflection route.
3. `/` or absent-url tap (context/accountability nudge) → opens to home.
4. Cold-start tap **while logged out** → lands on login, then auto-carries to the
   target after login.

A runbook section will be authored during implementation for Chad to execute.
