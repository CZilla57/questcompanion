# Native Push Fan-Out — Design

**Date:** 2026-08-12
**Branch:** (new) off `main` — target `feat/native-push-fanout` or similar
**Status:** Approved, pending implementation plan
**Related:** iOS device track (`2026-08-12-ios-device-track-results.md`). This closes device-track follow-up #3 ("wire the real push fan-out").

## Problem

The iOS client registers native push tokens into `device_tokens` via `POST /api/devices`, and the server has a fully built, unit-tested fan-out layer — `dispatchToUser` (`lib/device-dispatch.ts`) plus `expoHttpTransport` / `buildExpoMessages` / `sendExpoPush` / `deadTokensFromReceipts` (`lib/expo-push.ts`). **None of it is called by any production code path.** Every server-side push today goes only to web-push subscriptions (`push_subscriptions`), so a user whose only device is an iPhone receives nothing.

Three call sites each hand-roll the same web-only loop ("fetch subs → `sendPushNotification` → delete on failure"):

1. `lib/notification-scheduler.ts:48` — `notify()`, used by the scheduled envelope pass.
2. `routes/accountability.ts:406` — event-driven poke/cheer nudge to a recipient.
3. `routes/body-double.ts:86` — event-driven room-open invite to accepted allies.

## Goal

Route all three senders through `dispatchToUser` so native devices receive the same notifications as web, and collapse the triplicated web loop into one shared helper. No change to *which* notifications are sent, *when*, or to their gating (envelope budget/quiet-hours, `shouldSendInvitePush`) — only to the set of delivery channels reached.

Non-goals: client-side deep-link routing of `data.url` (device-track follow-up #4); any `apns`-provider raw-token path (none exist today); changing notification content, scheduling, or preference logic.

## Architecture

A single new module, `lib/push-dispatch.ts`, is the one seam between "we decided to notify user N with payload P" and the delivery channels. The three call sites call `pushToUser(userId, payload)` and no longer touch web-push directly.

```
call sites                     lib/push-dispatch.ts             existing (already tested)
─────────────                  ────────────────────             ─────────────────────────
scheduler notify()  ─┐
accountability nudge ─┼──▶ pushToUser(userId, payload) ──▶ dispatchToUser(deps, userId, payload)
body-double invite  ─┘         (best-effort wrapper)            ├─ sendWeb  → web-sub loop
                                                                ├─ sendExpo → expoHttpTransport
                                                                └─ prune dead device_tokens
```

## Components

### `lib/push-dispatch.ts` (new)

- **`sendWebToUser(userId, payload): Promise<number>`**
  The web-subscription loop, lifted verbatim from the three duplicated copies: select `push_subscriptions` for the user; for each, `sendPushNotification(keys, payload)`; on a falsy result delete that subscription (expired). Returns the count of successful sends. This becomes the `sendWeb` dep.

- **`buildDispatchDeps(): DispatchDeps`**
  Assembles the concrete `DispatchDeps` (`device-dispatch.ts` interface):
  - `listExpoTokens(userId)` → `select token from device_tokens where userId = ? and provider = 'expo'`, returning the token strings.
  - `sendExpo(tokens, payload)` → `sendExpoPush(buildExpoMessages(tokens, payload), expoHttpTransport)`.
  - `pruneTokens(tokens)` → `delete from device_tokens where token in (…)` (dead tokens flagged `DeviceNotRegistered` by `deadTokensFromReceipts`).
  - `sendWeb` → `sendWebToUser`.

- **`pushToUser(userId, payload): Promise<void>`**
  Calls `dispatchToUser(buildDispatchDeps(), userId, payload)` inside try/catch so it **never throws**; logs the returned `DispatchResult` (webSent / expoSent / pruned) at info and any thrown error at error. Best-effort delivery is the contract every caller relies on.

### Call-site changes

- **`lib/notification-scheduler.ts`**
  `notify(userId, title, body, tag, data?)` collapses to a thin builder that constructs a `PushPayload` (`{ title, body, tag, data }`) and `await pushToUser(userId, payload)`. The existing claim-before-send / rollback-on-throw block around the call (lines ~353–378) is left **unchanged**: `pushToUser` cannot throw, so the rollback branch never fires — identical to today's behavior, since the current web-only `notify` also never throws in practice. The now-unused `getSubscriptions`, `removeSubscription`, and the `sendPushNotification` import are removed from this file (their logic now lives in `push-dispatch.ts`).

- **`routes/accountability.ts`**
  Replace the `for (const sub …)` loop (lines ~403–413) with `await pushToUser(recipientId, { title, body: label, tag: \`nudge-${kind}\` })`. Persistence/response flow unchanged; still best-effort ("never blocks persistence").

- **`routes/body-double.ts`**
  Keep the `shouldSendInvitePush(ally, now)` quiet-hours gate. Replace the inner `for (const sub …)` loop (lines ~83–93) with `await pushToUser(ally.id, { title, body: "Drop in and work alongside", tag: "bodydouble-invite", data: { url: "/focus" } })`.

## Data flow

1. A site decides to notify user N with payload P (unchanged gating/decision logic).
2. `pushToUser(N, P)` → `dispatchToUser`:
   a. `sendWeb(N, P)` delivers to web subs, pruning expired ones, returns a count.
   b. `listExpoTokens(N)`; if none, done.
   c. `sendExpo(tokens, P)` posts one Expo batch via `expoHttpTransport`; receipts return 1:1.
   d. Tokens whose receipt is `DeviceNotRegistered` are pruned from `device_tokens`.
3. `pushToUser` logs `{ webSent, expoSent, pruned }`; swallows any error.

## Key decisions

1. **`provider = 'expo'` filter.** Expo's push API accepts only ExpoPushTokens. `listExpoTokens` filters to `provider = 'expo'`; `apns` rows (none exist today) are skipped rather than mis-sent. A future raw-APNs path would be a separate channel, not this one.

2. **Best-effort delivery; the scheduler's claim stays spent on partial failure.** `pushToUser` swallows errors, so a native-dispatch hiccup does not roll back the envelope's spacing/budget claim. This is the direction the scheduler already documents as the quiet, fail-safe one (a lost slot over a possible double-send) and matches the event sites' existing "best-effort" posture. Consequence: the scheduler's rollback-on-throw branch becomes effectively dead code; it is retained unchanged to avoid churn and preserve defense-in-depth.

3. **`expoHttpTransport` is hard-wired inside `buildDispatchDeps`.** Production always uses the real transport; tests exercise the pure pieces (`buildExpoMessages`, `dispatchToUser`, `sendExpoPush`) with injected fakes rather than swapping the transport at this layer. `pushToUser(userId, payload, deps = buildDispatchDeps())` takes an **optional** trailing `deps` argument defaulting to the real deps — production callers pass only `(userId, payload)`; the `pushToUser` test injects a fake `deps` to drive the best-effort/throw path.

## Error handling

- Transport-level failures (network, non-2xx, unparseable body) are already mapped to per-message error receipts by `expoHttpTransport` and never propagate.
- DB failures in `listExpoTokens` / `pruneTokens` / `sendWeb` propagate to `dispatchToUser` and are caught by `pushToUser`, logged, and swallowed.
- Web delivery runs before Expo; a later Expo/DB error cannot un-send web (accepted — the alternative, rolling back a committed scheduler claim, risks a double web-send next tick).

## Testing (TDD)

- **`sendWebToUser`** (new) — cover the branching that is currently untested in all three copies: successful send counts, prune-on-failure deletes the expired subscription, mixed success/failure returns the right count. Inject collaborators (subscription source, `sendPushNotification`, delete) so no real DB/VAPID is needed.
- **`pushToUser`** (new) — asserts it resolves without throwing when an injected dep throws (best-effort contract), and logs the `DispatchResult` on success. Requires `pushToUser` (or an internal `dispatchToUser` call) to accept an injectable deps override for the test; production callers use the zero-arg default.
- **Reused, no new tests needed:** `dispatchToUser` fan-out/prune (`device-dispatch.test.ts`), Expo transport + message building + dead-token detection (`expo-push.test.ts`).
- **`listExpoTokens` / `pruneTokens`** — thin drizzle queries mirroring `routes/devices.ts`; covered by typecheck. Optionally a light query-shape assertion if a DB test harness exists (none currently).
- Full suite: `pnpm --filter api-server test` + `typecheck` green before PR.

## Rollout

Pure server change, no migration (the `device_tokens` table already ships on `main` via #94). No env changes. Behavior for web-only users is byte-identical; native users begin receiving the same pushes. Ships as one PR into `main`.
