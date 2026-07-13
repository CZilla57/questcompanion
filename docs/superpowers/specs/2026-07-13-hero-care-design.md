# Hero Care: Hunger, Fainting & A Life Outside the App

**Date:** 2026-07-13
**Status:** Approved

## Summary

The hero becomes a creature the user cares for. Completing quests feeds the hero;
inactivity makes them hungrier through visible stages until, after 7 days with no
completed quest, they faint. Any completed quest instantly revives them. Separately,
the hero has an ambient "life" — an always-on status line on the hero screen
("Currently: swapping tales at the Gilded Tankard") plus an occasional flavor push
(~3/week) so the hero feels alive between sessions.

## Decisions made during brainstorming

| Decision | Choice |
|---|---|
| Succumbing to hunger | Faint (not permanent death); hero lies collapsed until revived |
| Revival cost | Free and instant — completing any quest fully feeds and revives |
| Hunger model | Purely time since last completed quest; no food-point economy |
| Ambient life delivery | Always-on in-app status line + occasional push (~3/week) |
| Hunger visuals | Vitality bar + mood text + CSS sprite treatment (no LPC pipeline changes) |
| Architecture | Derived state: 3 columns on `users`, no new tables |

## Hunger model

Hunger stage is **computed at read time** from `users.lastFedAt` — never stored,
so there is no state machine to corrupt and revival is automatic.

| Stage | Time since `lastFedAt` | Mood text |
|---|---|---|
| `well_fed` | < 24h | Content and ready for adventure |
| `peckish` | 24–72h | Could use a hot meal |
| `hungry` | 72–120h | Stomach growling loudly |
| `starving` | 120–168h | Too weak to travel |
| `fainted` | ≥ 168h | Has succumbed to hunger… |

Boundaries are half-open: a stage begins exactly at its lower bound
(e.g. exactly 24h → `peckish`, exactly 168h → `fainted`).

### Feeding

- Completing **any** quest (regular, recurring, anchored) stamps
  `lastFedAt = now()` and clears `hungerNotifiedStage`.
- One-way: un-completing a task does **not** roll back `lastFedAt`.
- If the hero was `fainted` when the completion lands, the completion response
  includes `heroRevived: true` for the client celebration.
- Streak freezes do not feed the hero — hunger and streaks are separate systems.

## Schema (3 columns on `users`, no new tables)

```ts
lastFedAt: timestamp("last_fed_at").notNull().defaultNow(),
hungerNotifiedStage: text("hunger_notified_stage"), // nullable
lastFlavorPushAt: timestamp("last_flavor_push_at"), // nullable
```

- `lastFedAt` — default `now()` means existing users start Well Fed at migration
  and new users start fed. No backfill needed.
- `hungerNotifiedStage` — the warning stage cron has already pushed for this
  hunger episode; cleared on feed so the next episode warns again.
- `lastFlavorPushAt` — rate-limits ambient flavor pushes (min 48h apart) and
  dedupes cron retries.

## Server

### Core lib: `artifacts/api-server/src/lib/hero-care.ts`

Pure, unit-testable functions:

- `hungerStage(lastFedAt: Date, now: Date): HungerStage` — boundary math.
- `moodFor(stage): string`
- Feed hook helper used by the task-completion path: stamp + clear + detect
  revival (previous stage `fainted` → `heroRevived`).

### Flavor catalog: `artifacts/api-server/src/lib/hero-flavor.ts`

~30–40 vignettes: `{ id, text, stages: HungerStage[], classes?: string[] }`.

- Class-aware where fun (`users.avatarClass`): mage "transcribing scrolls in the
  archive tower", fighter "sparring with the town guard".
- Ambience follows hunger — well-fed heroes adventure and carouse; peckish heroes
  forage; hungry heroes ration; starving heroes huddle by a dying campfire;
  a fainted hero "lies unconscious at the roadside… only a completed quest can
  revive them".
- `currentVignette(userId, stage, avatarClass, now)` — **deterministic seeded
  pick**: hash of (userId, 3-hour time bucket) indexes into the vignettes
  eligible for the stage/class. Rotates every ~3 hours, identical across
  devices, zero storage.

### API (spec-first in `lib/api-spec/openapi.yaml`, orval regen)

- `GET /users/me/hero-status` →
  `{ stage, mood, lastFedAt, activity: { id, text } }`
- Task-completion response gains optional `heroRevived: boolean`.

### Cron (extends existing `tick()` in `notification-scheduler.ts`)

Runs for **all users** (not the legacy `DEFAULT_USER_ID` pattern), inside the
existing 7am–10pm window:

1. **Hunger warnings** — compute stage per user; if stage ∈
   {`hungry`, `starving`, `fainted`} and ≠ `hungerNotifiedStage`, send one push
   and record the stage. Each stage warns exactly once per hunger episode.
   - hungry: "Your hero's stomach is growling. Complete a quest to feed them!"
   - starving: "Your hero is starving — too weak to travel. One quest is a meal."
   - fainted: "Your hero has succumbed to hunger… Complete any quest to revive
     them."
2. **Flavor pushes (~3/week)** — only when stage is `well_fed` or `peckish`
   (warning pushes and flavor pushes never overlap). Gates: ≥ 48h since
   `lastFlavorPushAt`, daytime window, and a seeded per-day "candidate minute"
   per user so the push lands at an unpredictable-feeling time. Stamp
   `lastFlavorPushAt` on send (also dedupes same-minute retries).

## Frontend (hero summary + avatar page)

- **Vitality bar** — 5 segments matching the stages, warm gold draining to grey,
  with the mood text beneath the hero.
- **Status line** — "Currently: *{vignette text}*" from `GET /users/me/hero-status`.
- **Sprite treatment** — CSS only, on the existing single baked frame (the LPC
  pipeline bakes one south-facing frame per layer; no hurt frames exist and none
  are added):
  - `well_fed` / `peckish`: normal
  - `hungry`: slight desaturation
  - `starving`: heavy grayscale + subtle droop (small rotation/translate)
  - `fainted`: rotated to lie on the ground, grayscaled, small 💫 overlay
- **Revival moment** — completion response `heroRevived: true` fires the existing
  dopamine-overlay celebration ("Your hero rises, renewed!") and invalidates the
  hero-status query key. All task-completion mutations must invalidate the
  hero-status key.

## Edge cases

- New users: `lastFedAt` defaults to `now()` → start Well Fed.
- Existing users at migration: same default → Well Fed; nobody wakes up to a
  fainted hero they didn't earn.
- Un-completing a task never starves the hero retroactively.
- Users with no push subscriptions: cron skips pushes but `hungerNotifiedStage`
  is still recorded (in-app state remains the source of truth).
- Cron gap/downtime: stage is derived, so it's always correct on read; warnings
  catch up on the next tick (stage-diff check, not minute-exact schedule).

## Testing (vitest, existing patterns)

- Stage boundary math at exactly 24h / 72h / 120h / 168h.
- Feed hook: stamps `lastFedAt`, clears `hungerNotifiedStage`, sets
  `heroRevived` only from `fainted`.
- Cron: warn-once-per-stage (no repeat push while stage unchanged; re-warn after
  a feed + new episode); flavor push 48h rate limit; no flavor push when
  hungry/starving/fainted.
- Vignette selection: deterministic (same inputs → same line), rotates across
  3-hour buckets, respects stage/class eligibility.

## Out of scope (possible later)

- Hero diary (persisted `hero_events` log with in-app history view).
- LPC hurt-frame animations / per-stage idle animations.
- Feeding economy (food items, satiety points).
