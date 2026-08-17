# iOS Native Reflection Screen — Full Parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow the minimal native `/reflection` route into the real evening-reflection form at parity with the web app (unanswered chip-groups + free-text + Done; answered view + edit).

**Architecture:** Copy two pure web helpers (`reflection-chips.ts`, `api-error.ts`) into the mobile package; add a pure `src/reflection/derivations.ts` (TDD) for the payload/enable/answered logic; add a `Chip` toggle to the existing `ui.tsx` kit; rewrite `app/reflection.tsx` to full parity keeping #4's auth-guard + header and #4b's `useToast`; add a home entry button. No server, no new deps, no shared-lib extraction.

**Tech Stack:** Expo Router 5 / React Native 0.79 / Hermes; `@tanstack/react-query`; generated `@workspace/api-client-react` hooks; Vitest (node env, pure-function tests only).

**Spec:** `docs/superpowers/specs/2026-08-17-ios-reflection-parity-design.md`

## Global Constraints

Copied verbatim from the spec — every task implicitly includes these:

- **NO git worktrees** (OneDrive locks). Branch-guard `git branch --show-current == feat/ios-reflection-parity` before EVERY commit.
- Commit **explicit paths only** (`git add -- <path>`); never `git add -A` or `git add .`; never stage the 13 phantom `lib/api-zod/src/generated/types/` files; verify `git show --stat HEAD` after each commit.
- Vitest is **node env, pure-function tests only** — no RN render-testing library exists and none is added. TDD the pure derivations; verify the RN screen via `pnpm --filter focusquest-mobile typecheck` + the on-device gate.
- **Extensionless local imports** (e.g. `../src/lib/reflection-chips`, not `.ts`).
- Never print or commit the root `.env`.
- **Generated-hook caveat:** `{ query: { enabled } }` on a generated `useGet*` fails typecheck (TS2741). Not needed here — the single read is ungated and reached only post-auth. `useAnswerTodayReflection` takes `{ data: ReflectionAnswerRequest }`.
- **Parity — no XP toast on answer** (web surfaces the inline `ack`, not `xpAwarded`). The toast is used only for the save-error path.

**Commands (run from repo root):**
- Focused test: `pnpm --filter focusquest-mobile exec vitest run <path>`
- Full mobile suite: `pnpm --filter focusquest-mobile test`
- Typecheck: `pnpm --filter focusquest-mobile typecheck`

---

### Task 1: Copy the pure shared libs into mobile

Verbatim copies of two web helpers into `artifacts/focusquest-mobile/src/lib/`. Per the spec's decision 1 (copy, not extract). The copied chip test is the deliverable's gate.

**Files:**
- Create: `artifacts/focusquest-mobile/src/lib/reflection-chips.ts`
- Create: `artifacts/focusquest-mobile/src/lib/api-error.ts`
- Test: `artifacts/focusquest-mobile/src/lib/reflection-chips.test.ts`

**Interfaces:**
- Consumes: `ReflectionHelpedChip`, `ReflectionHinderedChip`, `ReflectionChip` from `@workspace/api-client-react` (already a mobile dependency).
- Produces:
  - `reflection-chips.ts` → `HELPED_CHIPS: ReflectionChip[]`, `HINDERED_CHIPS: ReflectionChip[]`, `CHIP_LABELS: Record<ReflectionChip, string>`.
  - `api-error.ts` → `apiErrorMessage(err: unknown, fallback: string): string`.

- [ ] **Step 1: Create `src/lib/reflection-chips.ts` (verbatim copy)**

```ts
import {
  ReflectionHelpedChip, ReflectionHinderedChip, type ReflectionChip,
} from "@workspace/api-client-react";

export const HELPED_CHIPS = Object.values(ReflectionHelpedChip) as ReflectionChip[];
export const HINDERED_CHIPS = Object.values(ReflectionHinderedChip) as ReflectionChip[];

// Record<ReflectionChip, string> is exhaustive — a new enum key without a
// label is a compile error, keeping client copy in lockstep with the contract.
export const CHIP_LABELS: Record<ReflectionChip, string> = {
  timer: "A timer",
  small_steps: "Small steps",
  body_double: "Someone with me",
  right_time: "Right time of day",
  low_stakes: "Low stakes",
  treat_reward: "A reward waiting",
  low_energy: "Low energy",
  too_many_switches: "Too much switching",
  too_big: "Too big to start",
  distractions: "Distractions",
  time_slipped: "Time slipped away",
  pressure: "Pressure",
};
```

- [ ] **Step 2: Create `src/lib/api-error.ts` (verbatim copy)**

```ts
/**
 * Pull a human-readable message out of an API error, falling back if absent.
 *
 * Prefers the server's `{ error: string }` body (surfaced on the thrown error's
 * `data`), then a native `Error.message`, then the provided fallback.
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: unknown } | null)?.data;
  if (data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string") {
    return (data as { error: string }).error;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
```

- [ ] **Step 3: Create the copied test `src/lib/reflection-chips.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { HELPED_CHIPS, HINDERED_CHIPS, CHIP_LABELS } from "./reflection-chips";

describe("reflection chips", () => {
  it("groups don't overlap and every chip has a label", () => {
    const overlap = HELPED_CHIPS.filter((c) => (HINDERED_CHIPS as string[]).includes(c));
    expect(overlap).toEqual([]);
    for (const c of [...HELPED_CHIPS, ...HINDERED_CHIPS]) {
      expect(CHIP_LABELS[c]).toBeTruthy();
    }
  });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter focusquest-mobile exec vitest run src/lib/reflection-chips.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter focusquest-mobile typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # must print: feat/ios-reflection-parity
git add -- artifacts/focusquest-mobile/src/lib/reflection-chips.ts \
           artifacts/focusquest-mobile/src/lib/api-error.ts \
           artifacts/focusquest-mobile/src/lib/reflection-chips.test.ts
git commit -m "feat(mobile): copy reflection-chips + api-error pure helpers into mobile"
git show --stat HEAD   # verify exactly the 3 files above; no api-zod phantom files
```

---

### Task 2: Reflection derivations (pure, TDD)

The testable logic factored out of the screen (mirrors `src/focus/derivations.ts`). Pure — no React, no RN imports.

**Files:**
- Create: `artifacts/focusquest-mobile/src/reflection/derivations.ts`
- Test: `artifacts/focusquest-mobile/src/reflection/derivations.test.ts`

**Interfaces:**
- Consumes: `Reflection`, `ReflectionAnswerRequest`, `ReflectionChip` types from `@workspace/api-client-react`.
- Produces:
  - `buildReflectionAnswer(chips: ReflectionChip[], freeText: string, tz: string): ReflectionAnswerRequest`
  - `canSubmitReflection(selectedCount: number, freeText: string): boolean`
  - `isAnswered(reflection: Reflection | null, editing: boolean): boolean`

- [ ] **Step 1: Write the failing test `src/reflection/derivations.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import type { Reflection } from "@workspace/api-client-react";
import { buildReflectionAnswer, canSubmitReflection, isAnswered } from "./derivations";

function refl(partial: Partial<Reflection>): Reflection {
  return {
    id: 1, localDate: "2026-08-17", prompt: "How did today go?", promptSource: "fallback",
    chips: [], freeText: null, ack: null, answeredAt: null, createdAt: "2026-08-17T00:00:00.000Z",
    ...partial,
  };
}

describe("buildReflectionAnswer", () => {
  it("passes chips through and includes tz", () => {
    const out = buildReflectionAnswer(["timer", "small_steps"], "", "America/New_York");
    expect(out.chips).toEqual(["timer", "small_steps"]);
    expect(out.tz).toBe("America/New_York");
  });
  it("omits blank/whitespace free-text (undefined)", () => {
    expect(buildReflectionAnswer([], "   ", "UTC").freeText).toBeUndefined();
    expect(buildReflectionAnswer([], "", "UTC").freeText).toBeUndefined();
  });
  it("trims non-blank free-text", () => {
    expect(buildReflectionAnswer([], "  went well  ", "UTC").freeText).toBe("went well");
  });
});

describe("canSubmitReflection", () => {
  it("false with no chips and blank text", () => {
    expect(canSubmitReflection(0, "")).toBe(false);
    expect(canSubmitReflection(0, "   ")).toBe(false);
  });
  it("true with at least one chip", () => {
    expect(canSubmitReflection(1, "")).toBe(true);
  });
  it("true with non-blank text and no chips", () => {
    expect(canSubmitReflection(0, "a note")).toBe(true);
  });
});

describe("isAnswered", () => {
  it("false when reflection is null", () => {
    expect(isAnswered(null, false)).toBe(false);
  });
  it("false when answeredAt is null", () => {
    expect(isAnswered(refl({ answeredAt: null }), false)).toBe(false);
  });
  it("true when answered and not editing", () => {
    expect(isAnswered(refl({ answeredAt: "2026-08-17T21:00:00.000Z" }), false)).toBe(true);
  });
  it("false when answered but editing", () => {
    expect(isAnswered(refl({ answeredAt: "2026-08-17T21:00:00.000Z" }), true)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter focusquest-mobile exec vitest run src/reflection/derivations.test.ts`
Expected: FAIL — cannot resolve `./derivations` (module not found).

- [ ] **Step 3: Write the implementation `src/reflection/derivations.ts`**

```ts
import type { Reflection, ReflectionAnswerRequest, ReflectionChip } from "@workspace/api-client-react";

/** The exact payload the answer mutation receives (blank free-text becomes undefined). */
export function buildReflectionAnswer(
  chips: ReflectionChip[], freeText: string, tz: string,
): ReflectionAnswerRequest {
  return { chips, freeText: freeText.trim() || undefined, tz };
}

/** Whether Done is enabled: at least one chip, or some non-blank free-text. */
export function canSubmitReflection(selectedCount: number, freeText: string): boolean {
  return selectedCount > 0 || freeText.trim().length > 0;
}

/** Whether to show the answered (read-only) view instead of the form. */
export function isAnswered(reflection: Reflection | null, editing: boolean): boolean {
  return reflection?.answeredAt != null && !editing;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter focusquest-mobile exec vitest run src/reflection/derivations.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter focusquest-mobile typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # must print: feat/ios-reflection-parity
git add -- artifacts/focusquest-mobile/src/reflection/derivations.ts \
           artifacts/focusquest-mobile/src/reflection/derivations.test.ts
git commit -m "feat(mobile): pure Reflection derivations (buildReflectionAnswer, canSubmitReflection, isAnswered)"
git show --stat HEAD   # verify exactly the 2 files above
```

---

### Task 3: `Chip` toggle + Reflection screen rewrite (full parity)

Add a `Chip` to the existing UI kit, then rewrite `app/reflection.tsx` to full parity. Verified by typecheck (no RN render tests per the constraints). These change together and share the typecheck gate.

**Files:**
- Modify: `artifacts/focusquest-mobile/src/components/ui.tsx` (add `Chip` + its styles)
- Modify: `artifacts/focusquest-mobile/app/reflection.tsx` (full rewrite)

**Interfaces:**
- Consumes: `HELPED_CHIPS`, `HINDERED_CHIPS`, `CHIP_LABELS` (Task 1); `apiErrorMessage` (Task 1); `buildReflectionAnswer`, `canSubmitReflection`, `isAnswered` (Task 2); `Card`, `PrimaryButton`, `SecondaryButton` (existing `ui.tsx`); `useToast` (existing `src/toast/toast`); `useAuth` (existing `src/auth/auth-context`); generated `useGetTodayReflection`, `getGetTodayReflectionQueryKey`, `useAnswerTodayReflection`, `getGetMyStatsQueryKey`, `Reflection`, `ReflectionChip`.
- Produces: `Chip({ label: string; active: boolean; onPress?: () => void })` — a pressable pill when `onPress` is given, read-only when omitted (answered-view display).

- [ ] **Step 1: Add `Chip` to `src/components/ui.tsx`**

Add this component (after `Dot`, before the `const styles = StyleSheet.create({` block):

```tsx
export function Chip({ label, active, onPress }: { label: string; active: boolean; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityState={onPress ? { selected: active } : undefined}
      style={[styles.chip, active ? styles.chipOn : styles.chipOff]}
    >
      <Text style={active ? styles.chipTextOn : styles.chipTextOff}>{label}</Text>
    </Pressable>
  );
}
```

Add these entries inside the existing `StyleSheet.create({ ... })` in the same file (append to the object, before the closing `})`):

```tsx
  chip: { borderWidth: 1, borderRadius: 9999, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { borderColor: "#6366f1", backgroundColor: "#eef2ff" },
  chipOff: { borderColor: "#d1d5db", backgroundColor: "#ffffff" },
  chipTextOn: { color: "#4338ca", fontSize: 13 },
  chipTextOff: { color: "#111827", fontSize: 13 },
```

(`Pressable`, `Text`, `StyleSheet` are already imported at the top of `ui.tsx`.)

- [ ] **Step 2: Rewrite `app/reflection.tsx` to full parity**

Replace the entire file with:

```tsx
import { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, Redirect } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTodayReflection,
  getGetTodayReflectionQueryKey,
  useAnswerTodayReflection,
  getGetMyStatsQueryKey,
  type Reflection,
  type ReflectionChip,
} from "@workspace/api-client-react";
import { HELPED_CHIPS, HINDERED_CHIPS, CHIP_LABELS } from "../src/lib/reflection-chips";
import { apiErrorMessage } from "../src/lib/api-error";
import { buildReflectionAnswer, canSubmitReflection, isAnswered } from "../src/reflection/derivations";
import { Card, PrimaryButton, SecondaryButton, Chip } from "../src/components/ui";
import { useToast } from "../src/toast/toast";
import { useAuth } from "../src/auth/auth-context";

function ChipGroup({ title, chips, selected, onToggle }: {
  title: string;
  chips: ReflectionChip[];
  selected: Set<ReflectionChip>;
  onToggle: (chip: ReflectionChip) => void;
}) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title}</Text>
      <View style={styles.chips}>
        {chips.map((chip) => (
          <Chip key={chip} label={CHIP_LABELS[chip]} active={selected.has(chip)} onPress={() => onToggle(chip)} />
        ))}
      </View>
    </View>
  );
}

export default function ReflectionRoute() {
  const { status } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Ungated fetch is safe: reached only post-auth (DeepLinkRouter navigates here only when
  // authed; the Redirect below guards any direct mount). draft:true drafts today's prompt,
  // matching the web reflection page.
  const { data, isLoading } = useGetTodayReflection({ tz, draft: true });
  const answer = useAnswerTodayReflection();

  const [selected, setSelected] = useState<Set<ReflectionChip>>(new Set());
  const [freeText, setFreeText] = useState("");
  const [editing, setEditing] = useState(false);

  const reflection: Reflection | null = data?.reflection ?? null;
  const answered = isAnswered(reflection, editing);

  function toggle(chip: ReflectionChip) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(chip)) next.delete(chip);
      else next.add(chip);
      return next;
    });
  }

  function submit() {
    answer.mutate(
      { data: buildReflectionAnswer([...selected], freeText, tz) },
      {
        onSuccess: async () => {
          // The screen fetches with draft=true; the dashboard card fetches without —
          // invalidate each so the evening card hides after answering, plus stats.
          await qc.invalidateQueries({ queryKey: getGetTodayReflectionQueryKey({ tz, draft: true }) });
          await qc.invalidateQueries({ queryKey: getGetTodayReflectionQueryKey({ tz }) });
          await qc.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
          setEditing(false);
        },
        onError: (err) =>
          toast({ title: "Couldn't save", description: apiErrorMessage(err, "Please try again.") }),
      },
    );
  }

  // Auth guard (kept from #4). All hooks above run unconditionally before any return.
  if (status === "loading") return <Centered><Text>Loading…</Text></Centered>;
  if (status !== "authed") return <Redirect href="/" />;

  const header = <Stack.Screen options={{ headerShown: true, title: "Reflection" }} />;

  if (isLoading) {
    return (
      <>
        {header}
        <Centered><Text>Setting up tonight's reflection…</Text></Centered>
      </>
    );
  }

  return (
    <>
      {header}
      <ScrollView contentContainerStyle={styles.container}>
        <Card>
          <Text style={styles.heading}>🌙 Evening reflection</Text>
          {reflection?.prompt ? <Text style={styles.prompt}>{reflection.prompt}</Text> : null}

          {answered ? (
            <View style={styles.answered}>
              {reflection!.chips.length > 0 ? (
                <View style={styles.chips}>
                  {reflection!.chips.map((chip) => (
                    <Chip key={chip} label={CHIP_LABELS[chip as ReflectionChip] ?? chip} active />
                  ))}
                </View>
              ) : null}
              {reflection!.freeText ? <Text style={styles.freeText}>&quot;{reflection!.freeText}&quot;</Text> : null}
              {reflection!.ack ? <Text style={styles.ack}>✨ {reflection!.ack}</Text> : null}
              <SecondaryButton
                title="Edit tonight's answer"
                onPress={() => {
                  setSelected(new Set(reflection!.chips as ReflectionChip[]));
                  setFreeText(reflection!.freeText ?? "");
                  setEditing(true);
                }}
              />
            </View>
          ) : (
            <View style={styles.form}>
              <ChipGroup title="What helped?" chips={HELPED_CHIPS} selected={selected} onToggle={toggle} />
              <ChipGroup title="What got in the way?" chips={HINDERED_CHIPS} selected={selected} onToggle={toggle} />
              <TextInput
                style={styles.input}
                value={freeText}
                onChangeText={setFreeText}
                maxLength={500}
                multiline
                placeholder="Anything else? (optional)"
              />
              <PrimaryButton
                title={answer.isPending ? "Saving…" : "Done"}
                onPress={submit}
                disabled={answer.isPending || !canSubmitReflection(selected.size, freeText)}
              />
            </View>
          )}
        </Card>
      </ScrollView>
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

const styles = StyleSheet.create({
  container: { padding: 24, gap: 16 },
  heading: { fontSize: 18, fontWeight: "600" },
  prompt: { fontSize: 16 },
  group: { gap: 8 },
  groupTitle: { fontSize: 14, fontWeight: "500", color: "#6b7280" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  form: { gap: 16 },
  answered: { gap: 12 },
  input: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, padding: 12, minHeight: 72, textAlignVertical: "top" },
  freeText: { fontStyle: "italic", color: "#6b7280" },
  ack: { color: "#6366f1" },
});
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter focusquest-mobile typecheck`
Expected: no errors. (If TS complains that `useGetTodayReflection` doesn't accept `draft`, re-verify `GetTodayReflectionParams` in `lib/api-client-react/src/generated/api.schemas.ts` — it is `{ tz?: string; draft?: boolean }`.)

- [ ] **Step 4: Run the full mobile suite (no regressions)**

Run: `pnpm --filter focusquest-mobile test`
Expected: PASS — existing files plus Task 1 & Task 2 tests all green.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must print: feat/ios-reflection-parity
git add -- artifacts/focusquest-mobile/src/components/ui.tsx \
           artifacts/focusquest-mobile/app/reflection.tsx
git commit -m "feat(mobile): full-parity native Reflection screen (chip groups, free-text, answered/edit)"
git show --stat HEAD   # verify exactly the 2 files above
```

---

### Task 4: Home entry button → `/reflection`

Add an "Evening reflection" button on the mobile home, mirroring #4b's "Start Focus". Verified by typecheck.

**Files:**
- Modify: `artifacts/focusquest-mobile/app/index.tsx`

**Interfaces:**
- Consumes: `useRouter` from `expo-router` (already imported in `index.tsx`).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the button in the authed branch**

In `app/index.tsx`, in the authed return block, add an "Evening reflection" button immediately after the existing "Start Focus" button:

```tsx
      <Button title="Start Focus" onPress={() => router.push("/focus")} />
      <Button title="Evening reflection" onPress={() => router.push("/reflection")} />
      <Button title="Log out" onPress={() => logout()} />
```

(The `<Button title="Start Focus" ... />` and `<Button title="Log out" ... />` lines already exist; insert the new line between them. `Button` and `router` are already in scope.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter focusquest-mobile typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git branch --show-current   # must print: feat/ios-reflection-parity
git add -- artifacts/focusquest-mobile/app/index.tsx
git commit -m "feat(mobile): add Evening reflection entry from home to /reflection"
git show --stat HEAD   # verify exactly the 1 file above
```

---

### Task 5: G5 on-device runbook section

Append a G5 section to the device-track runbook for Chad's manual on-device gate. Documentation only.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-12-ios-device-track-runbook.md` (append a new section)

**Interfaces:** none.

- [ ] **Step 1: Read the tail of the runbook to match the existing G4 heading style**

Run: open `docs/superpowers/specs/2026-08-12-ios-device-track-runbook.md`, find the last gate section (G4 from #4b), and match its heading level and formatting.

- [ ] **Step 2: Append the G5 section**

Append (adjust the heading level to match the file's existing gate sections):

```markdown
## G5 — Native Reflection screen full parity (#4c)

Requires a dev-client rebuild on the iPhone (new native screen behavior). Record pass/fail per path.

1. **Home → Evening reflection** launches the native Reflection screen.
2. **Loading** shows "Setting up tonight's reflection…", then the prompt appears.
3. **Unanswered**: both chip groups ("What helped?" / "What got in the way?") render with the correct labels; tapping a chip toggles its selected style; **Done** is disabled with nothing selected and no text, and enables once ≥1 chip **or** some non-blank text is present.
4. **Submit**: select a couple of chips (+ optional text) and tap Done → the screen flips to the answered view showing those chips, the italic free-text, and the ✨ ack; the web dashboard's evening card no longer prompts (both cache keys invalidated).
5. **Edit**: "Edit tonight's answer" re-opens the form pre-populated with the prior chips and text; re-submitting updates the answer (same-day re-answer).
6. **Save error** (e.g. airplane mode): Done surfaces a "Couldn't save" toast; the form stays editable.
7. **Deep link still works**: an evening-reflection `/reflection` push tap lands on the (now full) Reflection screen — no regression to #4's routing.
```

- [ ] **Step 3: Commit**

```bash
git branch --show-current   # must print: feat/ios-reflection-parity
git add -- docs/superpowers/specs/2026-08-12-ios-device-track-runbook.md
git commit -m "docs(ios): G5 on-device runbook section for native Reflection parity (#4c)"
git show --stat HEAD   # verify exactly the 1 file above
```

---

## Final verification (after all tasks)

- [ ] Full mobile suite green: `pnpm --filter focusquest-mobile test`
- [ ] Typecheck clean: `pnpm --filter focusquest-mobile typecheck`
- [ ] `git log --oneline origin/main..HEAD` shows the five task commits (plus the spec/plan doc commits); no `lib/api-zod/src/generated/types/` phantom files in any `git show --stat`.
- [ ] Whole-branch review on opus (per the execution model), then `superpowers:finishing-a-development-branch` → PR to `main` summarizing the outstanding G5 manual gate.

## Self-review notes

- **Spec coverage:** copy pure bits (Task 1) ✓; derivations (Task 2) ✓; Chip + full-parity screen incl. draft:true read, chip groups, free-text maxLength 500, Done gating, answered view, ack ✨, edit re-populate, dual+stats invalidation, save-error toast (Task 3) ✓; home entry (Task 4) ✓; G5 runbook (Task 5) ✓. No-XP-toast parity honored in Task 3 `submit`.
- **Types:** `buildReflectionAnswer`/`canSubmitReflection`/`isAnswered` signatures identical in Task 2 definition and Task 3 consumption; `Chip` prop shape identical in Task 3 Step 1 (definition) and Step 2 (usage). `useGetTodayReflection({ tz, draft: true })` matches verified `GetTodayReflectionParams`.
- **No placeholders:** every code step shows complete content.
