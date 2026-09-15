---
name: preflight
description: >-
  Run the pre-PR verification suite for this monorepo — typecheck, the affected
  package's tests, and (when iOS changed) the simulator build — before opening a
  pull request. Use this whenever the user is about to ship: they say "open a
  PR", "is this ready?", "verify my changes", "run the checks", "did I break
  anything?", or asks to commit/push a finished change. Prefer this over running
  tsc / vitest / xcodebuild by hand, because it scopes the checks to what
  actually changed and runs them in the right package with the right commands.
---

# Preflight — pre-PR verification

This is a **pnpm workspace monorepo** with three shippable surfaces plus shared
libs. Game logic is server-side; web and iOS render API-computed state. Before a
PR, verify the surfaces the change actually touched — running everything every
time is slow, and running the wrong package's command silently checks nothing.

## Step 1 — See what changed

```bash
git status --short
git diff --name-only $(git merge-base HEAD main)..HEAD   # committed changes vs main
git diff --name-only                                     # plus uncommitted
```

Map the touched paths to surfaces:

| Path prefix | Surface | Matters because |
|---|---|---|
| `artifacts/api-server/` | API (source of truth) | game rules live here; clients depend on it |
| `artifacts/focusquest/` | Web app | React 19 / Vite |
| `lib/` | Shared packages | can affect **both** server and web — treat as touching both |
| `ios/` | Native Swift app | needs an Xcode build, not tsc/vitest |
| `scripts/`, `lib/db/` | Seed / schema | see the migration note below |

## Step 2 — Typecheck

Typecheck is cheap and cross-cutting — always run the workspace typecheck from
the repo root, which covers libs + all artifacts + scripts:

```bash
pnpm run typecheck
```

## Step 3 — Tests for the touched TS surfaces

Run only the packages that changed (a `lib/` change counts as both):

```bash
pnpm --filter ./artifacts/api-server test    # if api-server or lib/ changed
pnpm --filter ./artifacts/focusquest test    # if focusquest or lib/ changed
```

## Step 4 — iOS build (only if `ios/` changed)

The Swift app can't be checked by tsc/vitest — it needs a simulator build.
Skip this step entirely when no `ios/` files changed.

```bash
cd ios && xcodebuild -project FocusQuest.xcodeproj -scheme FocusQuest \
  -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build
```

If that simulator name isn't installed, list options with
`xcrun simctl list devices available` and pick an available iPhone.

## Step 5 — Report, then let the user decide

Summarize each check as pass/fail with the real output for any failure — never
report "verified" on a step that was skipped or errored. Do **not** open the PR
automatically; hand the result back so the user chooses to proceed. Opening the
PR is a separate, explicit step.

## Watch-outs

- **Drizzle migrations:** if the change adds a migration, confirm `meta/_journal.json`
  and the snapshot are staged alongside the `.sql` — a lone `.sql` desyncs the journal.
- **Don't commit workspace config** (`CLAUDE.md`, `.claude/settings.local.json`) into an
  unrelated feature PR.
- **pnpm only** — `npm`/`yarn` are blocked by a root `preinstall` guard.
