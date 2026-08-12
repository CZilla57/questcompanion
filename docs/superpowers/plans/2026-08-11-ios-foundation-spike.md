# iOS Foundation Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove real-device Auth0 login against the existing FocusQuest session model on a new Expo iOS app, and build the server-side push groundwork (dual-provider `device_tokens` + Expo Push delivery) needed for native notifications.

**Architecture:** Two tracks. The **server track (Phase 0b)** adds a `device_tokens` table, a pure Expo-push sender and a fan-out dispatcher (both unit-tested against an injected `fetch`), and thin `/devices` routes — following the existing `src/lib/*` pure-logic + thin-route convention. The **client track (Phase 0)** is a new `artifacts/focusquest-mobile` Expo app that runs Auth0 Universal Login via `expo-auth-session` PKCE, exchanges the code through the existing `/mobile-auth/token-exchange` endpoint, stores the returned FocusQuest bearer token in the iOS Keychain, and registers an Expo push token. Success is three on-device gates (G1 auth, G2 durability, G3 push).

**Tech Stack:** Expo SDK (latest stable) + Expo Router, `expo-auth-session`, `expo-secure-store`, `expo-notifications`, TanStack Query on the existing generated `@workspace/api-client-react`, Express + Drizzle + Vitest on the server, pnpm workspaces.

**Design reference:** [2026-08-11-ios-foundation-spike-design.md](../specs/2026-08-11-ios-foundation-spike-design.md)

## Global Constraints

- **Package manager: pnpm only** (`packageManager: pnpm@11.11.0`). The root `preinstall` hard-fails on npm/yarn. Never run `npm install`/`yarn`.
- **Workspace install settings** (`pnpm-workspace.yaml`): `autoInstallPeers: false`, `minimumReleaseAge: 1440` (deps must be ≥24h old — brand-new releases will be refused; pin to a slightly older patch if install rejects a version).
- **New package name:** `focusquest-mobile`, directory `artifacts/focusquest-mobile` (picked up by the `artifacts/*` glob automatically).
- **API base URL:** injected via `EXPO_PUBLIC_API_URL`, pointed at **staging** for this spike. Never hardcode.
- **Auth0 callback scheme:** custom scheme `focusquest://auth` (Universal Links are out of scope).
- **Server session model is unchanged:** the app receives a FocusQuest session token from `/mobile-auth/token-exchange`; it never handles Auth0 tokens directly.
- **Server test convention:** pure logic in `artifacts/api-server/src/lib/*.ts`, unit-tested in a sibling `*.test.ts` with Vitest (`describe`/`it`/`expect`); no supertest, no live DB in unit tests. Network boundaries (Expo API) are injected so they can be stubbed.
- **DB imports** come from the `@workspace/db` barrel; auth in routes uses `req.isAuthenticated()` and `req.gameUserId`.
- **Run server tests from** `artifacts/api-server` with `pnpm test` (`vitest run`); a single file with `pnpm vitest run src/lib/<file>.test.ts`.

---

## Task 1: Expo app scaffold that resolves the pnpm workspace

The single most likely thing to silently eat a day is Metro failing to resolve pnpm's symlinked `node_modules`. Prove it works before anything else, by importing a real workspace package (`@workspace/api-client-react`) and rendering on the device.

**Files:**
- Create: `artifacts/focusquest-mobile/package.json`
- Create: `artifacts/focusquest-mobile/app.config.ts`
- Create: `artifacts/focusquest-mobile/metro.config.js`
- Create: `artifacts/focusquest-mobile/tsconfig.json`
- Create: `artifacts/focusquest-mobile/eas.json`
- Create: `artifacts/focusquest-mobile/app/_layout.tsx`
- Create: `artifacts/focusquest-mobile/app/index.tsx`
- Create: `artifacts/focusquest-mobile/.gitignore`

**Interfaces:**
- Produces: a bootable Expo dev-client app whose Metro config resolves workspace symlinks; later tasks add screens/modules under `app/` and `src/`.

- [ ] **Step 1: Create the package manifest**

`artifacts/focusquest-mobile/package.json`:

```json
{
  "name": "focusquest-mobile",
  "version": "0.0.0",
  "private": true,
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start --dev-client",
    "ios": "expo run:ios",
    "typecheck": "tsc --noEmit",
    "prebuild": "expo prebuild"
  },
  "dependencies": {
    "@workspace/api-client-react": "workspace:*",
    "expo": "^52.0.0",
    "expo-router": "^4.0.0",
    "expo-linking": "^7.0.0",
    "expo-constants": "^17.0.0",
    "expo-status-bar": "^2.0.0",
    "react": "19.1.0",
    "react-dom": "19.1.0",
    "react-native": "0.76.9",
    "react-native-safe-area-context": "^5.0.0",
    "react-native-screens": "^4.0.0"
  },
  "devDependencies": {
    "@types/react": "catalog:",
    "typescript": "~5.9.3"
  }
}
```

Note: exact Expo SDK / RN patch versions must be reconciled with `npx expo install --check` in Step 6; the versions above are the SDK 52 baseline. If `pnpm install` is refused by `minimumReleaseAge`, drop to the previous published patch.

- [ ] **Step 2: Create the Metro config that watches the monorepo root**

`artifacts/focusquest-mobile/metro.config.js`:

```js
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Watch the whole monorepo so Metro sees workspace packages.
config.watchFolders = [workspaceRoot];

// Resolve modules from the app first, then the hoisted root store.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// pnpm uses symlinks; modern Metro follows them. Keep this explicit.
config.resolver.unstable_enableSymlinks = true;
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
```

- [ ] **Step 3: Create app config, tsconfig, eas.json, gitignore**

`artifacts/focusquest-mobile/app.config.ts`:

```ts
import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "FocusQuest",
  slug: "focusquest-mobile",
  scheme: "focusquest",
  version: "0.0.1",
  orientation: "portrait",
  ios: {
    bundleIdentifier: "app.focusquest.mobile",
    supportsTablet: false,
  },
  plugins: ["expo-router", "expo-secure-store"],
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? null,
  },
};

export default config;
```

`artifacts/focusquest-mobile/tsconfig.json`:

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "baseUrl": "."
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"]
}
```

`artifacts/focusquest-mobile/eas.json`:

```json
{
  "cli": { "version": ">= 12.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": { "resourceClass": "m-medium" }
    }
  }
}
```

`artifacts/focusquest-mobile/.gitignore`:

```
/node_modules
/.expo
/ios
/android
*.log
```

- [ ] **Step 4: Create the root layout and a smoke-test screen that imports a workspace package**

`artifacts/focusquest-mobile/app/_layout.tsx`:

```tsx
import { Stack } from "expo-router";

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

`artifacts/focusquest-mobile/app/index.tsx` (imports the workspace package to force Metro to resolve a symlinked dependency — this is the actual thing under test):

```tsx
import { View, Text } from "react-native";
import { setBaseUrl } from "@workspace/api-client-react";

export default function Index() {
  // If this import resolves and the app renders, Metro + pnpm symlinks work.
  const resolved = typeof setBaseUrl === "function";
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text>FocusQuest mobile shell</Text>
      <Text>workspace client resolved: {String(resolved)}</Text>
    </View>
  );
}
```

Confirmed: `@workspace/api-client-react` exposes `.` → `./src/index.ts`, which re-exports `setBaseUrl`, `setAuthTokenGetter`, and everything from `custom-fetch` (including `customFetch`), plus the generated API/schemas. The import above resolves as written.

- [ ] **Step 5: Install dependencies from the workspace root**

Run: `pnpm install` (from `C:/dev/focusquest`)
Expected: completes without an npm/yarn rejection; `artifacts/focusquest-mobile/node_modules` is populated (symlinked). If `minimumReleaseAge` refuses a version, lower that dependency one patch and re-run.

- [ ] **Step 6: Align native dependency versions**

Run: `pnpm --filter focusquest-mobile exec expo install --check`
Expected: either "Dependencies are up to date" or a list of adjustments to apply; apply them, then `pnpm install` again.

- [ ] **Step 7: Typecheck the shell**

Run: `pnpm --filter focusquest-mobile typecheck`
Expected: PASS (no type errors).

- [ ] **Step 8: Build the dev client and launch on the physical device**

Run: `pnpm --filter focusquest-mobile exec expo run:ios --device`
(Select the connected iPhone. This produces the dev client; requires the paid Apple Developer team selected in Xcode signing.)
Expected: app installs and launches on the device showing "workspace client resolved: **true**". This is the gate — if the import fails, Metro shows a red-screen "Unable to resolve module @workspace/api-client-react". If so, add a root `.npmrc` line `node-linker=hoisted` and re-run `pnpm install` (documented fallback), then rebuild.

- [ ] **Step 9: Commit**

```bash
git add artifacts/focusquest-mobile
git commit -m "feat(mobile): scaffold Expo app resolving pnpm workspace on device"
```

---

## Task 2: Secure token store + API client wiring

Give the app a Keychain-backed session-token store and wire the generated API client to read it. Keep the storage-key/restore logic in a pure module so it is unit-testable without native modules.

**Files:**
- Create: `artifacts/focusquest-mobile/src/auth/token-store.ts`
- Create: `artifacts/focusquest-mobile/src/api/configure-client.ts`
- Create: `artifacts/focusquest-mobile/src/api/configure-client.test.ts`
- Modify: `artifacts/focusquest-mobile/package.json` (add `expo-secure-store`, `@tanstack/react-query`)
- Modify: `artifacts/focusquest-mobile/app/_layout.tsx` (configure client + QueryClientProvider at startup)

**Interfaces:**
- Consumes: `setBaseUrl`, `setAuthTokenGetter` from `@workspace/api-client-react`.
- Produces:
  - `token-store.ts`: `saveToken(token: string): Promise<void>`, `getToken(): Promise<string | null>`, `clearToken(): Promise<void>`, and const `TOKEN_KEY = "fq.session.token"`.
  - `configure-client.ts`: `resolveApiUrl(extra: unknown): string` (pure, throws if missing), and `configureApiClient(tokenGetter: () => Promise<string | null>): void`.

- [ ] **Step 1: Write the failing test for `resolveApiUrl`**

`artifacts/focusquest-mobile/src/api/configure-client.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveApiUrl } from "./configure-client";

describe("resolveApiUrl", () => {
  it("returns the apiUrl from expo extra", () => {
    expect(resolveApiUrl({ apiUrl: "https://staging.example.com" })).toBe(
      "https://staging.example.com",
    );
  });

  it("throws when apiUrl is missing or blank", () => {
    expect(() => resolveApiUrl({ apiUrl: null })).toThrow(/EXPO_PUBLIC_API_URL/);
    expect(() => resolveApiUrl({})).toThrow(/EXPO_PUBLIC_API_URL/);
    expect(() => resolveApiUrl({ apiUrl: "  " })).toThrow(/EXPO_PUBLIC_API_URL/);
  });
});
```

Note: this package has no Vitest yet. Add `vitest` to `devDependencies` and a `"test": "vitest run"` script in `artifacts/focusquest-mobile/package.json`, and a minimal `vitest.config.ts` with `test: { environment: "node" }` so pure modules test without a native runtime.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter focusquest-mobile test src/api/configure-client.test.ts`
Expected: FAIL — `resolveApiUrl` is not defined.

- [ ] **Step 3: Implement `configure-client.ts`**

```ts
import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";

export function resolveApiUrl(extra: unknown): string {
  const url =
    extra && typeof extra === "object"
      ? (extra as Record<string, unknown>).apiUrl
      : undefined;
  if (typeof url !== "string" || url.trim() === "") {
    throw new Error("EXPO_PUBLIC_API_URL is not configured (expo extra.apiUrl)");
  }
  return url.trim();
}

export function configureApiClient(
  tokenGetter: () => Promise<string | null>,
): void {
  setAuthTokenGetter(tokenGetter);
}

export { setBaseUrl };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter focusquest-mobile test src/api/configure-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the Keychain token store**

`artifacts/focusquest-mobile/src/auth/token-store.ts`:

```ts
import * as SecureStore from "expo-secure-store";

export const TOKEN_KEY = "fq.session.token";

export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
```

- [ ] **Step 6: Wire client configuration at app startup**

Replace `artifacts/focusquest-mobile/app/_layout.tsx`:

```tsx
import { Stack } from "expo-router";
import Constants from "expo-constants";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { resolveApiUrl, configureApiClient, setBaseUrl } from "../src/api/configure-client";
import { getToken } from "../src/auth/token-store";

setBaseUrl(resolveApiUrl(Constants.expoConfig?.extra));
configureApiClient(getToken);

const queryClient = new QueryClient();

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }} />
    </QueryClientProvider>
  );
}
```

- [ ] **Step 7: Install new deps and typecheck**

Run: `pnpm --filter focusquest-mobile exec expo install expo-secure-store @tanstack/react-query` then `pnpm --filter focusquest-mobile typecheck`
Expected: install succeeds; typecheck PASS.

- [ ] **Step 8: Commit**

```bash
git add artifacts/focusquest-mobile
git commit -m "feat(mobile): Keychain token store and API client wiring"
```

---

## Task 3: PKCE helpers (pure, TDD)

The authorization request needs a PKCE `code_verifier`/`code_challenge`, plus random `state` and `nonce`. Isolate the pure, testable derivation from the native crypto/random source.

**Files:**
- Create: `artifacts/focusquest-mobile/src/auth/pkce.ts`
- Create: `artifacts/focusquest-mobile/src/auth/pkce.test.ts`

**Interfaces:**
- Produces:
  - `base64UrlEncode(bytes: Uint8Array): string`
  - `deriveChallenge(verifier: string, sha256: (input: string) => Promise<Uint8Array>): Promise<string>` — returns the base64url-encoded SHA-256 of the verifier (S256).
  - `randomString(bytes: Uint8Array): string` — base64url of supplied random bytes (caller supplies bytes from `expo-crypto`).

- [ ] **Step 1: Write the failing tests**

`artifacts/focusquest-mobile/src/auth/pkce.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { base64UrlEncode, deriveChallenge, randomString } from "./pkce";

describe("base64UrlEncode", () => {
  it("encodes bytes URL-safely with no padding", () => {
    // 0xFB 0xFF -> standard base64 '+/8=' -> url-safe '-_8'
    expect(base64UrlEncode(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
  });
});

describe("deriveChallenge", () => {
  it("base64url-encodes the sha256 of the verifier", async () => {
    // Fake digest: return a fixed 2-byte array regardless of input.
    const fakeSha = async (_: string) => new Uint8Array([0xfb, 0xff]);
    expect(await deriveChallenge("verifier", fakeSha)).toBe("-_8");
  });
});

describe("randomString", () => {
  it("base64url-encodes supplied random bytes", () => {
    expect(randomString(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter focusquest-mobile test src/auth/pkce.test.ts`
Expected: FAIL — module not found / functions undefined.

- [ ] **Step 3: Implement `pkce.ts`**

```ts
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  // btoa exists in the RN/Hermes runtime and in Node's test env.
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function deriveChallenge(
  verifier: string,
  sha256: (input: string) => Promise<Uint8Array>,
): Promise<string> {
  return base64UrlEncode(await sha256(verifier));
}

export function randomString(bytes: Uint8Array): string {
  return base64UrlEncode(bytes);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter focusquest-mobile test src/auth/pkce.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest-mobile/src/auth/pkce.ts artifacts/focusquest-mobile/src/auth/pkce.test.ts
git commit -m "feat(mobile): pure PKCE helpers with tests"
```

---

## Task 4: Auth context + Auth0 login → server token-exchange (Gate G1 + G2)

Wire the full login loop: launch Auth0 Universal Login via `expo-auth-session`, receive the code at `focusquest://auth`, POST it to the existing `/mobile-auth/token-exchange`, persist the returned FocusQuest token, and restore it on launch.

**Files:**
- Create: `artifacts/focusquest-mobile/src/auth/auth-context.tsx`
- Create: `artifacts/focusquest-mobile/src/auth/token-exchange.ts`
- Modify: `artifacts/focusquest-mobile/app/_layout.tsx` (wrap in `AuthProvider`)
- Modify: `artifacts/focusquest-mobile/app/index.tsx` (login/logout UI + authenticated GET)
- Modify: `artifacts/focusquest-mobile/package.json` (add `expo-auth-session`, `expo-crypto`, `expo-web-browser`)

**Interfaces:**
- Consumes: `deriveChallenge`/`randomString` (Task 3); `saveToken`/`getToken`/`clearToken` (Task 2).
- Produces: `useAuth(): { status: "loading" | "authed" | "anon"; login(): Promise<void>; logout(): Promise<void> }` from `auth-context.tsx`; `exchangeCode(params): Promise<string>` from `token-exchange.ts` returning the FocusQuest session token.

**Auth0 / server prerequisites (do before Step 6):**
- In the Auth0 application: add `focusquest://auth` to **Allowed Callback URLs**; confirm the app permits Authorization Code + PKCE alongside the client secret the server holds (Regular Web App with PKCE).
- Confirm the staging server has `ISSUER_URL`/`OAUTH_CLIENT_ID`/`OAUTH_CLIENT_SECRET` pointing at the Auth0 tenant, and that `/api/auth/mobile-auth/token-exchange` is reachable from the device.

- [ ] **Step 1: Implement the token-exchange call**

`artifacts/focusquest-mobile/src/auth/token-exchange.ts`:

```ts
import { customFetch } from "@workspace/api-client-react";

export interface ExchangeParams {
  code: string;
  code_verifier: string;
  redirect_uri: string;
  state: string;
  nonce: string | null;
}

// Posts to the existing provider-agnostic endpoint; returns the FocusQuest
// session token (see artifacts/api-server/src/routes/auth.ts token-exchange).
export async function exchangeCode(params: ExchangeParams): Promise<string> {
  const res = await customFetch<{ token: string }>(
    "/api/mobile-auth/token-exchange",
    { method: "POST", body: JSON.stringify(params) },
  );
  return res.token;
}
```

Path confirmed: the auth router mounts bare (`router.use(authRouter)` in `routes/index.ts`) and defines `router.post("/mobile-auth/token-exchange", …)` (`artifacts/api-server/src/routes/auth.ts:264`); the top-level router mounts under `/api` (`app.ts:60`). Full path is therefore `/api/mobile-auth/token-exchange`.

- [ ] **Step 2: Implement the auth context**

`artifacts/focusquest-mobile/src/auth/auth-context.tsx`:

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import * as AuthSession from "expo-auth-session";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import Constants from "expo-constants";
import { deriveChallenge, randomString } from "./pkce";
import { exchangeCode } from "./token-exchange";
import { saveToken, getToken, clearToken } from "./token-store";

WebBrowser.maybeCompleteAuthSession();

type Status = "loading" | "authed" | "anon";
interface AuthValue {
  status: Status;
  login(): Promise<void>;
  logout(): Promise<void>;
}
const AuthContext = createContext<AuthValue | null>(null);

const ISSUER = "https://<your-tenant>.auth0.com"; // move to expo extra in hardening
const CLIENT_ID = "<auth0-native-facing-client-id>"; // move to expo extra
const REDIRECT_URI = AuthSession.makeRedirectUri({ scheme: "focusquest", path: "auth" });

async function sha256Bytes(input: string): Promise<Uint8Array> {
  const hex = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    getToken().then((t) => setStatus(t ? "authed" : "anon"));
  }, []);

  async function login() {
    const discovery = await AuthSession.fetchDiscoveryAsync(ISSUER);
    const verifier = randomString(Crypto.getRandomBytes(32));
    const state = randomString(Crypto.getRandomBytes(16));
    const nonce = randomString(Crypto.getRandomBytes(16));
    const challenge = await deriveChallenge(verifier, sha256Bytes);

    const req = new AuthSession.AuthRequest({
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      responseType: "code",
      scopes: ["openid", "email", "profile", "offline_access"],
      state,
      extraParams: { nonce, code_challenge: challenge, code_challenge_method: "S256" },
    });

    const result = await req.promptAsync(discovery);
    if (result.type !== "success" || !result.params.code) return;

    const token = await exchangeCode({
      code: result.params.code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
      state,
      nonce,
    });
    await saveToken(token);
    setStatus("authed");
  }

  async function logout() {
    await clearToken();
    setStatus("anon");
  }

  return <AuthContext.Provider value={{ status, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
```

Note: `ISSUER`/`CLIENT_ID` are placeholders to fill from the Auth0 tenant; for the spike, hardcoding is acceptable but prefer reading from `Constants.expoConfig?.extra` alongside `apiUrl`. The `AuthRequest` uses Auth0's PKCE; the server completes the confidential exchange.

- [ ] **Step 3: Wrap the app and build the login screen**

Update `app/_layout.tsx` to wrap `<Stack>` in `<AuthProvider>` (import from `../src/auth/auth-context`).

Replace `app/index.tsx`:

```tsx
import { View, Text, Button } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "../src/auth/auth-context";

export default function Index() {
  const { status, login, logout } = useAuth();

  const me = useQuery({
    enabled: status === "authed",
    queryKey: ["me"],
    queryFn: () => customFetch<{ id: number }>("/api/users/me"),
  });

  if (status === "loading") return <Centered><Text>Loading…</Text></Centered>;
  if (status === "anon")
    return <Centered><Button title="Log in with Auth0" onPress={() => login()} /></Centered>;

  return (
    <Centered>
      <Text>Authenticated ✓</Text>
      <Text>me: {me.isLoading ? "…" : JSON.stringify(me.data ?? me.error)}</Text>
      <Button title="Log out" onPress={() => logout()} />
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1, gap: 12, alignItems: "center", justifyContent: "center" }}>{children}</View>;
}
```

Confirmed: `/api/users/me` exists (`artifacts/api-server/src/routes/users.ts:39`, mounted bare under `/api`) and returns the current user (`username`, `displayName`, level info). Adjust the destructured shape in the query if you assert on specific fields.

- [ ] **Step 4: Install deps, typecheck**

Run: `pnpm --filter focusquest-mobile exec expo install expo-auth-session expo-crypto expo-web-browser` then `pnpm --filter focusquest-mobile typecheck`
Expected: PASS. Rebuild the dev client if a new native module was added: `pnpm --filter focusquest-mobile exec expo run:ios --device`.

- [ ] **Step 5: Run unit tests (no regressions)**

Run: `pnpm --filter focusquest-mobile test`
Expected: PASS (pkce + configure-client suites green).

- [ ] **Step 6: Verify Gate G1 on device (manual)**

With `EXPO_PUBLIC_API_URL` set to staging, launch on the iPhone:
1. Tap "Log in with Auth0" → the system browser opens Auth0 Universal Login.
2. Complete login → the browser returns to the app via `focusquest://auth`.
3. The screen shows "Authenticated ✓" and `me:` renders a real user object from staging.
4. Tap "Log out" → returns to the login button.
Expected: all four succeed. If the callback errors, re-check the Auth0 Allowed Callback URL and the token-exchange route path.

- [ ] **Step 7: Verify Gate G2 on device (manual)**

Log in, then force-quit and relaunch the app.
Expected: the app opens directly to "Authenticated ✓" with no re-login (token restored from Keychain).

- [ ] **Step 8: Commit**

```bash
git add artifacts/focusquest-mobile
git commit -m "feat(mobile): Auth0 login via server token-exchange with Keychain session (G1,G2)"
```

---

## Task 5: `device_tokens` schema + migration

Add the dual-provider device-token table alongside the untouched Web Push table.

**Files:**
- Create: `lib/db/src/schema/device-tokens.ts`
- Modify: `lib/db/src/schema/index.ts` (add `export * from "./device-tokens";`)
- Create (generated): `lib/db/drizzle/0008_native_device_tokens.sql`

**Interfaces:**
- Produces: `deviceTokensTable` and `type DeviceToken` exported from `@workspace/db`; columns `id`, `userId`, `provider`, `token`, `platform`, `createdAt`, `lastSeenAt`; unique on `(provider, token)`.

- [ ] **Step 1: Write the schema module**

`lib/db/src/schema/device-tokens.ts`:

```ts
import { pgTable, serial, integer, text, timestamp, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const deviceTokensTable = pgTable(
  "device_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id),
    provider: text("provider").notNull(), // 'expo' | 'apns'
    token: text("token").notNull(),
    platform: text("platform").notNull().default("ios"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  },
  (t) => ({
    providerToken: unique("device_tokens_provider_token_key").on(t.provider, t.token),
  }),
);

export type DeviceToken = typeof deviceTokensTable.$inferSelect;
```

- [ ] **Step 2: Add the barrel export**

In `lib/db/src/schema/index.ts`, add after the `push-subscriptions` export:

```ts
export * from "./device-tokens";
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm --filter @workspace/db generate`
Expected: a new file `lib/db/drizzle/0008_*.sql` creating `device_tokens` with the unique constraint. Rename it to `0008_native_device_tokens.sql` if the tool used a random suffix and update `lib/db/drizzle/meta` accordingly (or re-run generate after renaming the journal entry — follow whatever the existing 0007 file did).

- [ ] **Step 4: Typecheck the db package**

Run: `pnpm --filter @workspace/db exec tsc --noEmit` (or `pnpm typecheck:libs` from root)
Expected: PASS.

- [ ] **Step 5: Apply the migration to staging**

Run: `pnpm --filter @workspace/db migrate` against the staging `DATABASE_URL`.
Expected: migration applies; `device_tokens` exists in staging.

- [ ] **Step 6: Commit**

```bash
git add lib/db/src/schema/device-tokens.ts lib/db/src/schema/index.ts lib/db/drizzle
git commit -m "feat(db): dual-provider device_tokens table + migration"
```

---

## Task 6: Expo Push sender (pure decision logic + injected transport)

Build the Expo sender so all decision logic (message construction, chunking, and which tokens to prune from receipts) is pure and unit-tested; the actual HTTP POST is an injected function.

**Files:**
- Create: `artifacts/api-server/src/lib/expo-push.ts`
- Create: `artifacts/api-server/src/lib/expo-push.test.ts`

**Interfaces:**
- Produces:
  - `buildExpoMessages(tokens: string[], payload: PushPayload): ExpoMessage[]` where `ExpoMessage = { to: string; title: string; body: string; data?: Record<string, unknown> }` and `PushPayload` is re-used from `./push-notifications`.
  - `deadTokensFromReceipts(tokens: string[], receipts: ExpoReceipt[]): string[]` — returns tokens whose receipt is `{ status: "error", details?: { error: "DeviceNotRegistered" } }`, aligned positionally.
  - `sendExpoPush(messages: ExpoMessage[], transport: ExpoTransport): Promise<ExpoReceipt[]>` where `ExpoTransport = (batch: ExpoMessage[]) => Promise<ExpoReceipt[]>`.

- [ ] **Step 1: Write the failing tests**

`artifacts/api-server/src/lib/expo-push.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { buildExpoMessages, deadTokensFromReceipts, sendExpoPush } from "./expo-push";

const payload = { title: "T", body: "B", data: { url: "/focus" } };

describe("buildExpoMessages", () => {
  it("maps each token to an Expo message with title/body/data", () => {
    expect(buildExpoMessages(["ExpoTok[A]", "ExpoTok[B]"], payload)).toEqual([
      { to: "ExpoTok[A]", title: "T", body: "B", data: { url: "/focus" } },
      { to: "ExpoTok[B]", title: "T", body: "B", data: { url: "/focus" } },
    ]);
  });

  it("returns an empty array for no tokens", () => {
    expect(buildExpoMessages([], payload)).toEqual([]);
  });
});

describe("deadTokensFromReceipts", () => {
  it("returns only tokens whose receipt is DeviceNotRegistered", () => {
    const receipts = [
      { status: "ok" as const },
      { status: "error" as const, details: { error: "DeviceNotRegistered" } },
    ];
    expect(deadTokensFromReceipts(["A", "B"], receipts)).toEqual(["B"]);
  });
});

describe("sendExpoPush", () => {
  it("delegates to the injected transport and returns its receipts", async () => {
    const transport = vi.fn().mockResolvedValue([{ status: "ok" }]);
    const messages = buildExpoMessages(["A"], payload);
    const receipts = await sendExpoPush(messages, transport);
    expect(transport).toHaveBeenCalledWith(messages);
    expect(receipts).toEqual([{ status: "ok" }]);
  });

  it("does not call the transport when there are no messages", async () => {
    const transport = vi.fn();
    expect(await sendExpoPush([], transport)).toEqual([]);
    expect(transport).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @workspace/api-server vitest run src/lib/expo-push.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `expo-push.ts`**

```ts
import type { PushPayload } from "./push-notifications";

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export type ExpoReceipt =
  | { status: "ok" }
  | { status: "error"; details?: { error?: string } };

export type ExpoTransport = (batch: ExpoMessage[]) => Promise<ExpoReceipt[]>;

export function buildExpoMessages(tokens: string[], payload: PushPayload): ExpoMessage[] {
  return tokens.map((to) => ({
    to,
    title: payload.title,
    body: payload.body,
    ...(payload.data ? { data: payload.data } : {}),
  }));
}

export function deadTokensFromReceipts(tokens: string[], receipts: ExpoReceipt[]): string[] {
  const dead: string[] = [];
  receipts.forEach((r, i) => {
    if (r.status === "error" && r.details?.error === "DeviceNotRegistered" && tokens[i]) {
      dead.push(tokens[i]);
    }
  });
  return dead;
}

export async function sendExpoPush(
  messages: ExpoMessage[],
  transport: ExpoTransport,
): Promise<ExpoReceipt[]> {
  if (messages.length === 0) return [];
  return transport(messages);
}

// Default transport posts to Expo's push API. Not exercised in unit tests.
export const expoHttpTransport: ExpoTransport = async (batch) => {
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(batch),
  });
  const json = (await res.json()) as { data?: ExpoReceipt[] };
  return json.data ?? batch.map(() => ({ status: "error", details: { error: "NoReceipt" } }));
};
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @workspace/api-server vitest run src/lib/expo-push.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/expo-push.ts artifacts/api-server/src/lib/expo-push.test.ts
git commit -m "feat(api): Expo push sender with pure, tested decision logic"
```

---

## Task 7: Notification dispatcher (fan-out over Web Push + device tokens)

A dispatcher that, given a user, sends a payload to their Web Push subscriptions (existing path, unchanged) **and** their Expo device tokens, pruning dead tokens. Keep the fan-out planning pure; inject both senders and the data lookups.

**Files:**
- Create: `artifacts/api-server/src/lib/device-dispatch.ts`
- Create: `artifacts/api-server/src/lib/device-dispatch.test.ts`

**Interfaces:**
- Consumes: `PushPayload` (`./push-notifications`); `ExpoReceipt`, `deadTokensFromReceipts` (`./expo-push`).
- Produces: `dispatchToUser(deps: DispatchDeps, userId: number, payload: PushPayload): Promise<DispatchResult>` where
  - `DispatchDeps = { listExpoTokens(userId): Promise<string[]>; sendExpo(tokens, payload): Promise<ExpoReceipt[]>; pruneTokens(tokens): Promise<void>; sendWeb(userId, payload): Promise<number> }`
  - `DispatchResult = { webSent: number; expoSent: number; pruned: number }`

- [ ] **Step 1: Write the failing tests**

`artifacts/api-server/src/lib/device-dispatch.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { dispatchToUser } from "./device-dispatch";

const payload = { title: "T", body: "B" };

function deps(over = {}) {
  return {
    listExpoTokens: vi.fn().mockResolvedValue(["A", "B"]),
    sendExpo: vi.fn().mockResolvedValue([{ status: "ok" }, { status: "error", details: { error: "DeviceNotRegistered" } }]),
    pruneTokens: vi.fn().mockResolvedValue(undefined),
    sendWeb: vi.fn().mockResolvedValue(2),
    ...over,
  };
}

describe("dispatchToUser", () => {
  it("fans out to web and expo and prunes dead tokens", async () => {
    const d = deps();
    const result = await dispatchToUser(d, 7, payload);
    expect(d.sendWeb).toHaveBeenCalledWith(7, payload);
    expect(d.sendExpo).toHaveBeenCalledWith(["A", "B"], payload);
    expect(d.pruneTokens).toHaveBeenCalledWith(["B"]);
    expect(result).toEqual({ webSent: 2, expoSent: 1, pruned: 1 });
  });

  it("skips expo send and prune when the user has no device tokens", async () => {
    const d = deps({ listExpoTokens: vi.fn().mockResolvedValue([]) });
    const result = await dispatchToUser(d, 7, payload);
    expect(d.sendExpo).not.toHaveBeenCalled();
    expect(d.pruneTokens).not.toHaveBeenCalled();
    expect(result).toEqual({ webSent: 2, expoSent: 0, pruned: 0 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @workspace/api-server vitest run src/lib/device-dispatch.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `device-dispatch.ts`**

```ts
import type { PushPayload } from "./push-notifications";
import { deadTokensFromReceipts, type ExpoReceipt } from "./expo-push";

export interface DispatchDeps {
  listExpoTokens(userId: number): Promise<string[]>;
  sendExpo(tokens: string[], payload: PushPayload): Promise<ExpoReceipt[]>;
  pruneTokens(tokens: string[]): Promise<void>;
  sendWeb(userId: number, payload: PushPayload): Promise<number>;
}

export interface DispatchResult {
  webSent: number;
  expoSent: number;
  pruned: number;
}

export async function dispatchToUser(
  deps: DispatchDeps,
  userId: number,
  payload: PushPayload,
): Promise<DispatchResult> {
  const webSent = await deps.sendWeb(userId, payload);

  const tokens = await deps.listExpoTokens(userId);
  if (tokens.length === 0) return { webSent, expoSent: 0, pruned: 0 };

  const receipts = await deps.sendExpo(tokens, payload);
  const okCount = receipts.filter((r) => r.status === "ok").length;
  const dead = deadTokensFromReceipts(tokens, receipts);
  if (dead.length > 0) await deps.pruneTokens(dead);

  return { webSent, expoSent: okCount, pruned: dead.length };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @workspace/api-server vitest run src/lib/device-dispatch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/device-dispatch.ts artifacts/api-server/src/lib/device-dispatch.test.ts
git commit -m "feat(api): notification dispatcher fanning out to web push + expo"
```

---

## Task 8: `/devices` routes (register, deregister, test-send)

Thin HTTP layer over the schema and dispatcher, following the `notifications.ts` route pattern.

**Files:**
- Create: `artifacts/api-server/src/routes/devices.ts`
- Modify: `artifacts/api-server/src/routes/index.ts` (import + `router.use(devicesRouter)`)

**Interfaces:**
- Consumes: `deviceTokensTable`, `db` (`@workspace/db`); `dispatchToUser` (Task 7); `sendExpoPush`, `expoHttpTransport`, `buildExpoMessages` (Task 6); `sendPushNotification` + `pushSubscriptionsTable` for the `sendWeb` binding.
- Produces: routes `POST /devices`, `DELETE /devices/:token`, `POST /devices/test-send`.

- [ ] **Step 1: Implement the router**

`artifacts/api-server/src/routes/devices.ts`:

```ts
import { Router, type IRouter } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db, deviceTokensTable, pushSubscriptionsTable } from "@workspace/db";
import { sendPushNotification, type PushPayload } from "../lib/push-notifications";
import { buildExpoMessages, sendExpoPush, expoHttpTransport } from "../lib/expo-push";
import { dispatchToUser, type DispatchDeps } from "../lib/device-dispatch";

const router: IRouter = Router();

router.post("/devices", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const { token, provider } = req.body as { token?: string; provider?: string };
  if (!token || (provider !== "expo" && provider !== "apns")) {
    res.status(400).json({ error: "token and provider ('expo'|'apns') are required" });
    return;
  }
  await db
    .insert(deviceTokensTable)
    .values({ userId, provider, token, platform: "ios" })
    .onConflictDoUpdate({
      target: [deviceTokensTable.provider, deviceTokensTable.token],
      set: { userId, lastSeenAt: new Date() },
    });
  res.status(201).json({ success: true });
});

router.delete("/devices/:token", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  await db.delete(deviceTokensTable).where(
    and(eq(deviceTokensTable.userId, userId), eq(deviceTokensTable.token, req.params.token)),
  );
  res.json({ success: true });
});

function dispatchDeps(): DispatchDeps {
  return {
    async listExpoTokens(userId) {
      const rows = await db.select().from(deviceTokensTable).where(
        and(eq(deviceTokensTable.userId, userId), eq(deviceTokensTable.provider, "expo")),
      );
      return rows.map((r) => r.token);
    },
    async sendExpo(tokens, payload) {
      return sendExpoPush(buildExpoMessages(tokens, payload), expoHttpTransport);
    },
    async pruneTokens(tokens) {
      if (tokens.length === 0) return;
      await db.delete(deviceTokensTable).where(inArray(deviceTokensTable.token, tokens));
    },
    async sendWeb(userId, payload) {
      const subs = await db.select().from(pushSubscriptionsTable).where(
        eq(pushSubscriptionsTable.userId, userId),
      );
      let sent = 0;
      for (const s of subs) {
        if (await sendPushNotification(s, payload)) sent++;
      }
      return sent;
    },
  };
}

// TEMPORARY: G3 verification trigger. Remove before the phase closes (Task 10).
router.post("/devices/test-send", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const payload: PushPayload = {
    title: "FocusQuest",
    body: "Test notification from staging ✓",
    data: { url: "/" },
  };
  const result = await dispatchToUser(dispatchDeps(), req.gameUserId, payload);
  res.json(result);
});

export default router;
```

Note: `onConflictDoUpdate` targets the `(provider, token)` unique constraint from Task 5.

- [ ] **Step 2: Mount the router**

In `artifacts/api-server/src/routes/index.ts`: add `import devicesRouter from "./devices";` with the other imports and `router.use(devicesRouter);` alongside `notificationsRouter`.

- [ ] **Step 3: Typecheck and run the server test suite**

Run: `pnpm --filter @workspace/api-server test`
Expected: PASS (existing suites + Tasks 6–7 green; no route regressions).

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/devices.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat(api): /devices register, deregister, and temporary test-send"
```

---

## Task 9: Client push registration + tap handling (Gate G3)

Register for notifications on login, obtain the Expo push token, POST it to `/devices`, and deep-link on tap.

**Files:**
- Create: `artifacts/focusquest-mobile/src/push/register-device.ts`
- Modify: `artifacts/focusquest-mobile/src/auth/auth-context.tsx` (register on login; deregister on logout)
- Modify: `artifacts/focusquest-mobile/app.config.ts` (add `expo-notifications` plugin)
- Modify: `artifacts/focusquest-mobile/package.json` (add `expo-notifications`, `expo-device`)

**Interfaces:**
- Consumes: `customFetch` (`@workspace/api-client-react`).
- Produces: `registerForPush(): Promise<string | null>` (returns the Expo token or null if denied/unsupported) and `deregisterPush(token: string): Promise<void>`.

- [ ] **Step 1: Implement device registration**

`artifacts/focusquest-mobile/src/push/register-device.ts`:

```ts
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { customFetch } from "@workspace/api-client-react";

export async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice) return null; // Simulator cannot receive push.

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;
  if (!granted) granted = (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return null;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const { data: token } = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );

  await customFetch("/api/devices", {
    method: "POST",
    body: JSON.stringify({ token, provider: "expo" }),
  });
  return token;
}

export async function deregisterPush(token: string): Promise<void> {
  await customFetch(`/api/devices/${encodeURIComponent(token)}`, { method: "DELETE" });
}
```

- [ ] **Step 2: Register on login, deregister on logout**

In `auth-context.tsx`: import `registerForPush`, `deregisterPush`; keep the returned token in a module-level ref/state. After `saveToken(token); setStatus("authed");` call `registerForPush().then((t) => { pushToken = t; })`. In `logout()`, before `clearToken()`, `if (pushToken) await deregisterPush(pushToken)`.

- [ ] **Step 3: Add the notifications plugin and foreground handler**

In `app.config.ts` add `"expo-notifications"` to `plugins`. In `app/_layout.tsx`, set the foreground handler once at module scope:

```ts
import * as Notifications from "expo-notifications";
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});
```

And register a tap listener in `RootLayout` via `useEffect` that reads `response.notification.request.content.data.url` and routes with `expo-router` (`router.push(url)`).

- [ ] **Step 4: Install deps, typecheck, rebuild dev client**

Run: `pnpm --filter focusquest-mobile exec expo install expo-notifications expo-device` then `pnpm --filter focusquest-mobile typecheck` then rebuild: `pnpm --filter focusquest-mobile exec expo run:ios --device`
Expected: install + typecheck PASS; dev client reinstalls (native module added).

- [ ] **Step 5: Verify Gate G3 on device (manual)**

1. Log in on the device (grant the notification permission prompt).
2. Confirm the token landed: query staging `device_tokens` for the user, or check the `POST /devices` 201 in server logs.
3. Trigger a send: authenticated `POST /api/devices/test-send` (from the app, a temporary button, or an authenticated curl with the session token). With the app backgrounded / device locked, a banner "Test notification from staging ✓" appears.
4. Tap the banner → the app opens/foregrounds to `/`.
Expected: banner delivered and tap deep-links. If nothing arrives, verify the APNs key is configured for the Expo project and the build is a dev client (not Expo Go).

- [ ] **Step 6: Commit**

```bash
git add artifacts/focusquest-mobile
git commit -m "feat(mobile): Expo push registration and tap deep-link (G3)"
```

---

## Task 10: Close the spike — remove the temporary trigger, document results

**Files:**
- Modify: `artifacts/api-server/src/routes/devices.ts` (remove `POST /devices/test-send` and now-unused imports)
- Create: `docs/superpowers/specs/2026-08-11-ios-foundation-spike-results.md`

- [ ] **Step 1: Remove the test-send endpoint**

Delete the `POST /devices/test-send` handler and any imports it alone used (`dispatchToUser`/`dispatchDeps`/`buildExpoMessages`/`sendExpoPush`/`expoHttpTransport`/`sendPushNotification`/`pushSubscriptionsTable` if unreferenced). Keep `dispatchToUser` + `dispatchDeps` only if a real caller now exists; for this spike, if nothing else calls them, leave the `device-dispatch.ts`/`expo-push.ts` modules in place (they are the tested groundwork for Phase 4) but drop the route-level wiring.

- [ ] **Step 2: Run the full server suite**

Run: `pnpm --filter @workspace/api-server test`
Expected: PASS (dispatcher and expo-push unit tests still green; no dangling references).

- [ ] **Step 3: Write the results doc**

Record: which gates passed on which device/iOS version, the resolved Metro/pnpm strategy (symlinks vs hoisted), the final Auth0 app configuration that worked (callback URL, PKCE+secret setting), and any follow-ups for Phase 1. Keep it short.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/devices.ts docs/superpowers/specs/2026-08-11-ios-foundation-spike-results.md
git commit -m "chore(ios): remove temporary test-send; record foundation-spike results"
```

---

## Self-review notes

- **Spec §1 gates** → G1/G2 in Task 4 (steps 6–7), G3 in Task 9 (step 5). Covered.
- **Spec §2 workspace/build** → Task 1 (Metro/pnpm, EAS dev client, `EXPO_PUBLIC_API_URL` wiring in Task 2). Covered.
- **Spec §3 auth** → Tasks 2–4 (Secure Store, PKCE, `expo-auth-session` → server token-exchange, custom scheme, Auth0 config note). Covered.
- **Spec §4 push backend** → Tasks 5–8 (dual-provider schema, delivery adapter, Expo sender, `/devices` incl. test-send). Covered.
- **Spec §5 testing** → server unit tests in Tasks 6–7 (routing/dedupe/prune, injected Expo boundary); pure-helper tests in Tasks 2–3; manual on-device gates for auth/push. Covered.
- **Spec §6 test-send removal at phase close** → Task 10. Covered.
- **Type consistency:** `PushPayload` reused from `push-notifications.ts` across Tasks 6–8; `ExpoReceipt`/`deadTokensFromReceipts` defined in Task 6 and consumed in Task 7; `DispatchDeps` defined in Task 7 and constructed in Task 8; `deviceTokensTable` `(provider, token)` unique (Task 5) matches `onConflictDoUpdate` target (Task 8). Consistent.
- **Pre-verified against source:** `@workspace/api-client-react` export surface (exports `setBaseUrl`/`setAuthTokenGetter`/`customFetch`), the token-exchange path (`/api/mobile-auth/token-exchange`), and the authenticated GET (`/api/users/me`) are all confirmed in-plan, not assumed.
- **Remaining verify-as-you-go item:** the drizzle migration journal/naming handling (Task 5) — follow whatever the existing `0007` migration did rather than assume the generator's suffix.
