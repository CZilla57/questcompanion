# Body-Doubling Rooms — work alongside an ally (Act IV, final quest)

**Date:** 2026-07-21 · **Status:** awaiting Chad's approval (merge = approved; decisions D1–D5 below have defaults pre-applied)
**Parent:** Act IV "Play Together" ([[project-feature-roadmap]]). Completing this quest closes Act IV 6/6 and takes the campaign to 35/38.

## 1. Problem

Body doubling is one of the best-evidenced ADHD strategies there is: starting and
sustaining work is dramatically easier when someone else is simply *present* — not
supervising, not collaborating, just there. FocusQuest has the whole social substrate
(allies, pokes/cheers, world boss) and the whole focus substrate (server-validated
pomodoro sessions), but no way for two allies to actually *sit down and work together*.

The quest has been blocked since Act IV with the note: *"needs realtime, outside the
free-tier request/response + cron model — don't plan it without first solving that."*
This spec's first job is solving that.

## 2. The blocker, solved — what "realtime" actually requires here (D1)

Break the feature into its latency needs and the blocker dissolves:

| Need | Actual latency requirement | Mechanism (all existing) |
|---|---|---|
| "An ally opened a room" | seconds, even app-closed | **Web push** — exists, used by pokes today |
| Seeing who's in the room / presence | ~10 s is genuinely fine (ambient, nothing interactive) | **Short-interval polling** via TanStack Query `refetchInterval` |
| A shared countdown that matches on both screens | **zero** ongoing sync — both clients derive remaining time from the same server row | **Server-anchored timestamps** — exactly how the solo timer already works (`reconstructTimerState` from `startedAt`) |
| Waves / "you've got this" | a few seconds | rides the same poll |

So: **polling + web push + server-anchored shared timestamps. No WebSockets, no SSE,
no third-party realtime service, zero new infrastructure.** The server stays stateless
(all state in Neon), which is the standing free-tier design law.

Why not SSE/WebSockets on the always-warm Render dyno? It would work, but it adds a
connection-lifecycle layer (deploy drops, iOS PWA background kills, reconnect logic)
to shave ~9 s off presence updates that nothing interactive depends on. At current
scale (4 users) a 10 s poll while a room is open is ~0.1 req/s worst case — far below
what the 1-minute cron already generates. **Upgrade seam:** all liveness flows through
two client hooks (`room state` poll + `open rooms` poll); if the population ever
justifies it, SSE replaces the hook internals with zero data-model or API-shape change.

## 3. Design principles (anti-shame law, applied)

- **Presence is warmth, never surveillance.** Members see *state* (here / heads-down),
  never each other's tasks, XP-per-hour, or in-room "output". Same privacy stance as
  ally progress (counts only).
- **A locked phone means you're working, not gone.** ADHD body doubling usually looks
  like: open the room, put the phone down, fold the laundry. Heartbeats stop when the
  phone locks — so a stale heartbeat renders as **"heads-down" (a positive, cozy
  state)**, not "away"/"idle". The only way to read as *gone* is to explicitly leave.
- **Leaving is always graceful.** "Thanks for the company" — no leave counters, no
  "X left early", no tombstones in the presence row.
- **An empty room is never called out.** If nobody drops in, the room just quietly
  ends. No "0 allies joined", ever.
- **Company is the reward.** The sprint bonus pays exactly what a solo focus block of
  the same length pays — you're never punished for choosing company, and there's no
  XP pressure to summon allies.

## 4. Concept & scope (D2)

The roadmap sketched three flavors (silent double / countdown / AI companion). v1
unifies the first two and defers the third:

- **A room is just a room** (the "silent double"): an ally opens their door, allies
  can drop in, everyone works on their own things with presence visible. Open-ended.
- **A sprint is an optional shared countdown launched *inside* a room** (the
  "countdown" flavor): any member starts "25 together"; both screens show the same
  server-anchored countdown; finishing together pays a small flat bonus. One live
  sprint per room at a time; a room can run several over its life.
- **AI companion: deferred** — it's a different feature (an LLM presence riding One
  Voice + Gemini quota), and the Living Companion hero beats already give ambient
  non-human company. Noted as a future Act IV+ increment, not designed here.

## 5. Data model (additive migration `0004_body_double`)

```
body_double_rooms
  id            serial PK
  host_id       integer → users (cascade)
  status        text 'open' | 'ended'   (default 'open')
  created_at    timestamp default now
  ended_at      timestamp nullable

body_double_members
  id            serial PK
  room_id       integer → body_double_rooms (cascade)
  user_id       integer → users (cascade)
  joined_at     timestamp default now
  left_at       timestamp nullable      -- the ONLY "gone" signal
  last_seen_at  timestamp default now   -- presence heartbeat (touched by state poll)
  last_wave_at  timestamp nullable      -- transient 👋 surfaced via the poll
  UNIQUE(room_id, user_id)              -- rejoin = clear left_at, not a new row

body_double_sprints
  id            serial PK
  room_id       integer → body_double_rooms (cascade)
  minutes       integer                 -- validated ∈ {15, 25, 50} (the preset focus lengths)
  started_by    integer → users
  started_at    timestamp default now
  completed_at  timestamp nullable      -- doubles as the exactly-once payout claim
  UNIQUE partial index ON (room_id) WHERE completed_at IS NULL   -- one live sprint per room
```

No `users` columns. No `CoinReason` changes. End time is **derived**
(`started_at + minutes`), never stored — house derived-not-stored rule.

## 6. API surface (`lib/api-spec/openapi.yaml`, then codegen)

All routes 401 unauthenticated; ally-scoped access mirrors accountability's
`requireAcceptedPartnership` (extract/reuse it):

- `GET  /body-double/rooms/open` — my open room (if any) + open rooms of my accepted
  allies, each with host summary + member count. Polled ~30 s while the Focus page
  is visible.
- `POST /body-double/rooms` — open a room; 409 (with the room) if I already host an
  open one, mirroring the focus-session start guard. Fires the invite push (§9).
- `GET  /body-double/rooms/:id` — full room state; **touches my `last_seen_at` when
  I'm an active member, so the 10 s poll IS the heartbeat** (one request, both jobs).
  403 unless member or accepted ally of the host.
- `POST /body-double/rooms/:id/join` — accepted-ally-of-host only; rejoin clears
  `left_at`. Joining an ended room → 409 with warm copy.
- `POST /body-double/rooms/:id/leave` — sets `left_at`. **Host leaving ends the room**
  (D4). Idempotent.
- `POST /body-double/rooms/:id/wave` — sets my `last_wave_at`; server ignores waves
  < 15 s apart (soft cap), client cooldown 30 s.
- `POST /body-double/rooms/:id/sprints` `{minutes}` — any member; 409 if a live sprint
  exists (DB partial unique is the real guard — insert-as-guard, house pattern).
- `POST /body-double/rooms/:id/sprints/:sprintId/finish` — any member; validated
  `elapsed ≥ minutes*60 − GRACE_SECONDS` (reuses the focus-session anti-cheat
  grammar); **guarded claim** `UPDATE … SET completed_at = now WHERE id = ? AND
  completed_at IS NULL RETURNING` → exactly-once payout (mirrors the world-boss
  defeat claim). Duplicate/late calls → 200 soft no-op (anti-shame + poll races).

Room-state response: `{ room, host, members: [{ user summary, presence: "here" |
"headsDown", joinedAt, waveAt }], sprint: { id, minutes, startedAt, completedAt } |
null, serverNow }`. User summaries reuse accountability's `formatUserSummary`
(hero look + level). Left members are simply absent from `members`.

## 7. Lifecycle & invariants

- **Presence derivation (pure):** `left_at` set → gone (not listed). Else
  `last_seen_at` within 45 s → `here`; older → `headsDown`. Thresholds are constants
  in the pure lib; poll cadence (10 s) must stay well under the `here` threshold.
- **Sprint payout eligibility = joined and not-left at claim time** — deliberately
  NOT freshness-based, so the phone-in-pocket worker (the ideal body doubler!) still
  gets paid. Payout requires ≥ 2 eligible members; a solo-completed sprint completes
  quietly with no bonus and no sad copy.
- **Exactly-once payout:** the `completed_at IS NULL` guarded update is the claim;
  all XP writes happen in the same transaction (additive only — XP-monotonicity
  standing guard holds). Activity rows use new type `body_double` (web feed mapping
  added; verify the feed's unknown-type fallback anyway).
- **Host-leave ends the room (D4):** members' own focus sessions are untouched; copy:
  "«host» wrapped up — nice working together." Ending is idempotent.
- **Cron sweep (one cheap UPDATE in `tick()`):** end rooms `status='open'` where
  every member's `last_seen_at` is > 90 min stale, or `created_at` > 12 h old.
  90 min ≫ the longest sprint (50 min), so a claimable sprint is essentially never
  swept out from under a heads-down room. No notification passes touched.
- **No envelope interaction:** rooms/sprints never write `pushes_sent_*`/`last_push_at`
  and never produce cron candidates. The envelope's atomic-claim contract is untouched.

## 8. Economy (D5)

- **Sprint together-bonus = `computeIntervalXp(minutes)`** — literally the existing
  focus-block formula (15→8 XP, 25→10, 50→15), paid flat and equally to every
  eligible member. Company pays like a focus block, no more — non-farmable beyond
  normal focus rates, no distortion, no new tuning constant.
- **No coins** in v1 (keeps Honest Coin's earn table stable). No streak effects, no
  daily-bonus interaction.
- Quiet-room co-working earns nothing by itself — members run their own normal focus
  sessions if they want XP-per-minute (that's the point of the room). A member *can*
  run a solo session during a sprint (double-earning the same minutes); accepted at
  current scale, UI just presents the sprint countdown as *the* timer while in a room.

## 9. Invite push (D3)

On room creation: one push to each accepted ally of the host — title
"«host» opened a body-double room", body "Drop in and work alongside", tag
`bodydouble-invite`, url `/focus`. Delivery mirrors pokes (direct best-effort send,
dead-subscription cleanup, no budget charge — user-initiated social, same precedent),
with one One-Voice-spirit courtesy the pokes lack: **skip recipients currently in
deep-night [2,7) or their own quiet hours** (pure check reusing `inQuietHours` +
the envelope's constants — single source). The room still appears in-app either way.
One push per room creation, inherently deduped; no targeted per-ally invites in v1
(broadcast is right-sized for a 4-user server, per Right-Sized Fellowship).

## 10. Client UI (no nav changes)

- **Focus page** gains a **Body Double card** under the timer: allies' open rooms
  ("Chad's door is open · 1 working — Drop in") + "Open a room". Hidden entirely when
  the user has zero accepted allies (no "make friends first" nag).
- **In-room view** (same page, card expands): presence row of mini `PixelHero`
  avatars with here/heads-down states, wave button, "Start a sprint together"
  (15/25/50), the shared countdown (client-derived from `startedAt` + `serverNow`,
  same math as the solo timer), Leave. Room state polls at 10 s while visible
  (TanStack default stops background-tab polling; that's what makes heads-down work).
- **Celebration** on sprint completion: existing toast grammar (`+N XP · Sprint
  together`).
- **Gentle Door:** the card renders only when `unlockedFeatures` includes `allies`
  (L5) — it's an ally-powered surface; grandfathered users unaffected.

## 11. Testing

House pattern — pure cores unit-tested, routes verified by typecheck/build/suites:

- `lib/body-double.ts` (new, pure): presence derivation, sprint finish validation
  (too-early / duplicate / eligibility), payout amount, sweep predicate, invite
  quiet-hours skip. Target ~20 tests.
- Existing suites + root typecheck + web build stay green; openapi codegen clean.
- Live drive after deploy: two-account room open → push received → join → sprint →
  simultaneous countdowns → finish pays both (Chad's walkthrough; Auth0 login is
  off-limits to me).

## 12. Out of scope / follow-ups

AI companion presence · targeted per-ally invites · Now-screen "ally is doubling now"
chip · body-double badge (catalog seed) · in-room streak/coin hooks · SSE transport
swap · scheduled rooms ("doubling at 3pm?").

## 13. Decisions (defaults pre-applied; merge = approved)

| # | Decision | Default |
|---|---|---|
| D1 | Realtime approach | Polling (10 s room / 30 s list) + web push invites + server-anchored shared countdowns; no SSE/WS/3rd-party; hook seam noted for future SSE |
| D2 | Scope | Rooms unify quiet + sprint (sprints launched inside rooms); AI companion deferred |
| D3 | Invites | Broadcast push to all accepted allies on room open; poke-style direct send; deep-night/quiet-hours courtesy skip; no budget charge |
| D4 | Lifecycle | Host-leave ends room; 90-min-stale / 12-h cron sweep; rejoin allowed; one open room per host |
| D5 | Economy | Together-bonus = `computeIntervalXp(minutes)` flat to ≥2 not-left members, exactly-once claim; no coins; no solo-sprint bonus |

## 14. Acceptance

- Two allies can open → get pushed → join → see each other (here/heads-down) → wave →
  run a synchronized sprint → each earn the flat bonus exactly once, all on free-tier
  infra with no new services and the server still stateless.
- A phone-locked member never reads as absent, is still paid, and no copy anywhere
  shames leaving, empty rooms, or unfinished sprints.
- XP writes additive-only; envelope state untouched; migration additive; existing
  suites green.
