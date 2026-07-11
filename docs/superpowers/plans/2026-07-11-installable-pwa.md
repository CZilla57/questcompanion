# Installable PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make FocusQuest installable to the home screen on Android/desktop (Chrome/Edge) and iOS (Safari) with a custom in-app install prompt, without adding offline support.

**Architecture:** Add a web app manifest + PNG icon set to the Vite `public/` dir (served as-is by the existing `express.static`). Register the existing push service worker on app load and give it a no-op `fetch` handler so browsers judge the app installable. Extract install decisions into a pure `lib/pwa.ts` (unit-tested in the node vitest env), wrapped by a `usePwaInstall` hook that feeds two UI surfaces: a dismissable banner and a header/sidebar button.

**Tech Stack:** React 19 + Vite, TypeScript, Tailwind v4, lucide-react, wouter, vitest (node env). `sharp` as a dev-only icon-generation tool.

## Global Constraints

- **No offline support.** The `sw.js` `fetch` handler must be a no-op that never calls `event.respondWith` — no caching, no offline fallback.
- **Do not change push behavior.** `useNotifications` keeps working; `serviceWorker.register` is idempotent, so on-load registration must not break subscribe/unsubscribe.
- **Dark chrome color:** manifest `theme_color`/`background_color` and the maskable icon field are `#090b15` (the app's `--background`, `hsl(230 40% 6%)`), not the `#FF3C00` brand orange.
- **Icon set (exact):** `public/icons/icon-192.png` (192), `icon-512.png` (512), `icon-512-maskable.png` (512, ≥10% safe-zone padding), `apple-touch-icon.png` (180).
- **Test env is `node`** (see `vitest.config.ts`) — no DOM. Only pure, framework-free logic gets unit tests; React glue is covered by typecheck + a live install check.
- **All paths are under `artifacts/focusquest/`** unless stated otherwise.
- **pnpm only.** Install deps with `pnpm --filter @workspace/focusquest add -D <pkg>`.
- **Branch:** work on `feat/installable-pwa` (already checked out). Verify with `git branch --show-current` before each commit (this working tree is shared across sessions).

---

### Task 1: App icons + generator script

Generates the PNG icon set from user-supplied art at `public/icons/source.png`, falling back to rasterizing `public/favicon.svg` when that art is not yet present (so the feature is testable immediately and simply upgrades when real art lands).

**Files:**
- Modify: `artifacts/focusquest/package.json` (add `sharp` devDep + a `gen:icons` script)
- Modify: `pnpm-workspace.yaml` (add `sharp` to `onlyBuiltDependencies`)
- Create: `artifacts/focusquest/scripts/generate-pwa-icons.mjs`
- Create (generated, committed): `artifacts/focusquest/public/icons/icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `apple-touch-icon.png`
- Optional (committed if provided): `artifacts/focusquest/public/icons/source.png`

**Interfaces:**
- Produces: the four icon files at the paths above, consumed by Task 2 (manifest) and Task 3 (`index.html`).

- [ ] **Step 1: Add sharp as a dev dependency**

Run: `pnpm --filter @workspace/focusquest add -D sharp`

Then add `sharp` to `onlyBuiltDependencies` in `pnpm-workspace.yaml` so its native binary is allowed to build:

```yaml
onlyBuiltDependencies:
  - '@swc/core'
  - esbuild
  - msw
  - unrs-resolver
  - sharp
```

- [ ] **Step 2: Add the generator script**

Create `artifacts/focusquest/scripts/generate-pwa-icons.mjs`:

```js
// One-off asset generator for the PWA icon set.
// Preferred source: public/icons/source.png (a square, full-bleed PNG, >=512px).
// Fallback: rasterize public/favicon.svg so the icons exist even before final art.
// Re-run after dropping in real art: `pnpm --filter @workspace/focusquest gen:icons`.
import sharp from "sharp";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const iconsDir = path.join(root, "public", "icons");
const sourcePng = path.join(iconsDir, "source.png");
const faviconSvg = path.join(root, "public", "favicon.svg");
const BG = "#090b15"; // app --background

async function loadSource() {
  if (existsSync(sourcePng)) {
    console.log("Using source.png");
    return sharp(sourcePng);
  }
  console.log("source.png not found — rasterizing favicon.svg as a placeholder");
  // density lifts the 180px SVG to a crisp 1024px raster.
  const buf = await sharp(faviconSvg, { density: 384 })
    .resize(1024, 1024, { fit: "cover" })
    .png()
    .toBuffer();
  return sharp(buf);
}

async function square(src, size, file) {
  await src.clone().resize(size, size, { fit: "cover" }).png().toFile(path.join(iconsDir, file));
  console.log("wrote", file);
}

const src = await loadSource();

await square(src, 192, "icon-192.png");
await square(src, 512, "icon-512.png");
await square(src, 180, "apple-touch-icon.png");

// Maskable: source at ~80% centered on a solid #090b15 field (safe zone for
// Android adaptive-icon cropping).
const inner = await src.clone().resize(410, 410, { fit: "cover" }).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: BG } })
  .composite([{ input: inner, gravity: "center" }])
  .png()
  .toFile(path.join(iconsDir, "icon-512-maskable.png"));
console.log("wrote icon-512-maskable.png");
```

Add a script to `artifacts/focusquest/package.json` `scripts`:

```json
"gen:icons": "node scripts/generate-pwa-icons.mjs"
```

- [ ] **Step 3: Place source art (if available) and generate**

If the user's icon art is ready, save it as `artifacts/focusquest/public/icons/source.png` first. Then run:

Run: `pnpm --filter @workspace/focusquest gen:icons`
Expected: logs `wrote icon-192.png` … `wrote icon-512-maskable.png` (prefixed by either "Using source.png" or the favicon-fallback line).

- [ ] **Step 4: Verify the four files exist with correct dimensions**

Run (resolves `sharp` from the package's own `node_modules`):
`pnpm --filter @workspace/focusquest exec node -e "import('sharp').then(async ({default:s})=>{for(const [f,n] of [['icon-192.png',192],['icon-512.png',512],['icon-512-maskable.png',512],['apple-touch-icon.png',180]]){const m=await s('public/icons/'+f).metadata();if(m.width!==n||m.height!==n)throw new Error(f+' is '+m.width+'x'+m.height);console.log(f,'OK',m.width+'x'+m.height)}})"`
Expected: four `OK` lines, each square at the right size.

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml artifacts/focusquest/package.json artifacts/focusquest/scripts/generate-pwa-icons.mjs artifacts/focusquest/public/icons/
git commit -m "feat(web): generate PWA app icon set"
```

---

### Task 2: Web app manifest + validity test

**Files:**
- Create: `artifacts/focusquest/public/manifest.webmanifest`
- Create: `artifacts/focusquest/src/lib/manifest.test.ts`

**Interfaces:**
- Consumes: the icon files from Task 1.
- Produces: `/manifest.webmanifest` at the web root, linked by Task 3.

- [ ] **Step 1: Write the failing test**

Create `artifacts/focusquest/src/lib/manifest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const publicDir = path.resolve(import.meta.dirname, "..", "..", "public");
const manifest = JSON.parse(
  readFileSync(path.join(publicDir, "manifest.webmanifest"), "utf8"),
);

describe("web app manifest", () => {
  it("has the required installability fields", () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe("/");
    expect(["standalone", "fullscreen", "minimal-ui"]).toContain(manifest.display);
  });

  it("declares 192 and 512 icons plus a maskable variant", () => {
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    const purposes = manifest.icons.map((i: { purpose?: string }) => i.purpose);
    expect(purposes).toContain("maskable");
  });

  it("references icon files that exist on disk", () => {
    for (const icon of manifest.icons as { src: string }[]) {
      const rel = icon.src.replace(/^\//, "");
      expect(existsSync(path.join(publicDir, rel)), `${icon.src} missing`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/focusquest exec vitest run src/lib/manifest.test.ts`
Expected: FAIL — `ENOENT` reading `manifest.webmanifest` (file not created yet).

- [ ] **Step 3: Create the manifest**

Create `artifacts/focusquest/public/manifest.webmanifest`:

```json
{
  "name": "FocusQuest",
  "short_name": "FocusQuest",
  "description": "Gamified tasks and habits — complete quests, earn XP, build streaks.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#090b15",
  "theme_color": "#090b15",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/focusquest exec vitest run src/lib/manifest.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/public/manifest.webmanifest artifacts/focusquest/src/lib/manifest.test.ts
git commit -m "feat(web): add web app manifest + validity test"
```

---

### Task 3: index.html install metadata

**Files:**
- Modify: `artifacts/focusquest/index.html`

**Interfaces:**
- Consumes: `/manifest.webmanifest` (Task 2), `/icons/apple-touch-icon.png` (Task 1).

- [ ] **Step 1: Add the viewport-fit and head tags**

In `artifacts/focusquest/index.html`, change the viewport meta to add `viewport-fit=cover`:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1, viewport-fit=cover" />
```

Then, immediately after the existing `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />` line, add:

```html
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="#090b15" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="FocusQuest" />
```

- [ ] **Step 2: Verify the build still succeeds and copies assets**

Run: `pnpm --filter @workspace/focusquest build`
Expected: build completes; `dist/public/manifest.webmanifest` and `dist/public/icons/icon-192.png` exist afterward.

Run: `ls artifacts/focusquest/dist/public/manifest.webmanifest artifacts/focusquest/dist/public/icons/`
Expected: manifest + four icons listed.

- [ ] **Step 3: Commit**

```bash
git add artifacts/focusquest/index.html
git commit -m "feat(web): link manifest, theme-color, and apple touch icon in index.html"
```

---

### Task 4: Pure install logic (`lib/pwa.ts`) + tests

**Files:**
- Create: `artifacts/focusquest/src/lib/pwa.ts`
- Create: `artifacts/focusquest/src/lib/pwa.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 5–6):
  - `type PromptOutcome = "accepted" | "dismissed" | "unavailable"`
  - `interface InstallPromptEvent { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }`
  - `detectIsIOS(userAgent: string, maxTouchPoints?: number): boolean`
  - `detectIsStandalone(matchStandalone: boolean, navigatorStandalone: boolean | undefined): boolean`
  - `runInstallPrompt(event: InstallPromptEvent | null): Promise<PromptOutcome>`
  - `primeInstallCapture(): void`
  - `getDeferredPrompt(): InstallPromptEvent | null`
  - `clearDeferredPrompt(): void`
  - `subscribeInstall(listener: () => void): () => void`

- [ ] **Step 1: Write the failing test**

Create `artifacts/focusquest/src/lib/pwa.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { detectIsIOS, detectIsStandalone, runInstallPrompt } from "./pwa";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
const IPADOS = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15";
const DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36 Chrome/120 Safari/537.36";
const ANDROID = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";

describe("detectIsIOS", () => {
  it("is true for iPhone", () => expect(detectIsIOS(IPHONE)).toBe(true));
  it("is true for iPadOS reporting as Macintosh with touch", () =>
    expect(detectIsIOS(IPADOS, 5)).toBe(true));
  it("is false for desktop Safari/Chrome without touch", () =>
    expect(detectIsIOS(DESKTOP, 0)).toBe(false));
  it("is false for Android", () => expect(detectIsIOS(ANDROID, 5)).toBe(false));
});

describe("detectIsStandalone", () => {
  it("is true when display-mode:standalone matches", () =>
    expect(detectIsStandalone(true, undefined)).toBe(true));
  it("is true for iOS navigator.standalone", () =>
    expect(detectIsStandalone(false, true)).toBe(true));
  it("is false in a normal browser tab", () =>
    expect(detectIsStandalone(false, false)).toBe(false));
});

describe("runInstallPrompt", () => {
  it("returns 'unavailable' with no event", async () =>
    expect(await runInstallPrompt(null)).toBe("unavailable"));

  it("calls prompt() and returns the accepted outcome", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = { prompt, userChoice: Promise.resolve({ outcome: "accepted" as const }) };
    expect(await runInstallPrompt(event)).toBe("accepted");
    expect(prompt).toHaveBeenCalledOnce();
  });

  it("propagates a dismissed outcome", async () => {
    const event = {
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: "dismissed" as const }),
    };
    expect(await runInstallPrompt(event)).toBe("dismissed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/focusquest exec vitest run src/lib/pwa.test.ts`
Expected: FAIL — cannot resolve `./pwa` / functions not defined.

- [ ] **Step 3: Write the implementation**

Create `artifacts/focusquest/src/lib/pwa.ts`:

```ts
// Pure, framework-free helpers for PWA install decisions, plus a tiny
// module-level holder for the (single-use) beforeinstallprompt event.
// The React hook (use-pwa-install.ts) wires browser globals into these.

export type PromptOutcome = "accepted" | "dismissed" | "unavailable";

/** The subset of the non-standard BeforeInstallPromptEvent we rely on. */
export interface InstallPromptEvent {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** True on iOS/iPadOS, where install is manual (no beforeinstallprompt event). */
export function detectIsIOS(userAgent: string, maxTouchPoints = 0): boolean {
  const ua = userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ presents a desktop "Macintosh" UA; disambiguate via touch.
  return /Macintosh/.test(ua) && maxTouchPoints > 1;
}

/** True when already running installed (standalone display). */
export function detectIsStandalone(
  matchStandalone: boolean,
  navigatorStandalone: boolean | undefined,
): boolean {
  return matchStandalone || navigatorStandalone === true;
}

/** Run the browser install prompt (if any) and normalize the result. */
export async function runInstallPrompt(
  event: InstallPromptEvent | null,
): Promise<PromptOutcome> {
  if (!event) return "unavailable";
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome;
}

// --- beforeinstallprompt holder -------------------------------------------
// The event is single-use and can fire before React mounts, so we capture it
// at module scope (primed from main.tsx) and let hooks subscribe for changes.

let deferredPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

export function primeInstallCapture(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as unknown as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
  });
}

export function getDeferredPrompt(): InstallPromptEvent | null {
  return deferredPrompt;
}

export function clearDeferredPrompt(): void {
  deferredPrompt = null;
  notify();
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/focusquest exec vitest run src/lib/pwa.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/lib/pwa.ts artifacts/focusquest/src/lib/pwa.test.ts
git commit -m "feat(web): pure PWA install logic + beforeinstallprompt holder"
```

---

### Task 5: Service worker on-load registration + no-op fetch handler

**Files:**
- Modify: `artifacts/focusquest/public/sw.js`
- Modify: `artifacts/focusquest/src/main.tsx`

**Interfaces:**
- Consumes: `primeInstallCapture` from `@/lib/pwa` (Task 4).

- [ ] **Step 1: Add the no-op fetch handler to the service worker**

Append to `artifacts/focusquest/public/sw.js`:

```js
self.addEventListener("fetch", () => {
  // No-op: present only so the app meets PWA installability criteria.
  // Intentionally does NOT call event.respondWith — every request goes to the
  // network. There is no offline caching in this version.
});
```

- [ ] **Step 2: Register the service worker on load and prime install capture**

Replace the contents of `artifacts/focusquest/src/main.tsx` with:

```tsx
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { primeInstallCapture } from "@/lib/pwa";

// Capture beforeinstallprompt as early as possible (before React mounts).
primeInstallCapture();

// Register the service worker on load so the app is installable. This is
// independent of push: useNotifications still registers on demand, and
// register() is idempotent so the two never conflict.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
      console.error("Service worker registration failed:", err);
    });
  });
}

createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @workspace/focusquest typecheck`
Expected: no errors.

- [ ] **Step 4: Verify registration in the running app**

Run the dev server (`pnpm --filter @workspace/focusquest dev`), open the app, and in DevTools → Application → Service Workers confirm `sw.js` is **activated and running** on a fresh load without enabling notifications. Then toggle the notification bell and confirm push subscribe still works (no console errors).

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/public/sw.js artifacts/focusquest/src/main.tsx
git commit -m "feat(web): register service worker on load with no-op fetch handler"
```

---

### Task 6: `usePwaInstall` hook

**Files:**
- Create: `artifacts/focusquest/src/hooks/use-pwa-install.ts`

**Interfaces:**
- Consumes: `detectIsIOS`, `detectIsStandalone`, `runInstallPrompt`, `getDeferredPrompt`, `clearDeferredPrompt`, `subscribeInstall`, `PromptOutcome` from `@/lib/pwa` (Task 4).
- Produces (consumed by Task 7):
  ```ts
  interface PwaInstall {
    canInstall: boolean;
    isStandalone: boolean;
    isIOS: boolean;
    showIosHint: boolean;
    bannerDismissed: boolean;
    promptInstall: () => Promise<PromptOutcome>;
    dismissBanner: () => void;
  }
  function usePwaInstall(): PwaInstall;
  ```

- [ ] **Step 1: Write the hook**

Create `artifacts/focusquest/src/hooks/use-pwa-install.ts`:

```ts
import { useCallback, useEffect, useReducer, useState } from "react";
import {
  detectIsIOS,
  detectIsStandalone,
  runInstallPrompt,
  getDeferredPrompt,
  clearDeferredPrompt,
  subscribeInstall,
  type PromptOutcome,
} from "@/lib/pwa";

const BANNER_DISMISSED_KEY = "fq.pwa.bannerDismissed";

export interface PwaInstall {
  /** A beforeinstallprompt event is available and we're not already installed. */
  canInstall: boolean;
  /** Already running as an installed app. */
  isStandalone: boolean;
  /** iOS/iPadOS, where install is a manual "Add to Home Screen". */
  isIOS: boolean;
  /** iOS + not installed + banner not dismissed → show manual instructions. */
  showIosHint: boolean;
  bannerDismissed: boolean;
  promptInstall: () => Promise<PromptOutcome>;
  dismissBanner: () => void;
}

export function usePwaInstall(): PwaInstall {
  // Re-render whenever the shared install holder changes.
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeInstall(forceRender), []);

  const [bannerDismissed, setBannerDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(BANNER_DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  const isStandalone =
    typeof window !== "undefined" &&
    detectIsStandalone(
      window.matchMedia?.("(display-mode: standalone)").matches ?? false,
      (navigator as Navigator & { standalone?: boolean }).standalone,
    );

  const isIOS =
    typeof navigator !== "undefined" &&
    detectIsIOS(navigator.userAgent, navigator.maxTouchPoints);

  const canInstall = getDeferredPrompt() !== null && !isStandalone;
  const showIosHint = isIOS && !isStandalone && !bannerDismissed;

  const promptInstall = useCallback(async (): Promise<PromptOutcome> => {
    const outcome = await runInstallPrompt(getDeferredPrompt());
    if (outcome !== "unavailable") clearDeferredPrompt();
    return outcome;
  }, []);

  const dismissBanner = useCallback(() => {
    try {
      localStorage.setItem(BANNER_DISMISSED_KEY, "1");
    } catch {
      /* ignore private-mode storage errors */
    }
    setBannerDismissed(true);
  }, []);

  return {
    canInstall,
    isStandalone,
    isIOS,
    showIosHint,
    bannerDismissed,
    promptInstall,
    dismissBanner,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @workspace/focusquest typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add artifacts/focusquest/src/hooks/use-pwa-install.ts
git commit -m "feat(web): usePwaInstall hook"
```

---

### Task 7: Install UI — banner + header/sidebar button

**Files:**
- Create: `artifacts/focusquest/src/components/install-banner.tsx`
- Modify: `artifacts/focusquest/src/components/layout.tsx`

**Interfaces:**
- Consumes: `usePwaInstall` from `@/hooks/use-pwa-install` (Task 6); existing `Button`, `Tooltip*`, `useToast`.

- [ ] **Step 1: Create the InstallBanner component**

Create `artifacts/focusquest/src/components/install-banner.tsx`:

```tsx
import { useState } from "react";
import { Download, X, Share } from "lucide-react";
import { Button } from "./ui/button";
import { usePwaInstall } from "@/hooks/use-pwa-install";

export function InstallBanner() {
  const {
    canInstall,
    showIosHint,
    isIOS,
    isStandalone,
    bannerDismissed,
    promptInstall,
    dismissBanner,
  } = usePwaInstall();
  const [showSteps, setShowSteps] = useState(false);

  if (isStandalone || bannerDismissed) return null;
  if (!canInstall && !showIosHint) return null;

  const handleInstall = async () => {
    if (isIOS) {
      setShowSteps(true);
      return;
    }
    const outcome = await promptInstall();
    if (outcome === "accepted") dismissBanner();
  };

  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-primary/30 bg-card/80 p-3 backdrop-blur-sm">
      <div className="shrink-0 rounded-lg bg-primary/10 p-2 text-primary">
        <Download className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">Install FocusQuest</p>
        <p className="text-xs text-muted-foreground">
          Add it to your home screen for a full-screen, app-like experience.
        </p>
        {showSteps ? (
          <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
            <Share className="h-3.5 w-3.5" /> Tap Share, then “Add to Home Screen”.
          </p>
        ) : (
          <Button size="sm" className="mt-2 h-8" onClick={handleInstall}>
            {isIOS ? "How to install" : "Install"}
          </Button>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground"
        aria-label="Dismiss install banner"
        onClick={dismissBanner}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Add the InstallButton and wire both surfaces into the layout**

In `artifacts/focusquest/src/components/layout.tsx`:

(a) Add `Download` to the lucide import (the line starting `import { Home, ...`), and add these imports near the other component imports:

```tsx
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { InstallBanner } from "./install-banner";
```

(b) Add this component next to `NotificationBell` (e.g. directly below its definition):

```tsx
function InstallButton() {
  const { canInstall, showIosHint, isIOS, isStandalone, promptInstall } = usePwaInstall();
  const { toast } = useToast();

  if (isStandalone || (!canInstall && !showIosHint)) return null;

  const handleClick = async () => {
    if (isIOS) {
      toast({
        title: "Install FocusQuest",
        description: "Tap the Share icon, then “Add to Home Screen.”",
      });
      return;
    }
    await promptInstall();
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClick}
            aria-label="Install app"
            className="text-muted-foreground"
          >
            <Download className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Install app</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
```

(c) In the **mobile header**, place `<InstallButton />` immediately before `<NotificationBell />`:

```tsx
        <div className="flex items-center gap-1">
          <InstallButton />
          <NotificationBell />
```

(d) In the **desktop sidebar** header block, place `<InstallButton />` immediately before the `<NotificationBell />` there:

```tsx
          <InstallButton />
          <NotificationBell />
        </div>
```

(e) Render the banner at the top of the main content container. Change:

```tsx
        <div className="max-w-5xl mx-auto">
          {children}
        </div>
```

to:

```tsx
        <div className="max-w-5xl mx-auto">
          <InstallBanner />
          {children}
        </div>
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @workspace/focusquest typecheck`
Expected: no errors.

- [ ] **Step 4: Verify in the app**

With the dev server running, on desktop Chrome confirm: the banner appears (unless already installed), the header/sidebar Download button appears, clicking **Install** shows the native prompt, and after install both surfaces disappear. Dismiss the banner and confirm it stays gone on reload while the header button remains. (Chrome DevTools → Application → Manifest can force an install prompt.)

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/components/install-banner.tsx artifacts/focusquest/src/components/layout.tsx
git commit -m "feat(web): install banner + header/sidebar install button"
```

---

### Task 8: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full app test suite**

Run: `pnpm --filter @workspace/focusquest test`
Expected: all suites pass, including `manifest.test.ts` and `pwa.test.ts`.

- [ ] **Step 2: Typecheck the workspace**

Run: `pnpm --filter @workspace/focusquest typecheck`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `pnpm --filter @workspace/focusquest build`
Expected: success; `dist/public/` contains `manifest.webmanifest`, `sw.js`, and `icons/`.

- [ ] **Step 4: Installability audit**

Serve the build (`pnpm --filter @workspace/focusquest serve`) and run Lighthouse (or Chrome DevTools → Application → Manifest + "Installability"). Expected: manifest parsed, icons detected, service worker with a fetch handler found, **no installability errors**. Confirm the app can be installed on Chrome/desktop, and on an iOS device confirm the app icon + standalone display via Safari → Share → Add to Home Screen.

---

## Out of scope (v1)

- Offline caching / app-shell / offline fallback page (the `fetch` handler stays a no-op).
- Background sync, app shortcuts, share target, screenshots in the manifest.
- Any change to push notification behavior.
