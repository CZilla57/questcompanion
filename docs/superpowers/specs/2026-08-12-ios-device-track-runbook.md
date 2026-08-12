# iOS Device-Track Runbook (Gates G1 / G2 / G3)

**Date:** 2026-08-12
**Branch:** `feat/ios-mobile-client`
**Audience:** the human running the on-device gates. The code for Tasks 1–4 + 9 is implemented, unit-tested (mobile suite 15/15, typecheck 0), and reviewed. What remains can only be done on a physical iPhone with your Auth0 tenant + Apple Developer account. This runbook is the ordered path to green.

> The app authenticates against **Auth0**; the client runs Universal Login with **manual PKCE** (`usePKCE:false`) and hands the auth code to the existing server `/api/mobile-auth/token-exchange`, which does the confidential exchange and returns a FocusQuest session token. The app never holds Auth0 tokens.

---

## 1. Prerequisites (do these before building)

### 1a. Environment variables
Create `artifacts/focusquest-mobile/.env` (git-ignored — never commit) or set EAS secrets. All are `EXPO_PUBLIC_*` so they inline into the client:

| Var | Value | Notes |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | `https://getfocusquest.com` | The deployed API+web origin (Render service `questcompanion`; also reachable at `https://questcompanion.onrender.com`). Must be reachable **from the phone** — not `localhost`. Used by token-exchange, `/api/devices`, `/api/users/me`. Source of truth: the server's own `APP_ORIGIN` default (`notification-scheduler.ts:392`). Verify: `curl https://getfocusquest.com/api/healthz` → 200. Note: Render **free** plan cold-starts, so the first request after idle may be slow — retry once. |
| `EXPO_PUBLIC_AUTH0_DOMAIN` | bare tenant host, e.g. `your-tenant.auth0.com` | No scheme/trailing slash (the helper strips them). |
| `EXPO_PUBLIC_AUTH0_CLIENT_ID` | the Auth0 application's client id | **Must be the SAME Auth0 application the server redeems with** (`OAUTH_CLIENT_ID`). A different client → `invalid_grant`. |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | *(optional — already set)* | The EAS project id `55090098-eb9a-4b03-b87c-fcd62c0781cd` is committed in `app.config.ts` `extra.eas.projectId` (a public, non-secret UUID; the EAS CLI resolves the dynamic config statically, so it must live there — hence `eas init` couldn't auto-write it). Set this env var only to override with a different EAS project. |

### 1b. Auth0 dashboard (for G1)
1. **Allowed Callback URLs:** add exactly `focusquest://auth`. On launch, `login()` logs `Auth redirect URI: …` — copy that literal value; it must match here. (Under Expo Go it would be an `exp://…` URI — you must run the **dev-client** build, not Expo Go.)
2. **App type / grants:** the client authorizes with PKCE (public) and the **server** redeems the code with the client **secret** (confidential). Use an application that permits both — a **Regular Web Application** holding the secret works, redeemed with `pkceCodeVerifier`. Confirm Authorization Code grant is enabled.
3. Confirm `EXPO_PUBLIC_AUTH0_DOMAIN` and the server's `ISSUER_URL` are the **same tenant**, and the client ids match (1a).

### 1c. Staging server (for G1 + G3)
- `ISSUER_URL` / `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` point at the Auth0 tenant; `/api/mobile-auth/token-exchange` reachable from the device.
- **Apply migration `0008_native_device_tokens` to staging** (deferred from the server track). G3's `POST /api/devices` writes to `device_tokens`; the table must exist. Run `pnpm --filter @workspace/db migrate` against the staging `DATABASE_URL`.

### 1d. EAS + APNs (for G3)
1. `eas init` to link the project (populates the project id — put it in `EXPO_PUBLIC_EAS_PROJECT_ID`).
2. Upload an **APNs key** to EAS (`eas credentials`) so Expo Push can deliver to iOS.
3. The dev-client build must carry the `aps-environment` entitlement. The `expo-notifications` plugin adds it, but you must **regenerate the dev client** after the plugin was added (a Metro reload is not enough) — see step 2.

---

## 2. Build the dev client on the device

```bash
pnpm --filter focusquest-mobile exec expo run:ios --device
```

Select the connected iPhone; the paid Apple Developer team must be chosen for signing. This is also **Task 1 Step 8** — the app building and running at all is the proof that Metro resolves the pnpm-symlinked `@workspace/api-client-react` at runtime (the deferred de-risking check). A red-screen `Unable to resolve module @workspace/api-client-react` means fall back to a root `.npmrc` `node-linker=hoisted` and rebuild.

---

## 3. Gate G1 — Auth login round-trip

1. Launch; tap **Log in with Auth0** → the system browser opens Auth0 Universal Login.
2. Complete login → the browser returns to the app via `focusquest://auth`.
3. Screen shows **Authenticated ✓** and a `me:` line. (The `me:` value is a cosmetic smoke read — don't treat it as the gate; auth status is driven by token presence. If it shows `{}` the `/api/users/me` path/shape may differ, but G1/G2 still hold.)
4. Tap **Log out** → returns to the login button.

**If the redirect errors:** re-check the exact Allowed Callback URL (step 1b.1) and that you're on the dev client, not Expo Go.
**If the exchange errors (`invalid_grant`):** the client id (1a) doesn't match the server's Auth0 application, or the redirect URI the server rebuilds differs.

## 4. Gate G2 — session persistence

Log in, then **force-quit and relaunch**. The app should open directly to **Authenticated ✓** with no re-login (token restored from the iOS Keychain). Logout after a relaunch now also ends the server session and deregisters the push token.

## 5. Gate G3 — native push

1. Log in and **grant** the notification permission prompt (if denied, `registerForPush` returns null and no token is stored — re-grant in iOS Settings and log in again).
2. Confirm the token landed: check staging `device_tokens` for your user, or the `POST /api/devices` 201 in server logs.
3. Trigger a send: authenticated `POST /api/devices/test-send` (from the app, a temporary button, or `curl` with your session bearer token). With the app backgrounded / device locked, a banner **"Test notification from staging ✓"** appears.
4. Tap the banner → the app opens/foregrounds. The G3 payload routes to `/` (a no-op navigation), so to actually *observe* deep-link routing, temporarily point the payload's `data.url` at a distinct route.
5. Test **all three** tap paths: foreground (banner via the handler), background tap (live listener), and **killed/cold-start** tap (handled via `getLastNotificationResponseAsync`).

---

## 6. Top failure points (ordered — from the whole-branch review)

1. **Missing EAS `projectId`** (G3 blocker #1) — `EXPO_PUBLIC_EAS_PROJECT_ID` unset → `getExpoPushTokenAsync` throws.
2. **APNs credentials / entitlement** — projectId alone isn't enough; needs the APNs key in EAS and a dev-client rebuilt after the notifications plugin was added.
3. **Client/server Auth0 client id mismatch** → `invalid_grant` at exchange.
4. **Allowed Callback URL mismatch** → redirect fails (must equal the logged `focusquest://auth`; dev client, not Expo Go).
5. **Auth0 app type** must accept PKCE authorize + confidential secret exchange.
6. **Discovery reachability** — device must reach `https://<domain>/.well-known/openid-configuration`.
7. **API base URL** must be phone-reachable (not `localhost`); unset → app warns and every call fails.
8. **Staging migration `0008` not applied** → `POST /api/devices` fails (no `device_tokens` table).
9. **Notification permission denied** → no token registered.
10. **Simulator can't do push** — G3 is physical-device only (`registerForPush` early-returns on Simulator).

---

## 7. After the gates pass — Task 10 (do NOT do before G3)

Once G3 is verified, close the spike:
- Remove the temporary `POST /devices/test-send` endpoint (`artifacts/api-server/src/routes/devices.ts`) — it exists only as the G3 trigger.
- Also carry forward the server-track **m2** hardening (make `expoHttpTransport` check `res.ok` and map failures to per-message error receipts) before `dispatchToUser` is wired into any real batch/cron fan-out.
- Write a short results doc: which gates passed on which device/iOS version, the resolved Metro strategy, the final Auth0 config that worked.
