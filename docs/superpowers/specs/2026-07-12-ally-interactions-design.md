# Ally Interactions & Info Screen — Poke, Cheer, and a Richer Ally Profile

## Overview

Today the Accountability Allies feature is read-only: an ally card shows the
partner's username, level, total XP, and streak, and nothing more. There is no
way for allies to interact, and no way to see who an ally *is* beyond four stats.

This feature makes allies **interactive** and **legible**:

1. **Poke / prod** — send an ally a canned nudge when they haven't finished
   today's quests, to prompt them along.
2. **Cheer / congratulate** — send an ally a canned celebration when they hit a
   milestone (level-up, badge, streak milestone, or an all-quests-done day).
3. **Ally info screen** — an expanded profile for an ally showing their hero
   (pixel avatar), earned badges, today's progress, and a feed of their recent
   milestones/activity.

All interaction is via **canned reactions** (a fixed set of preset messages) —
no free text between users, so there is no moderation or harassment surface.

## Scope

- A single new table, `ally_nudges`, records every poke/cheer (persistence +
  unread counts + rate-limiting all come from it).
- Nudges are delivered two ways: **persisted in-app inbox** (reliable) **and** a
  best-effort **push notification** (reuses existing web-push infra).
- New **ally-scoped** read endpoints for a partner's detail (hero + badges +
  today's progress + recent milestones), gated on an **accepted** partnership.
- **Milestones require no new tracking**: the `activity` table already logs
  `level_up`, `badge_earned`, `streak_milestone`, and `all_day_bonus` rows with
  timestamps. "Recent milestones" is a typed filter over existing activity.
- Frontend: progress + contextual Poke/Cheer on the ally card, an ally detail
  route, and a nudge Inbox tab with unread badges.

### Out of scope (follow-up candidates)

- Free-text messaging / DMs between allies (deliberately excluded).
- Block / report tooling (unnecessary while messages are canned-only).
- A global header notification center (inbox lives on the Partners page for now).
- Nudging non-allies or group nudges.

## Product decisions (settled)

| Decision | Choice |
|---|---|
| Message format | **Canned reactions only** — fixed preset sets, no free text |
| Delivery & persistence | **Persisted inbox + best-effort push** |
| Action gating | **Contextual but always allowed** — UI shows progress/milestones and emphasizes the fitting action; both are always sendable, rate-limited |
| Milestone signals | **Level-up, badge earned, streak milestone, all-quests-done** (all four) |
| Milestone source | **Existing `activity` rows** filtered by type — no new milestone table/hooks |
| Rate limit | **One poke + one cheer per ally per local day** |
| Info screen | **Dedicated route** `/partners/:id` (linkable, matches page-based routing) |
| Inbox placement | **A tab on the Partners page** + unread badges (no global header bell) |
| Authorization | Every ally-scoped read/write requires an **accepted** partnership between the two users |

## Data model

New table `ally_nudges` in `lib/db/src/schema/` (exported from
`lib/db/src/schema/index.ts`):

```ts
export const allyNudgesTable = pgTable("ally_nudges", {
  id:          serial("id").primaryKey(),
  senderId:    integer("sender_id").notNull().references(() => usersTable.id),
  recipientId: integer("recipient_id").notNull().references(() => usersTable.id),
  kind:        text("kind").notNull(),          // 'poke' | 'cheer'
  reaction:    text("reaction").notNull(),      // canned reaction key
  contextType: text("context_type"),            // optional cue: 'behind_today' | 'level_up' | 'badge' | 'streak' | 'all_done'
  readAt:      timestamp("read_at"),            // null = unread
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});
```

Indexes: on `recipient_id` (inbox + unread queries) and on
`(sender_id, recipient_id, kind, created_at)` (rate-limit lookup).

No milestone table is added. Milestones are derived at read-time from
`activity` where `type IN ('level_up','badge_earned','streak_milestone','all_day_bonus')`.

## Canned reactions

A single source-of-truth module (e.g. `artifacts/api-server/src/lib/nudges.ts`,
re-exported to the client or mirrored) defines the allowed reaction keys per
kind. The server validates every incoming `reaction` against the set for its
`kind`; an unknown key is a `400`.

**Poke** (`kind: 'poke'`):

| key | text |
|---|---|
| `get_moving` | Get moving! 💪 |
| `dont_break_streak` | Don't break the streak! 🔥 |
| `still_time` | Still time today! ⏳ |
| `checking_in` | Checking in on you 👀 |

**Cheer** (`kind: 'cheer'`):

| key | text |
|---|---|
| `crushing_it` | You're crushing it! 🎉 |
| `nice_level` | Level up! Nice! ⭐ |
| `streak_respect` | Streak respect 🔥 |
| `proud` | Proud of you! 🙌 |

Each reaction maps to a display label (for inbox/UI) and a push title/body.

## Rate limiting

Pure decision function (unit-tested, mirroring `resolvePartnerRequest`):

- Given the sender's nudge rows to a given recipient of a given `kind` created
  since the start of the sender's local day, allow the send only if there are
  **zero**. Otherwise reject.
- Route translates a rejection into `429` with a friendly reason
  (e.g. "You've already poked this ally today.").
- Limits are **per kind**: a user may send one poke *and* one cheer to the same
  ally on the same day.

Local-day boundaries reuse the existing date-bucket/date helpers already used
elsewhere in the API.

## Backend endpoints

All new endpoints live in `artifacts/api-server/src/routes/accountability.ts`.
Every one first resolves the partnership between `req.gameUserId` and `:id`
(or the nudge's counterpart) and requires it to exist with status `accepted`;
otherwise `403`. Self-targeting is `400`.

### `GET /accountability/partners/:id` — ally detail

Powers the whole info screen in one call. Returns:

- `partner`: the existing `formatUserSummary` shape (id, username, displayName,
  avatarColor, currentLevel, levelName, totalPoints, streakDays).
- `progress`: `{ questsCompletedToday, questsDueToday, allDoneToday }` — counts
  only, never task titles/content (privacy).
- `hero`: the partner's avatar/hero fields, reusing the shape produced by
  `buildAvatarResponse` in `routes/avatar.ts` (refactored so the hero-look
  subset can be built for an arbitrary userId, not just `me`).
- `badges`: the partner's earned badges (same shape as `/users/me/badges`,
  refactored to accept a userId).
- `milestones`: recent `activity` rows filtered to the four milestone types,
  newest first, capped (e.g. 20).

### `POST /accountability/partners/:id/nudge` — send a poke/cheer

Body: `{ kind: 'poke' | 'cheer', reaction: string, contextType?: string }`.
Validates: accepted ally, `kind` valid, `reaction` in the allowed set for
`kind`, and the rate-limit check passes. On success: insert an `ally_nudges`
row, then best-effort `sendPushNotification` to each of the recipient's push
subscriptions (dead subs pruned exactly as `notification-scheduler` does).
Returns the created nudge. Rate-limited → `429`.

### `GET /accountability/nudges` — inbox

Returns the current user's **received** nudges, newest first, each with the
sender's `formatUserSummary` and the resolved reaction label/emoji, plus
`readAt`. Also usable for an unread count (`readAt === null`).

### `POST /accountability/nudges/read` — mark read

Body: `{ ids?: number[] }`. With `ids`, marks those (owned by the caller as
recipient) read; without, marks all the caller's received nudges read. Sets
`readAt = now` where currently null.

### `GET /accountability/partners` (existing) — augmented

Add to each partnership entry, for accepted allies:
`progress: { questsCompletedToday, questsDueToday, allDoneToday }` and
`hasFreshMilestone: boolean` (any milestone activity in the last ~48h). This
lets the ally cards render progress and emphasize the contextually-right action
without an extra request per card.

## Frontend

### Ally card (`artifacts/focusquest/src/pages/partners.tsx`)

- Show **today's progress** (e.g. "3/5 today" and/or a small ring) from the
  augmented list response.
- **Poke** and **Cheer** buttons on the card. The contextually-fitting one is
  emphasized: Poke when the ally is behind (`!allDoneToday && questsDueToday > 0`),
  Cheer when `hasFreshMilestone`. Both are always clickable.
- Clicking a button opens a small **reaction-picker popover** (the canned set for
  that kind); selecting one sends the nudge and shows a toast. If already sent
  today for that kind, the button is disabled with an "Already poked/cheered
  today" hint (also enforced server-side).
- The card is clickable to open the ally detail route.

### Ally info screen — route `/partners/:id`

New page (registered in `App.tsx`), reached by clicking an ally card. Renders
from the `GET /accountability/partners/:id` payload:

- The ally's **`PixelHero`** (reusing the existing component + hero catalog) with
  level/XP/streak.
- **Today's progress** block.
- A **badges grid** of earned badges (icon + name + earned date).
- A **recent milestones / activity** feed.
- **Poke** and **Cheer** actions (same reaction-picker) in the header.

### Inbox (tab on Partners page)

- A new **"Inbox"** tab alongside "My Allies / Requests / Find Allies", showing
  received nudges (sender avatar + name + reaction text + relative time).
- An **unread-count badge** on the Inbox tab and on the **Allies nav item** in
  `layout.tsx`. Opening the Inbox calls the mark-read endpoint.

## Push notifications

Poke/cheer delivery reuses `sendPushNotification` from
`artifacts/api-server/src/lib/push-notifications.ts`. Title/body come from the
reaction definition (e.g. title "Alex poked you 👋", body "Get moving! 💪").
Delivery is best-effort and independent of the in-app record: a missing or
expired subscription is pruned and never blocks the nudge from being stored.
This is decoupled from the cron scheduler (which remains single-user); nudges
send directly to the *recipient's* subscriptions at request time.

## Testing

Following the repo's existing pattern (pure logic unit-tested; routes checked
for auth/validation):

- **Unit** — reaction-key validation (valid/invalid per kind); rate-limit
  decision function (0 rows → allow, ≥1 → reject; poke and cheer independent;
  day-boundary handling); milestone-filtering of activity rows (only the four
  types pass, ordering/cap correct).
- **Route-level** — non-ally → `403`; self → `400`; unknown reaction → `400`;
  second same-kind same-day nudge → `429`; mark-read only affects the caller's
  received nudges; ally detail excludes task titles.

## Build sequence (high level)

1. Schema: `ally_nudges` table + index; export; `drizzle push` to Neon.
2. Pure libs: canned-reaction registry + validation; rate-limit decision;
   milestone-filter helper — each with unit tests.
3. Refactor `buildAvatarResponse` (hero-look subset by userId) and the me-badges
   query into reusable by-userId helpers.
4. Endpoints: ally detail, nudge send (+push), inbox, mark-read; augment the
   partners list response.
5. Regenerate the API client/zod types (existing codegen pipeline).
6. Frontend: augmented ally card (progress + poke/cheer popover), ally detail
   route, Inbox tab + unread badges.
7. Verify end-to-end in the running app.
