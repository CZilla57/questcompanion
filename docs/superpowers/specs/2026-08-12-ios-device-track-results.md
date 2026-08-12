# iOS Device-Track Results (Gates G1 / G2 / G3)

**Date:** 2026-08-12
**Branch:** `feat/ios-mobile-client` (PR #95); server track merged via #94; cleanup in #96.
**Outcome:** ✅ All three gates passed on a physical device.

## Gates

| Gate | What it proves | Result |
|---|---|---|
| **G1** | Auth0 Universal Login → manual PKCE → server `/api/mobile-auth/token-exchange` → FocusQuest session token | ✅ **Authenticated ✓** |
| **G2** | Session restored from iOS Keychain on cold start (force-quit → relaunch, no re-login) | ✅ Reopens authenticated |
| **G3** | Native push: permission → Expo token → `POST /api/devices` → dispatch → APNs banner, all three tap paths | ✅ Banner + foreground / background / cold-start taps all route |

## Environment

- **Device:** physical iPhone (UDID `00008140-001A1020269B001C`), iOS `<fill in tested version>`.
- **Build:** EAS cloud dev-client, build `b01a2d69-4a6e-47d9-8f30-0cabf7643b0e`, commit `e9cc6ad`, Expo SDK 53 / RN 0.79.6.
- **Dev client install:** over-the-air from the EAS build page on the phone — **not** Expo Go (Expo Go can't run a dev client with native modules).

## Metro / monorepo strategy that worked

- Default **pnpm isolated** node_modules — `node-linker=hoisted` was **not** needed. The existing `metro.config.js` (`watchFolders` = workspace root, `nodeModulesPaths` = app then root, symlinks enabled) resolved `@workspace/api-client-react` fine.
- Run JS with `npx expo start --dev-client` from `artifacts/focusquest-mobile`; add `--clear` after any dependency change (stale Metro cache bit us during the React fix).

## Final Auth0 config

- **Tenant:** `dev-l8qcb6yfss8tt7oj.us.auth0.com` (client + server `ISSUER_URL` must be the same tenant).
- **Allowed Callback URL:** `focusquest://auth` (exact match to the app's logged redirect URI; dev client, not Expo Go).
- **App type:** Regular Web Application — client does PKCE authorize (public), server redeems the code with the client secret (confidential) using `pkceCodeVerifier`.
- **Client id match:** `EXPO_PUBLIC_AUTH0_CLIENT_ID` (client) == `OAUTH_CLIENT_ID` (server), else `invalid_grant`.
- **`ISSUER_URL` must end in a trailing slash** (`https://<tenant>/`) — see fixes below.

## Fixes required along the way (the real work)

1. **EAS pnpm-monorepo install** (`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`): declare `overrides` in **both** `package.json` (`pnpm.overrides`) and `pnpm-workspace.yaml`. The EAS image's older pnpm reads the former; local pnpm 11 reads the latter. Corepack pinning was a dead end (image's Node 20.19.2 bundles a corepack that can't launch pnpm 11 → `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`).
2. **React version** (`property is not writable` / `"main" has not been registered` at startup): RN 0.79.6 bundles the React **19.0.0** renderer, but the shared catalog pinned 19.1.0. Pinning only the app split the pnpm peer graph into two `react-native` variants → duplicate `InitializeCore`. Fix: unify the whole workspace catalog on `react`/`react-dom` = **19.0.0**.
3. **Dev client vs Expo Go**: the iOS Camera scanning the Metro QR shows "No data available"; Expo Go silently does nothing. Install and open the FocusQuest dev client instead.
4. **G1 `OAUTH_INVALID_RESPONSE`**: the server synthesizes the callback `iss` for the mobile flow; openid-client validates it against the discovered issuer exactly (RFC 9207). Auth0's issuer ends in `/`. Immediate fix: `ISSUER_URL` trailing slash. Permanent: derive `iss` from `config.serverMetadata().issuer` (commit `030b75f`, in PR #95).
5. **G3 `Cannot POST /api/devices` (404)**: the devices route/dispatcher lived only on the feature branch — production (`main`) never had it. Merged the server track (#94) to deploy it. Migration `0008_native_device_tokens` also applied to the production DB.

## Follow-ups

- **PR #96** — remove the temporary `POST /devices/test-send` endpoint (was live on prod via #94) and harden `expoHttpTransport` (`res.ok` + per-message error receipts) before real fan-out.
- Temporary G3 test-send **button** removed from `app/index.tsx`.
- After #96 merges, **rebase `feat/ios-mobile-client` (#95) onto `main`** so the duplicated server files reconcile (test-send removal + transport hardening flow in without conflict).
- Fill in the exact iOS version tested above.
