# iOS Native Focus Screen (Full Parity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow the minimal native `/focus` route (#4) into an interactive Focus screen at parity with the web app — idle rhythm/quest picker, live active timer, interval crediting, stale-session finalize, and XP/completion feedback.

**Architecture:** Extract the pure pomodoro engine to a shared `@workspace/pomodoro` lib consumed by web + mobile. Put all mobile timer derivations in a pure, unit-tested `derivations.ts`. Keep the RN screen thin (re-sample the clock, fire mutations). Feedback goes through a minimal in-app `ToastProvider`. UI uses RN primitives + a tiny local styled set — no new UI/icon deps.

**Tech Stack:** Expo Router 5, React Native 0.79 (Hermes), React 19.0, @tanstack/react-query 5, orval-generated `@workspace/api-client-react`, Vitest (node env, pure tests only).

## Global Constraints

- **Branch:** all commits on `feat/ios-focus-parity`. Branch-guard `git branch --show-current == feat/ios-focus-parity` before EVERY commit.
- **Staging:** explicit paths only — `git add -- <path>`. NEVER `git add -A` / `git add .`. NEVER stage the 13 phantom files under `lib/api-zod/src/generated/types/`. Run `git show --stat HEAD` after each commit and confirm only intended files.
- **Tests:** Vitest is node-env, PURE functions only. No RN render-testing library exists; do NOT add one. RN screens are verified by `pnpm --filter focusquest-mobile typecheck` + the on-device G4 gate.
- **Generated-hook caveat:** `{ query: { enabled } }` on a generated `useGet*` hook FAILS typecheck (TS2741 — `queryKey` required). Gate fetches by mount, not by `enabled`. Verified mutation arg shapes: `useStartFocusSession({data,params?})`, `useCreditFocusInterval({id,data})`, `useCompleteFocusSession({id,data?})`, `usePauseHyperfocus({data})`.
- **Imports:** extensionless local imports. Never print/commit the root `.env`.
- **Suites stay green:** mobile `pnpm --filter focusquest-mobile test` (baseline 5 files / 26 tests) and web `pnpm --filter @workspace/focusquest test` must both pass at the end of every task that could affect them.
- **No worktrees** (OneDrive locks files).

---

## Task 1: Extract pomodoro engine to `@workspace/pomodoro`

**Files:**
- Create: `lib/pomodoro/package.json`
- Create: `lib/pomodoro/tsconfig.json`
- Create: `lib/pomodoro/src/index.ts`
- Create: `lib/pomodoro/src/pomodoro.test.ts`
- Delete: `artifacts/focusquest/src/lib/pomodoro.ts`
- Delete: `artifacts/focusquest/src/lib/pomodoro.test.ts`
- Modify: `artifacts/focusquest/src/pages/focus.tsx:17` (repoint import)
- Modify: `artifacts/focusquest/package.json` (add dep)
- Modify: `artifacts/focusquest-mobile/package.json` (add dep)

**Interfaces:**
- Produces: `@workspace/pomodoro` exporting `Phase`, `TimerConfig`, `TimerState`, `reconstructTimerState(config, startedAtMs, nowMs): TimerState`, `isStaleGap(config, lastActivityMs, nowMs): boolean` — identical signatures to the current `artifacts/focusquest/src/lib/pomodoro.ts`.

- [ ] **Step 1: Create the package manifest**

Create `lib/pomodoro/package.json`:

```json
{
  "name": "@workspace/pomodoro",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "vitest": "^2.1.9"
  }
}
```

- [ ] **Step 2: Create the package tsconfig**

Create `lib/pomodoro/tsconfig.json` (mirrors `lib/hero-options/tsconfig.json`):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "declarationMap": true,
    "emitDeclarationOnly": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Move the engine source**

Create `lib/pomodoro/src/index.ts` with the EXACT contents of the current `artifacts/focusquest/src/lib/pomodoro.ts` (the `Phase` type, `TimerConfig`, `TimerState`, `reconstructTimerState`, `isStaleGap`). Do not change any logic. Then delete `artifacts/focusquest/src/lib/pomodoro.ts`.

- [ ] **Step 4: Move the test**

Create `lib/pomodoro/src/pomodoro.test.ts` with the EXACT contents of the current `artifacts/focusquest/src/lib/pomodoro.test.ts`, but change line 2's import to:

```ts
import { reconstructTimerState, isStaleGap, type TimerConfig } from "./index";
```

Then delete `artifacts/focusquest/src/lib/pomodoro.test.ts`.

- [ ] **Step 5: Add the dependency to both apps**

In `artifacts/focusquest/package.json`, add to `dependencies` (keep alphabetical near the other `@workspace/*` entries):

```json
"@workspace/pomodoro": "workspace:*",
```

In `artifacts/focusquest-mobile/package.json`, add to `dependencies`:

```json
"@workspace/pomodoro": "workspace:*",
```

- [ ] **Step 6: Repoint the web import**

In `artifacts/focusquest/src/pages/focus.tsx` line 17, change:

```ts
import { reconstructTimerState, isStaleGap, type TimerConfig } from "@/lib/pomodoro";
```

to:

```ts
import { reconstructTimerState, isStaleGap, type TimerConfig } from "@workspace/pomodoro";
```

- [ ] **Step 7: Install to link the workspace package**

Run: `pnpm install`
Expected: completes; `pnpm-lock.yaml` updated; `artifacts/focusquest-mobile/node_modules/@workspace/pomodoro` and `artifacts/focusquest/node_modules/@workspace/pomodoro` symlinks exist.

- [ ] **Step 8: Run the migrated engine tests**

Run: `pnpm --filter @workspace/pomodoro test`
Expected: PASS — 2 describe blocks (`reconstructTimerState`, `isStaleGap`), all assertions green.

- [ ] **Step 9: Verify both apps still typecheck and test**

Run: `pnpm --filter @workspace/focusquest typecheck`
Expected: PASS (web resolves `@workspace/pomodoro` via its exports map — no reference entry needed).

Run: `pnpm --filter @workspace/focusquest test`
Expected: PASS (web suite green; the old pomodoro test no longer runs here — it moved).

Run: `pnpm --filter focusquest-mobile typecheck`
Expected: PASS (baseline unchanged; the new dep resolves).

- [ ] **Step 10: Commit**

```bash
[ "$(git branch --show-current)" = "feat/ios-focus-parity" ] || { echo WRONG-BRANCH; exit 1; }
git add -- lib/pomodoro/package.json lib/pomodoro/tsconfig.json lib/pomodoro/src/index.ts lib/pomodoro/src/pomodoro.test.ts \
  artifacts/focusquest/src/pages/focus.tsx artifacts/focusquest/package.json \
  artifacts/focusquest-mobile/package.json pnpm-lock.yaml
git rm -- artifacts/focusquest/src/lib/pomodoro.ts artifacts/focusquest/src/lib/pomodoro.test.ts
git commit -m "refactor(pomodoro): extract timer engine to @workspace/pomodoro

Pure, already-tested engine moves to a shared workspace lib so web and
the mobile Focus screen (#4b) share one source of truth. Web import
repointed; migrated test runs in the new package.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git show --stat HEAD
```

Expected: staged set is exactly the 8 added/modified paths + 2 deletions. No `lib/api-zod/...` phantoms.

---

## Task 2: Pure timer derivations (`derivations.ts`)

**Files:**
- Create: `artifacts/focusquest-mobile/src/focus/derivations.ts`
- Test: `artifacts/focusquest-mobile/src/focus/derivations.test.ts`

**Interfaces:**
- Consumes: `type TimerState` from `@workspace/pomodoro` (Task 1).
- Produces:
  - `effectiveNow(nowMs: number, pausedAtMs: number | null, pausedAccumMs: number): number`
  - `partialSeconds(state: TimerState, focusMinutes: number): number`
  - `nextCreditIndex(state: TimerState, creditedSoFar: number, plannedCycles: number): number | null`
  - `localDateString(nowMs: number, tz: string): string` (`YYYY-MM-DD`)

- [ ] **Step 1: Write the failing test**

Create `artifacts/focusquest-mobile/src/focus/derivations.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { TimerState } from "@workspace/pomodoro";
import { effectiveNow, partialSeconds, nextCreditIndex, localDateString } from "./derivations";

function st(partial: Partial<TimerState>): TimerState {
  return { phase: "focus", cycleIndex: 1, remainingSeconds: 0, completedIntervals: 0, ...partial };
}

describe("effectiveNow", () => {
  it("returns now when running with no accumulated pause", () => {
    expect(effectiveNow(10_000, null, 0)).toBe(10_000);
  });
  it("freezes at pausedAt while paused", () => {
    expect(effectiveNow(10_000, 4_000, 0)).toBe(4_000);
  });
  it("subtracts accumulated pause while running", () => {
    expect(effectiveNow(10_000, null, 3_000)).toBe(7_000);
  });
  it("freezes at pausedAt minus accumulated pause", () => {
    expect(effectiveNow(10_000, 4_000, 1_000)).toBe(3_000);
  });
});

describe("partialSeconds", () => {
  it("is elapsed focus seconds during a focus phase", () => {
    // 25-min focus, 15 min remaining -> 10 min elapsed = 600s
    expect(partialSeconds(st({ phase: "focus", remainingSeconds: 15 * 60 }), 25)).toBe(600);
  });
  it("is zero during a break", () => {
    expect(partialSeconds(st({ phase: "break", remainingSeconds: 60 }), 25)).toBe(0);
  });
  it("is zero when done", () => {
    expect(partialSeconds(st({ phase: "done", remainingSeconds: 0 }), 25)).toBe(0);
  });
  it("never goes negative", () => {
    // remaining greater than the whole focus block (defensive) clamps to 0
    expect(partialSeconds(st({ phase: "focus", remainingSeconds: 26 * 60 }), 25)).toBe(0);
  });
});

describe("nextCreditIndex", () => {
  it("returns credited+1 when a new boundary has passed", () => {
    expect(nextCreditIndex(st({ completedIntervals: 1 }), 0, 4)).toBe(1);
  });
  it("returns null when no new boundary has passed yet", () => {
    expect(nextCreditIndex(st({ completedIntervals: 0 }), 0, 4)).toBeNull();
  });
  it("returns null when the next index is already credited", () => {
    expect(nextCreditIndex(st({ completedIntervals: 1 }), 1, 4)).toBeNull();
  });
  it("advances one index at a time when several boundaries passed", () => {
    expect(nextCreditIndex(st({ completedIntervals: 3 }), 1, 4)).toBe(2);
  });
  it("returns null past the final planned cycle", () => {
    expect(nextCreditIndex(st({ completedIntervals: 4 }), 4, 4)).toBeNull();
  });
});

describe("localDateString", () => {
  const t = Date.UTC(2026, 7, 14, 3, 30); // 2026-08-14T03:30:00Z
  it("formats the local calendar date in UTC", () => {
    expect(localDateString(t, "UTC")).toBe("2026-08-14");
  });
  it("rolls back across the date line for a western zone", () => {
    // America/New_York is UTC-4 in August -> 2026-08-13 23:30 local
    expect(localDateString(t, "America/New_York")).toBe("2026-08-13");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter focusquest-mobile exec vitest run src/focus/derivations.test.ts`
Expected: FAIL — cannot resolve `./derivations` (module not found).

- [ ] **Step 3: Write the implementation**

Create `artifacts/focusquest-mobile/src/focus/derivations.ts`:

```ts
import type { TimerState } from "@workspace/pomodoro";

/** Pause-adjusted clock: frozen at pausedAtMs while paused, minus accumulated pause. */
export function effectiveNow(nowMs: number, pausedAtMs: number | null, pausedAccumMs: number): number {
  return (pausedAtMs ?? nowMs) - pausedAccumMs;
}

/** Seconds of the current focus block already elapsed (0 outside a focus phase). */
export function partialSeconds(state: TimerState, focusMinutes: number): number {
  const raw = state.phase === "focus" ? focusMinutes * 60 - state.remainingSeconds : 0;
  return Math.max(0, Math.floor(raw));
}

/** The next interval index to credit, or null. Advances one index per call. */
export function nextCreditIndex(
  state: TimerState,
  creditedSoFar: number,
  plannedCycles: number,
): number | null {
  const next = creditedSoFar + 1;
  return state.completedIntervals >= next && next <= plannedCycles ? next : null;
}

/** Local calendar date "YYYY-MM-DD" for the given IANA timezone (replaces date-fns format). */
export function localDateString(nowMs: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(nowMs));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter focusquest-mobile exec vitest run src/focus/derivations.test.ts`
Expected: PASS — all 15 assertions green.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter focusquest-mobile typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
[ "$(git branch --show-current)" = "feat/ios-focus-parity" ] || { echo WRONG-BRANCH; exit 1; }
git add -- artifacts/focusquest-mobile/src/focus/derivations.ts artifacts/focusquest-mobile/src/focus/derivations.test.ts
git commit -m "feat(mobile): pure Focus timer derivations (effectiveNow, partialSeconds, nextCreditIndex, localDateString)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git show --stat HEAD
```

Expected: exactly the two files.

---

## Task 3: Local UI primitive set (`ui.tsx`)

**Files:**
- Create: `artifacts/focusquest-mobile/src/components/ui.tsx`

**Interfaces:**
- Produces (all from `../src/components/ui` relative to `app/`):
  - `Card({ children }: { children: ReactNode })`
  - `PrimaryButton(p: { title: string; onPress: () => void; disabled?: boolean })`
  - `SecondaryButton(p: { title: string; onPress: () => void; disabled?: boolean })`
  - `DestructiveButton(p: { title: string; onPress: () => void; disabled?: boolean })`
  - `Dot({ active }: { active: boolean })`

- [ ] **Step 1: Write the component set**

Create `artifacts/focusquest-mobile/src/components/ui.tsx`:

```tsx
import type { ReactNode } from "react";
import { Pressable, Text, View, StyleSheet, type StyleProp, type ViewStyle, type TextStyle } from "react-native";

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

function BaseButton({
  title,
  onPress,
  disabled,
  style,
  textStyle,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  style: StyleProp<ViewStyle>;
  textStyle: StyleProp<TextStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.btn, style, (disabled || pressed) && styles.btnDim]}
    >
      <Text style={textStyle}>{title}</Text>
    </Pressable>
  );
}

export function PrimaryButton(p: { title: string; onPress: () => void; disabled?: boolean }) {
  return <BaseButton {...p} style={styles.primary} textStyle={styles.primaryText} />;
}

export function SecondaryButton(p: { title: string; onPress: () => void; disabled?: boolean }) {
  return <BaseButton {...p} style={styles.secondary} textStyle={styles.secondaryText} />;
}

export function DestructiveButton(p: { title: string; onPress: () => void; disabled?: boolean }) {
  return <BaseButton {...p} style={styles.destructive} textStyle={styles.destructiveText} />;
}

export function Dot({ active }: { active: boolean }) {
  return <View style={[styles.dot, active ? styles.dotOn : styles.dotOff]} />;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 12, padding: 20, gap: 12, backgroundColor: "#ffffff" },
  btn: { borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10, alignItems: "center", justifyContent: "center", minWidth: 96 },
  btnDim: { opacity: 0.5 },
  primary: { backgroundColor: "#6366f1" },
  primaryText: { color: "#ffffff", fontWeight: "600" },
  secondary: { borderWidth: 1, borderColor: "#d1d5db", backgroundColor: "#ffffff" },
  secondaryText: { color: "#111827", fontWeight: "600" },
  destructive: { backgroundColor: "#dc2626" },
  destructiveText: { color: "#ffffff", fontWeight: "600" },
  dot: { width: 12, height: 12, borderRadius: 6 },
  dotOn: { backgroundColor: "#6366f1" },
  dotOff: { backgroundColor: "#e5e7eb" },
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter focusquest-mobile typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
[ "$(git branch --show-current)" = "feat/ios-focus-parity" ] || { echo WRONG-BRANCH; exit 1; }
git add -- artifacts/focusquest-mobile/src/components/ui.tsx
git commit -m "feat(mobile): tiny local RN UI set (Card, buttons, Dot) for the Focus screen

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git show --stat HEAD
```

Expected: exactly one file.

---

## Task 4: In-app toast + initiation-toast copy, mounted in the layout

**Files:**
- Create: `artifacts/focusquest-mobile/src/toast/toast.tsx`
- Create: `artifacts/focusquest-mobile/src/toast/initiation-toast.ts`
- Test: `artifacts/focusquest-mobile/src/toast/initiation-toast.test.ts`
- Modify: `artifacts/focusquest-mobile/app/_layout.tsx`

**Interfaces:**
- Consumes: `Card` from `../components/ui` (Task 3); `type InitiationXp` from `@workspace/api-client-react`.
- Produces:
  - `ToastProvider({ children }: { children: ReactNode })`
  - `useToast(): { toast(input: { title: string; description?: string }): void }`
  - `initiationToast(xp: InitiationXp | undefined | null): { title: string; description: string } | null`

- [ ] **Step 1: Write the failing test for the pure initiation-toast**

Create `artifacts/focusquest-mobile/src/toast/initiation-toast.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { InitiationXp } from "@workspace/api-client-react";
import { initiationToast } from "./initiation-toast";

describe("initiationToast", () => {
  it("returns null when nothing was awarded", () => {
    expect(initiationToast(null)).toBeNull();
    expect(initiationToast(undefined)).toBeNull();
    expect(initiationToast({ total: 0, awards: [] } as InitiationXp)).toBeNull();
  });

  it("celebrates the total and lists the awards", () => {
    const xp = { total: 15, awards: [{ kind: "session_start", points: 15 }] } as InitiationXp;
    const t = initiationToast(xp);
    expect(t).not.toBeNull();
    expect(t!.title).toContain("+15 XP");
    expect(t!.description).toContain("Started +15");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter focusquest-mobile exec vitest run src/toast/initiation-toast.test.ts`
Expected: FAIL — cannot resolve `./initiation-toast`.

- [ ] **Step 3: Copy the pure initiation-toast helper**

Create `artifacts/focusquest-mobile/src/toast/initiation-toast.ts` with the EXACT contents of `artifacts/focusquest/src/lib/initiation-toast.ts` (unchanged — its only import is `import type { InitiationXp } from "@workspace/api-client-react";`, which mobile already depends on):

```ts
import type { InitiationXp } from "@workspace/api-client-react";

const KIND_LABELS: Record<string, string> = {
  session_start: "Started",
  first_step: "First step",
  questline_kickoff: "Questline kickoff",
  first_move: "First move today",
};

/**
 * Toast content for an initiation award burst, or null when nothing was
 * awarded. Copy celebrates what happened — never what's left (anti-shame law).
 */
export function initiationToast(
  xp: InitiationXp | undefined | null,
): { title: string; description: string } | null {
  if (!xp || xp.total <= 0) return null;
  return {
    title: `You started — that's the hard part. +${xp.total} XP`,
    description: xp.awards.map((a) => `${KIND_LABELS[a.kind] ?? a.kind} +${a.points}`).join(" · "),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter focusquest-mobile exec vitest run src/toast/initiation-toast.test.ts`
Expected: PASS — both cases green.

- [ ] **Step 5: Write the toast provider**

Create `artifacts/focusquest-mobile/src/toast/toast.tsx`:

```tsx
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Text, View, StyleSheet } from "react-native";
import { Card } from "../components/ui";

export interface ToastInput {
  title: string;
  description?: string;
}

interface ToastValue {
  toast(input: ToastInput): void;
}

const ToastContext = createContext<ToastValue | null>(null);
const DURATION_MS = 3500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<ToastInput | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest toast wins: replace the visible banner and reset its dismiss timer.
  const toast = useCallback((input: ToastInput) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setCurrent(input);
    timerRef.current = setTimeout(() => setCurrent(null), DURATION_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {current ? (
        <View style={styles.wrap} pointerEvents="none">
          <Card>
            <Text style={styles.title}>{current.title}</Text>
            {current.description ? <Text style={styles.desc}>{current.description}</Text> : null}
          </Card>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", top: 60, left: 16, right: 16, alignItems: "stretch" },
  title: { fontWeight: "700" },
  desc: { color: "#6b7280", marginTop: 2 },
});
```

- [ ] **Step 6: Mount the provider in the layout**

Modify `artifacts/focusquest-mobile/app/_layout.tsx`. Add the import after the `DeepLinkRouter` import:

```tsx
import { ToastProvider } from "../src/toast/toast";
```

Change the provider tree inside `RootLayout` from:

```tsx
      <AuthProvider>
        <DeepLinkRouter />
        <Stack screenOptions={{ headerShown: false }} />
      </AuthProvider>
```

to:

```tsx
      <AuthProvider>
        <ToastProvider>
          <DeepLinkRouter />
          <Stack screenOptions={{ headerShown: false }} />
        </ToastProvider>
      </AuthProvider>
```

- [ ] **Step 7: Typecheck and run the toast test**

Run: `pnpm --filter focusquest-mobile typecheck`
Expected: PASS.

Run: `pnpm --filter focusquest-mobile exec vitest run src/toast/initiation-toast.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
[ "$(git branch --show-current)" = "feat/ios-focus-parity" ] || { echo WRONG-BRANCH; exit 1; }
git add -- artifacts/focusquest-mobile/src/toast/toast.tsx artifacts/focusquest-mobile/src/toast/initiation-toast.ts \
  artifacts/focusquest-mobile/src/toast/initiation-toast.test.ts artifacts/focusquest-mobile/app/_layout.tsx
git commit -m "feat(mobile): minimal in-app toast provider + initiation-toast copy

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git show --stat HEAD
```

Expected: exactly the four files.

---

## Task 5: Native `ProtectionPause`

**Files:**
- Create: `artifacts/focusquest-mobile/src/components/protection-pause.tsx`

**Interfaces:**
- Consumes: `SecondaryButton` from `./ui` (Task 3); `useGetBrainState`, `usePauseHyperfocus`, `getGetBrainStateQueryKey` from `@workspace/api-client-react`.
- Produces: `ProtectionPause()` — a self-contained control component.

- [ ] **Step 1: Write the component**

Create `artifacts/focusquest-mobile/src/components/protection-pause.tsx`:

```tsx
import { useQueryClient } from "@tanstack/react-query";
import { usePauseHyperfocus, useGetBrainState, getGetBrainStateQueryKey } from "@workspace/api-client-react";
import { SecondaryButton } from "./ui";

const PAUSE_MINUTES = 120;

/**
 * Pause/resume hyperfocus protection nudges. Only mounted inside the active
 * Focus view, so its brain-state fetch is naturally gated (no `enabled` needed —
 * which would trip the generated-hook `queryKey`-required typecheck error).
 */
export function ProtectionPause() {
  const qc = useQueryClient();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { data: state } = useGetBrainState({ tz });
  const pause = usePauseHyperfocus();

  const pausedUntil = state?.hyperfocusPausedUntil ? new Date(state.hyperfocusPausedUntil) : null;
  const isPaused = !!pausedUntil && pausedUntil.getTime() > Date.now();

  const setMinutes = (minutes: number) =>
    pause.mutate(
      { data: { minutes } },
      { onSuccess: () => qc.invalidateQueries({ queryKey: getGetBrainStateQueryKey() }) },
    );

  return (
    <SecondaryButton
      title={isPaused ? "Protection paused · Resume" : "Pause protection"}
      onPress={() => setMinutes(isPaused ? 0 : PAUSE_MINUTES)}
      disabled={pause.isPending}
    />
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter focusquest-mobile typecheck`
Expected: PASS. (Confirms `useGetBrainState({ tz })` params-first shape and `usePauseHyperfocus({ data: { minutes } })` compile.)

- [ ] **Step 3: Commit**

```bash
[ "$(git branch --show-current)" = "feat/ios-focus-parity" ] || { echo WRONG-BRANCH; exit 1; }
git add -- artifacts/focusquest-mobile/src/components/protection-pause.tsx
git commit -m "feat(mobile): native ProtectionPause control for the Focus screen

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git show --stat HEAD
```

Expected: exactly one file.

---

## Task 6: Rewrite `app/focus.tsx` to full parity

**Files:**
- Modify (rewrite): `artifacts/focusquest-mobile/app/focus.tsx`

**Interfaces:**
- Consumes: `reconstructTimerState`, `isStaleGap`, `type TimerConfig` from `@workspace/pomodoro`; `effectiveNow`, `partialSeconds`, `nextCreditIndex`, `localDateString` from `../src/focus/derivations`; `useToast` from `../src/toast/toast`; `initiationToast` from `../src/toast/initiation-toast`; `Card`, `PrimaryButton`, `SecondaryButton`, `DestructiveButton`, `Dot` from `../src/components/ui`; `ProtectionPause` from `../src/components/protection-pause`; `useAuth` from `../src/auth/auth-context`; the generated focus hooks + query-key helpers + `FocusPreset`, `FocusSession` types from `@workspace/api-client-react`.

- [ ] **Step 1: Rewrite the route**

Replace the ENTIRE contents of `artifacts/focusquest-mobile/app/focus.tsx` with:

```tsx
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, Redirect } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFocusPresets,
  useGetActiveFocusSession,
  useStartFocusSession,
  useCreditFocusInterval,
  useCompleteFocusSession,
  useGetTasks,
  getGetActiveFocusSessionQueryKey,
  getGetMyStatsQueryKey,
  getGetCoinsQueryKey,
  type FocusPreset,
  type FocusSession,
} from "@workspace/api-client-react";
import { reconstructTimerState, isStaleGap, type TimerConfig } from "@workspace/pomodoro";
import { effectiveNow, partialSeconds, nextCreditIndex, localDateString } from "../src/focus/derivations";
import { useToast } from "../src/toast/toast";
import { initiationToast } from "../src/toast/initiation-toast";
import { Card, PrimaryButton, SecondaryButton, DestructiveButton, Dot } from "../src/components/ui";
import { ProtectionPause } from "../src/components/protection-pause";
import { useAuth } from "../src/auth/auth-context";

function configOf(s: FocusSession): TimerConfig {
  return {
    focusMinutes: s.focusMinutes,
    breakMinutes: s.breakMinutes,
    longBreakMinutes: s.longBreakMinutes,
    longBreakEvery: s.longBreakEvery,
    plannedCycles: s.plannedCycles,
  };
}

function fmt(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

const PHASE_LABEL: Record<string, string> = { focus: "Focus", break: "Break", longBreak: "Long break", done: "Done" };

export default function FocusRoute() {
  const { status } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Ungated fetches are safe: this route is only reached post-auth (DeepLinkRouter
  // navigates here only when authed; the Redirect below guards any direct mount).
  const presetsQuery = useGetFocusPresets();
  const activeQuery = useGetActiveFocusSession();
  const tasksQuery = useGetTasks({ completed: false, date: localDateString(Date.now(), tz) });

  const startMut = useStartFocusSession();
  const intervalMut = useCreditFocusInterval();
  const completeMut = useCompleteFocusSession();

  const active = activeQuery.data ?? null;

  // Idle-form state.
  const [presetKey, setPresetKey] = useState<FocusPreset["key"]>("classic");
  const [taskId, setTaskId] = useState<number | null>(null);

  // Ticking clock + pause accounting (client-only; a relaunch cancels pause).
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pausedAtMs, setPausedAtMs] = useState<number | null>(null);
  const pausedAccumRef = useRef(0);

  // 1s tick + an immediate re-sample when the app returns to the foreground,
  // so the readout is correct the instant we come back (self-heals from background).
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") setNowMs(Date.now());
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, []);

  const effNow = effectiveNow(nowMs, pausedAtMs, pausedAccumRef.current);

  const state = useMemo(() => {
    if (!active) return null;
    return reconstructTimerState(configOf(active), new Date(active.startedAt).getTime(), effNow);
  }, [active, effNow]);

  // Track the highest interval index we've asked the server to credit.
  const creditedRef = useRef(0);
  useEffect(() => {
    creditedRef.current = active?.completedIntervals ?? 0;
  }, [active?.id, active?.completedIntervals]);

  // On load: finalize a stale (abandoned) session instead of back-crediting it.
  const staleHandledRef = useRef<number | null>(null);
  useEffect(() => {
    if (!active) return;
    if (staleHandledRef.current === active.id) return;
    const last = new Date(active.lastIntervalAt ?? active.startedAt).getTime();
    if (isStaleGap(configOf(active), last, Date.now())) {
      staleHandledRef.current = active.id;
      completeMut.mutate(
        { id: active.id, data: { partialSeconds: 0 } },
        { onSettled: () => qc.invalidateQueries({ queryKey: getGetActiveFocusSessionQueryKey() }) },
      );
    }
  }, [active, completeMut, qc]);

  // Credit focus intervals as their boundaries pass (pause-safe: effNow only
  // advances while running, so completedIntervals only grows while running).
  useEffect(() => {
    if (!active || !state) return;
    if (active.status !== "active") return;
    if (staleHandledRef.current === active.id) return;
    if (intervalMut.isPending) return;
    const next = nextCreditIndex(state, creditedRef.current, active.plannedCycles);
    if (next === null) return;
    creditedRef.current = next;
    intervalMut.mutate(
      { id: active.id, data: { intervalIndex: next } },
      {
        onSuccess: (res) => {
          if (res.xpDelta > 0) toast({ title: `+${res.xpDelta} XP`, description: "Focus block banked" });
          qc.invalidateQueries({ queryKey: getGetActiveFocusSessionQueryKey() });
          qc.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
          if (res.session.status === "completed") {
            qc.invalidateQueries({ queryKey: getGetCoinsQueryKey() });
            toast({ title: "Session complete!", description: `Focused ${Math.round(res.session.focusedSeconds / 60)} min` });
          }
        },
        onError: () => {
          creditedRef.current = next - 1; // allow retry on the next tick
          qc.invalidateQueries({ queryKey: getGetActiveFocusSessionQueryKey() });
        },
      },
    );
  }, [active, state, intervalMut, qc, toast]);

  function handleStart() {
    startMut.mutate(
      { data: { preset: presetKey, taskId: taskId ?? undefined }, params: { tz } },
      {
        onSuccess: (res) => {
          pausedAccumRef.current = 0;
          setPausedAtMs(null);
          const t = initiationToast(res.initiationXp);
          if (t) toast(t);
          qc.invalidateQueries({ queryKey: getGetActiveFocusSessionQueryKey() });
          qc.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
        },
        onError: () => {
          // A 409 means a session is already active — just refetch and resume it.
          qc.invalidateQueries({ queryKey: getGetActiveFocusSessionQueryKey() });
        },
      },
    );
  }

  function togglePause() {
    if (pausedAtMs == null) {
      setPausedAtMs(Date.now());
    } else {
      pausedAccumRef.current += Date.now() - pausedAtMs;
      setPausedAtMs(null);
    }
  }

  function handleStop() {
    if (!active || !state) return;
    completeMut.mutate(
      { id: active.id, data: { partialSeconds: partialSeconds(state, active.focusMinutes) } },
      {
        onSettled: () => {
          qc.invalidateQueries({ queryKey: getGetActiveFocusSessionQueryKey() });
          qc.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
        },
        onSuccess: (res) => {
          toast({ title: "Session ended", description: res.xpDelta > 0 ? `+${res.xpDelta} XP` : undefined });
        },
      },
    );
  }

  // Auth guard (kept from #4). All hooks above run unconditionally before any return.
  if (status === "loading") {
    return (
      <Centered>
        <Text>Loading…</Text>
      </Centered>
    );
  }
  if (status !== "authed") return <Redirect href="/" />;

  const header = <Stack.Screen options={{ headerShown: true, title: "Focus Session" }} />;

  if (activeQuery.isLoading) {
    return (
      <>
        {header}
        <Centered>
          <Text>Loading…</Text>
        </Centered>
      </>
    );
  }

  // ── Active session view ────────────────────────────────────────────────────
  if (active && state && active.status === "active") {
    const paused = pausedAtMs != null;
    return (
      <>
        {header}
        <ScrollView contentContainerStyle={styles.container}>
          <Card>
            <Text style={styles.phase}>{PHASE_LABEL[state.phase]}</Text>
            <Text style={styles.clock}>{fmt(state.remainingSeconds)}</Text>
            <View style={styles.dots} accessibilityLabel="Cycle progress">
              {Array.from({ length: active.plannedCycles }).map((_, i) => (
                <Dot key={i} active={i < state.completedIntervals} />
              ))}
            </View>
            {paused ? <Text style={styles.pausedHint}>Paused</Text> : null}
            <View style={styles.row}>
              <SecondaryButton title={paused ? "Resume" : "Pause"} onPress={togglePause} />
              <DestructiveButton title="Stop" onPress={handleStop} disabled={completeMut.isPending} />
            </View>
            <ProtectionPause />
          </Card>
        </ScrollView>
      </>
    );
  }

  // ── Idle view ──────────────────────────────────────────────────────────────
  const presets: FocusPreset[] = presetsQuery.data ?? [];
  const openTasks = tasksQuery.data ?? [];
  return (
    <>
      {header}
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.sectionLabel}>Choose a rhythm</Text>
        {presets.map((p) => (
          <Pressable
            key={p.key}
            onPress={() => setPresetKey(p.key)}
            style={[styles.selectable, presetKey === p.key && styles.selectableActive]}
          >
            <Text style={styles.presetLabel}>{p.label}</Text>
            <Text style={styles.presetMeta}>
              {p.plannedCycles} × {p.focusMinutes} min focus · {p.breakMinutes} min breaks
            </Text>
          </Pressable>
        ))}

        <Text style={styles.sectionLabel}>Focus on a quest (optional)</Text>
        <Pressable
          onPress={() => setTaskId(null)}
          style={[styles.selectable, taskId === null && styles.selectableActive]}
        >
          <Text>Just focus (no quest)</Text>
        </Pressable>
        {openTasks.map((t) => (
          <Pressable
            key={t.id}
            onPress={() => setTaskId(t.id)}
            style={[styles.selectable, taskId === t.id && styles.selectableActive]}
          >
            <Text>{t.title}</Text>
          </Pressable>
        ))}

        <PrimaryButton
          title={startMut.isPending ? "Starting…" : "Start Focus"}
          onPress={handleStart}
          disabled={startMut.isPending || presets.length === 0}
        />
      </ScrollView>
    </>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <View style={{ flex: 1, gap: 12, alignItems: "center", justifyContent: "center", padding: 24 }}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 16 },
  phase: { fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: "#6b7280", textAlign: "center" },
  clock: { fontSize: 64, fontWeight: "700", fontVariant: ["tabular-nums"], textAlign: "center" },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6 },
  pausedHint: { fontSize: 12, color: "#6b7280", textAlign: "center" },
  row: { flexDirection: "row", justifyContent: "center", gap: 12, paddingTop: 8 },
  sectionLabel: { fontSize: 14, fontWeight: "600" },
  selectable: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, paddingHorizontal: 16, paddingVertical: 12 },
  selectableActive: { borderColor: "#6366f1" },
  presetLabel: { fontWeight: "600" },
  presetMeta: { fontSize: 12, color: "#6b7280", marginTop: 2 },
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter focusquest-mobile typecheck`
Expected: PASS. If TS2741 (`queryKey` required) appears, a fetch is being gated with `{ query: { enabled } }` — none should be here; remove it.

- [ ] **Step 3: Run the full mobile suite**

Run: `pnpm --filter focusquest-mobile test`
Expected: PASS — baseline files + `derivations.test.ts` + `initiation-toast.test.ts` all green.

- [ ] **Step 4: Commit**

```bash
[ "$(git branch --show-current)" = "feat/ios-focus-parity" ] || { echo WRONG-BRANCH; exit 1; }
git add -- artifacts/focusquest-mobile/app/focus.tsx
git commit -m "feat(mobile): full-parity native Focus screen (idle picker + live active timer)

Idle rhythm/quest picker starts a session; active view ticks a 1s clock
derived from wall-clock (AppState re-sample on foreground), credits
intervals at each boundary, finalizes stale sessions, and surfaces
XP/initiation/completion toasts. ProtectionPause included.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git show --stat HEAD
```

Expected: exactly one file.

---

## Task 7: Home entry — "Start Focus" button

**Files:**
- Modify: `artifacts/focusquest-mobile/app/index.tsx`

**Interfaces:**
- Consumes: `useRouter` from `expo-router`.

- [ ] **Step 1: Add router + button**

Modify `artifacts/focusquest-mobile/app/index.tsx`.

Change the top imports from:

```tsx
import { View, Text, Button } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "../src/auth/auth-context";
```

to:

```tsx
import { View, Text, Button } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "../src/auth/auth-context";
```

Add the router hook at the top of `Index` (right after `const { status, login, logout } = useAuth();`):

```tsx
  const router = useRouter();
```

Change the authed return block from:

```tsx
  return (
    <Centered>
      <Text>Authenticated ✓</Text>
      <Text>me: {me.isLoading ? "…" : JSON.stringify(me.data ?? me.error)}</Text>
      <Button title="Log out" onPress={() => logout()} />
    </Centered>
  );
```

to:

```tsx
  return (
    <Centered>
      <Text>Authenticated ✓</Text>
      <Text>me: {me.isLoading ? "…" : JSON.stringify(me.data ?? me.error)}</Text>
      <Button title="Start Focus" onPress={() => router.push("/focus")} />
      <Button title="Log out" onPress={() => logout()} />
    </Centered>
  );
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter focusquest-mobile typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
[ "$(git branch --show-current)" = "feat/ios-focus-parity" ] || { echo WRONG-BRANCH; exit 1; }
git add -- artifacts/focusquest-mobile/app/index.tsx
git commit -m "feat(mobile): add Start Focus entry from home to /focus

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git show --stat HEAD
```

Expected: exactly one file.

---

## Task 8: G4 device runbook section + SDD progress log

**Files:**
- Modify: `docs/superpowers/specs/2026-08-12-ios-device-track-runbook.md` (append `## 9.`)
- Modify: `.superpowers/sdd/progress.md` (append a new #4b section)

**Interfaces:** none (docs).

- [ ] **Step 1: Append the G4 runbook section**

Append to `docs/superpowers/specs/2026-08-12-ios-device-track-runbook.md`:

```markdown

---

## 9. G4 native Focus screen verification (device-track #4b)

Prereq: JS-only change — restart Metro (`pnpm --filter focusquest-mobile start`)
and reload the existing dev-client. No native rebuild needed (no new native modules;
`AppState` and `expo-router` are already present).

1. **Home → Start Focus** — from the authed home screen, tap **Start Focus**. Expect the
   native "Focus Session" screen (idle view): a "Choose a rhythm" list and a
   "Focus on a quest (optional)" list.
2. **Start a session** — pick a rhythm (optionally a quest), tap **Start Focus**. Expect the
   active view (phase label + `MM:SS` clock + cycle dots), and a "You started — that's the
   hard part. +N XP" toast.
3. **Live tick** — the clock decrements every second; the phase label and filled-dot count
   match the elapsed time.
4. **Background self-heal** — background the app for ~1 min, reopen. Expect the clock to jump
   to the correct current remaining time immediately (not resume from where it left off).
5. **Pause/Resume** — tap **Pause**: the readout freezes and "Paused" shows. Tap **Resume**:
   it continues from the frozen time (paused span not counted).
6. **Interval boundary** — let a focus block fully elapse. Expect a "+N XP" toast and one more
   filled dot. Completing the last block fires "Session complete!".
7. **Stop** — mid-focus, tap **Stop**. Expect "Session ended"; returning to the screen shows
   the idle view (no active session).
8. **Stale finalize** — start a session, hard-quit the app, wait past one focus+long-break
   span (classic = 40 min), reopen `/focus`. Expect the abandoned session finalized (idle
   view), NOT back-credited to the current time.
9. **ProtectionPause** — in the active view tap **Pause protection**; it flips to
   "Protection paused · Resume" and the state persists across a refetch.
10. **Deep-link regression** — trigger a body-double `/focus` push and tap it. Expect it lands
    on the full Focus screen (no regression to #4's routing).

Record pass/fail per path. Any wrong readout after backgrounding, a mis-credited stale
session, or a missing toast is a failure.
```

- [ ] **Step 2: Append the SDD progress section**

Append a new section to `.superpowers/sdd/progress.md` (do NOT overwrite the #4 section). If the file does not exist, create it with just this section:

```markdown

---

## device-track #4b — native Focus screen (full parity)

Spec: `docs/superpowers/specs/2026-08-14-ios-focus-parity-design.md`
Plan: `docs/superpowers/plans/2026-08-14-ios-focus-parity.md`
Branch: `feat/ios-focus-parity`

- [ ] Task 1 — extract `@workspace/pomodoro`
- [ ] Task 2 — pure `derivations.ts`
- [ ] Task 3 — local `ui.tsx`
- [ ] Task 4 — toast provider + initiation-toast
- [ ] Task 5 — native ProtectionPause
- [ ] Task 6 — full-parity `app/focus.tsx`
- [ ] Task 7 — home Start-Focus entry
- [ ] Task 8 — G4 runbook + this log

Gate: G4 on-device (Chad) — see runbook `## 9.`
```

(As tasks complete during the SDD run, check them off here.)

- [ ] **Step 3: Commit**

```bash
[ "$(git branch --show-current)" = "feat/ios-focus-parity" ] || { echo WRONG-BRANCH; exit 1; }
git add -- docs/superpowers/specs/2026-08-12-ios-device-track-runbook.md .superpowers/sdd/progress.md
git commit -m "docs(ios): G4 on-device runbook section + #4b SDD progress log

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git show --stat HEAD
```

Expected: exactly the two files.

---

## Final verification (after all tasks)

- [ ] `pnpm --filter @workspace/pomodoro test` — green.
- [ ] `pnpm --filter focusquest-mobile test` — green (baseline + derivations + initiation-toast).
- [ ] `pnpm --filter focusquest-mobile typecheck` — green.
- [ ] `pnpm --filter @workspace/focusquest typecheck` && `pnpm --filter @workspace/focusquest test` — green (extraction didn't regress web).
- [ ] `git log --oneline main..feat/ios-focus-parity` — spec, spec-fix, and Tasks 1–8 commits present; no `lib/api-zod/.../types/` phantom files in any `git show --stat`.
- [ ] Whole-branch review on opus (per subagent-driven-development), then `superpowers:finishing-a-development-branch` → PR to `main` summarizing the outstanding G4 gate.

## Deferred (explicit non-goals — do NOT implement here)

- `BodyDoubleCard` / body-double rooms on the native Focus screen (→ later spec).
- Any server change. Pause persistence across relaunch. New UI/icon deps. Native Reflection parity (→ #4c).
```
