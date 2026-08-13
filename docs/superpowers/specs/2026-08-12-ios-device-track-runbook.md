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
1. `eas init` links the project. Its id is committed in `app.config.ts` `extra.eas.projectId` (dynamic config can't be auto-written).
2. The **APNs key** is set up as part of the EAS iOS build (step 2 below) when you let EAS manage credentials — no separate step needed. (`eas credentials` can inspect/manage it if required.)
3. The dev-client build carries the `aps-environment` entitlement via the `expo-notifications` plugin. If you add/remove native modules or plugins later, **rebuild the dev client** (a Metro reload is not enough).

---

## 2. Build the dev client (EAS cloud — required on Windows/Linux)

iOS binaries compile only on macOS, so `expo run:ios` does **not** work on Windows/Linux. Build in the cloud with **EAS Build** instead (the `development` profile in `eas.json` is preconfigured: `developmentClient: true`, internal distribution).

```bash
# 1. Register the physical iPhone (adds its UDID to the provisioning profile)
pnpm --filter focusquest-mobile exec eas device:create

# 2. Cloud-build the dev client — EAS handles Apple signing + the APNs push key interactively
pnpm --filter focusquest-mobile exec eas build -p ios --profile development

# 3. Install the finished build on the iPhone via the link/QR EAS returns
```

**On macOS** you may instead build locally: `pnpm --filter focusquest-mobile exec expo run:ios --device`.

> **Build status — first green dev client (2026-08-12):** EAS build `b01a2d69-4a6e-47d9-8f30-0cabf7643b0e` **finished** (commit `e9cc6ad`, SDK 53, dev-client, internal). `.ipa`: `https://expo.dev/artifacts/eas/mNXD209aWq0_qZTAKK_tDWdU2Mg60l2YCsC7mwNDdSw.ipa`.
>
> **Getting there took fixing the pnpm-monorepo install on the EAS runner** (three attempts):
> 1. `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` on `pnpm install --frozen-lockfile` — `overrides` lived only in `pnpm-workspace.yaml`, which the EAS image's older pnpm (~9.x) does not read.
> 2. Enabling `corepack: true` in `eas.json` pinned pnpm 11.11.0 but the image's **Node 20.19.2 bundles an old corepack that can't launch pnpm 11** (`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`). Reverted.
> 3. **Fix that stuck (`e9cc6ad`):** declare the same `overrides` in **both** `package.json` (`pnpm.overrides`, read by the image's old pnpm) **and** `pnpm-workspace.yaml` (read by pnpm 11). Each pnpm version reads its own source, both match the lockfile, no corepack/image change. Keep the two blocks in sync.

### Then run the JS and load the app
```bash
pnpm --filter focusquest-mobile exec expo start --dev-client
```
Open the installed dev client on the phone; it connects to Metro on your machine (same Wi‑Fi; press `s` for a tunnel if they're on different networks). Your local `.env` is read here, and the JS bundles here — so this step (not the cloud build) is what proves **Task 1 Step 8**: Metro resolving the pnpm-symlinked `@workspace/api-client-react`. A red-screen `Unable to resolve module @workspace/api-client-react` means fall back to a root `.npmrc` `node-linker=hoisted` and restart Metro.

> ⚠️ **Do NOT use Expo Go or the iOS Camera for this project.** This is a **dev client** (`developmentClient: true`) with native modules (`expo-dev-client`, `expo-notifications`), so:
> - **Expo Go will never load it** — it only runs pure-JS projects, so it silently does nothing. (If you're used to Expo Go from another project, that habit is the trap here.)
> - **The iOS Camera scanning the Metro QR shows "No data available"** — the Camera can't act on the `exp://` dev-server URL. That QR is meant to be opened *by the installed dev client*, not the Camera.
> - **The runtime IS the FocusQuest dev-client app you installed in step 3 above.** Ordered fix:
>   1. Install the dev client on the phone first — open the EAS **build page in Safari on the iPhone** and tap **Install** (the UDID is already in the provisioning profile). First launch: **Settings → General → VPN & Device Management** → trust the developer cert.
>   2. Run `expo start --dev-client` on your machine.
>   3. **Tap the FocusQuest icon** on the phone → its launcher lists your Metro server → tap to connect. To scan instead, use the **"Scan QR code" button inside the FocusQuest app**, never the Camera.
>   4. Phone can't reach Metro (different/locked-down Wi‑Fi)? Start with `expo start --dev-client --tunnel`.

> Note: with a dev client, `extra.apiUrl`/`auth0Domain`/`auth0ClientId` come from the **local** `app.config.ts` evaluation when you run `expo start` — so the `.env` on your machine drives runtime config; the cloud build doesn't bake in those values.

---

## 3. Gate G1 — Auth login round-trip

1. Launch; tap **Log in with Auth0** → the system browser opens Auth0 Universal Login.
2. Complete login → the browser returns to the app via `focusquest://auth`.
3. Screen shows **Authenticated ✓** and a `me:` line. (The `me:` value is a cosmetic smoke read — don't treat it as the gate; auth status is driven by token presence. If it shows `{}` the `/api/users/me` path/shape may differ, but G1/G2 still hold.)
4. Tap **Log out** → returns to the login button.

**If the redirect errors:** re-check the exact Allowed Callback URL (step 1b.1) and that you're on the dev client, not Expo Go.
**If the exchange errors (`invalid_grant`):** the client id (1a) doesn't match the server's Auth0 application, or the redirect URI the server rebuilds differs.
**If the exchange errors 500 `OAUTH_INVALID_RESPONSE`:** the server synthesizes the callback `iss` for the mobile flow and openid-client validates it against the discovered issuer exactly (RFC 9207). **Auth0's issuer ends in a trailing slash** (`https://<tenant>.us.auth0.com/`). Set `ISSUER_URL` with the trailing slash. (Code fix `030b75f` now derives `iss` from `config.serverMetadata().issuer`, so once deployed the env spelling no longer matters — but the running server must have that build or the slash.)

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
11. **React version must match the RN renderer, monorepo-wide** — Expo SDK 53 / RN 0.79.6 bundle the **React 19.0.0** renderer. The shared pnpm `catalog:` react therefore must be `19.0.0` (not 19.1.x). Two failure shapes: a `react` ahead of the renderer → red-screen *"Incompatible React versions"*; pinning **only** the mobile app (while transitive expo/router packages still resolve a different react) splits pnpm into **two `react-native` peer variants** → Metro bundles two copies → `InitializeCore` runs twice → startup crash *"property is not writable"* + *"'main' has not been registered"*. Fix at the source: keep the whole workspace on one react (catalog `react`/`react-dom` = `19.0.0`), then `expo start --dev-client --clear` (JS-only change — no rebuild). Verify a single copy: `node -e "console.log(require.resolve('react-native',{paths:['artifacts/focusquest-mobile/app']}))"` and confirm expo-router/react-native-screens resolve the *same* path.

---

## 7. After the gates pass — Task 10 (do NOT do before G3)

Once G3 is verified, close the spike:
- Remove the temporary `POST /devices/test-send` endpoint (`artifacts/api-server/src/routes/devices.ts`) — it exists only as the G3 trigger.
- Also carry forward the server-track **m2** hardening (make `expoHttpTransport` check `res.ok` and map failures to per-message error receipts) before `dispatchToUser` is wired into any real batch/cron fan-out.
- Write a short results doc: which gates passed on which device/iOS version, the resolved Metro strategy, the final Auth0 config that worked.
