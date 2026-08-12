# FocusQuest iOS App — Roadmap

**Date:** 2026-08-11
**Status:** Approved direction; foundation spike spec to follow.
**Decision:** Build a new **Expo / React Native** client in vertical slices. Not a WebView wrapper, not a screen-by-screen JSX port. Web PWA stays operational throughout.

---

## Why Expo (and why the backend is unusually ready)

Four load-bearing facts, each verified against the code:

| Claim | Evidence |
|---|---|
| API client is already Expo-ready | `lib/api-client-react/src/custom-fetch.ts:28` — `setBaseUrl` / `setAuthTokenGetter`, plus explicit React Native handling of `response.body === undefined` (`:120`) and missing `blob()` (`:262`). Built for RN deliberately. |
| Mobile PKCE token-exchange exists and is complete | `artifacts/api-server/src/routes/auth.ts:264` — full `authorizationCodeGrant` with `code_verifier`/`state`/`nonce`, session creation, returns bearer token. Plus `/mobile-auth/logout`. |
| Outbox is storage-agnostic | `artifacts/focusquest/src/lib/outbox/store.ts:3` — `OutboxStore` is a clean 4-method interface; replay logic sits above it and is contract-tested against the memory store. A SQLite adapter drops in with no replay changes. |
| Native push is the real backend gap | `lib/db/src/schema/push-subscriptions.ts:4` — schema is Web Push only (`endpoint`/`p256dh`/`auth`). No device/APNs model yet. |

Monorepo absorbs a sibling app cleanly: `pnpm-workspace.yaml:2` globs `artifacts/*`. Pure logic is already being extracted (`lib/hero-options`, `lib/quick-add`), so "create a shared core" is a continuation, not a new pattern.

A Capacitor/WebView build could reach the App Store in ~2–4 weeks but would still fundamentally be the web app — no native navigation, offline reliability, notifications, background behavior, or interaction quality. Rejected.

## Reusable vs. rebuild

| Reusable | Requires native implementation |
|---|---|
| Express API, database, business rules | All screen layouts and navigation |
| Generated React Query API hooks | Tailwind/Radix UI components |
| Pure TS rules & tests (`lib/quick-add`, `lib/hero-options`, …) | Offline storage (SQLite adapter) |
| Mobile PKCE token-exchange endpoint | Login browser flow + Keychain token storage |
| Images and LPC sprite **sheets** | Hero/kingdom **rendering** (Pixi does not port) |
| Product behavior and copy | Push (device model + APNs), voice capture, share sheet |
| Server-side focus-session timing | Background-safe timer presentation |

## Target structure

```
artifacts/
  focusquest/          existing web PWA (untouched)
  focusquest-mobile/   new Expo iOS app
lib/
  api-client-react/    shared API hooks (already RN-ready)
  focusquest-core/     platform-neutral rules (extend existing lib/* extractions)
```

Stack: Expo + Expo Router (native stacks/tabs), TanStack Query on the generated client, Secure Store (Keychain) for the bearer token, SQLite for the durable outbox, Expo Notifications/APNs, native audio, native share sheet, native lists/sheets/forms/gestures/haptics/safe-areas.

---

## Risks that shape sequencing

1. **pnpm + Metro hoisting** — Metro does not follow pnpm's symlinked `node_modules` by default. Resolve on day one of Phase 0 (`node-linker=hoisted` for the mobile package, or Expo's monorepo `metro.config.js` with `watchFolders` + `nodeModulesPaths`). Most likely thing to silently eat a day.
2. **Push backend is startable now, server-side, with no Expo dependency.** Design `device_tokens` + a delivery adapter (Web Push vs APNs/Expo by subscription kind) in parallel with the shell spike. Removes the biggest late-stage unknown.
3. **Hero renderer is a from-scratch rebuild.** The PixiJS hero animation (PR #93) — WebGL context, procedural effects — does not transfer. LPC sprite sheets (576×256, 9-frame) reuse directly; renderer rebuilds on `expo-gl`/Skia or a sprite-sheet component.
4. **App Store review is a designed-for risk.** (a) OIDC via ASWebAuthenticationSession, not an embedded webview. (b) Any money/coins → real-life-rewards flow triggers Apple IAP rules. 30-min audit before Phase 1.
5. **Focus timers derive from server timestamps, never a trusted JS timer.** Local notifications announce interval completion when backgrounded. (Already how the web app thinks.)

---

## Phased delivery

Vertical slices, each shippable to TestFlight, web app untouched. One experienced RN dev.

- **Phase 0 — Foundation spike (~1 wk).** `artifacts/focusquest-mobile` Expo app + Expo Router. **Resolve pnpm+Metro first.** Wire generated client via `setBaseUrl`/`setAuthTokenGetter` + Secure Store. End-to-end real-device auth: `expo-auth-session` (ASWebAuthenticationSession) → PKCE → existing `/mobile-auth/token-exchange` → Keychain bearer → one authenticated GET → clean logout. **Gate:** works on a physical, older iPhone.
- **Phase 0b — Push backend (parallel, server-only).** `device_tokens` schema, delivery adapter routing Web Push vs native, token rotation. No user-visible change.
- **Phase 1 — Core loop beta (~5–8 wks cumulative).** Onboarding → Now → tasks → quick-add → completion → XP feedback, native screens. The "does it feel good" milestone.
- **Phase 2 — Focus mode.** Native timer over server timestamps; background/resume correctness; local notifications.
- **Phase 3 — Durable offline.** SQLite `OutboxStore` adapter; React Query cache persistence; reconnection replay; native voice capture (`expo-av`) with verified upload format. Message honestly: "syncs when connectivity and execution permit."
- **Phase 4 — Native push (client).** Trivial given Phase 0b: device registration, APNs/Expo tokens, categories, deep links, badges, foreground + tap behavior.
- **Phase 5 — Progression.** Avatar/hero (new renderer, reused sheets), progress, insights, rewards.
- **Phase 6 — Social & long-form.** Partners, leaderboard, campaigns, questlines, recurring tasks.
- **Phase 7 — Release.** Accessibility, perf, device QA, privacy disclosures, IAP/auth compliance, TestFlight → App Store.

**Rough effort:** foundation spike ~1 wk · useful core beta ~5–8 wks · broad parity ~12–18 wks · full polish + release ~14–22 wks total.

## Divergences from the original Codex plan

- Split push into a **now-startable backend track (0b)** and a late client track (4).
- Made **pnpm+Metro** and **App Store review** explicit gates, not late discoveries.

## Next step

Spec the **foundation spike (Phase 0 + 0b)** first — it's the only architectural gamble; everything after is controlled feature work. Spec-first with an approval gate, matching the Honest Coin / hero-animation workflow.
