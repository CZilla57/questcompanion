# Act VII — The Kingdom Settles (Consolidation Act)

**Date:** 2026-07-19
**Status:** Approved (direction) — sourced from the 2026-07-19 full-app evaluation; each
quest gets its own spec/plan cycle before build.
**Roadmap:** New seventh act, 7 quests. Unlike Acts I–VI, this act adds no new features:
every quest makes the existing 27 shipped features coherent, correct, or reachable.
Campaign totals move from 31 to 38 quests (27 cleared / 11 ahead = 71%).

## Context

Acts I–VI optimized for breadth: ~27 features in under two weeks, each internally solid
(682 tests green at evaluation time — 520 API, 162 web). The 2026-07-19 evaluation found
the marginal value of the next *new* feature is now lower than the value of integrating
what exists. Seven critiques, each becoming one quest:

1. The core ADHD loop is buried: the momentum engine (the app's best "do this now"
   answer) renders only on `/tasks`, quick capture is two taps deep, and the dashboard
   stacks ~9 status blocks above Today's Quests. Twelve nav destinations.
2. Notification code spans three generations with two correctness defects (a user-1-only
   legacy pass; server-clock quiet hours) and no aggregate budget.
3. The economy's grammar drifted: Streak Shield spends `totalPoints` — the same number
   level derives from — contradicting the coins-are-the-spendable-currency law (PR #43),
   and three reward surfaces compete under colliding nav labels.
4. The PWA has zero offline behavior (`sw.js` fetch no-op), so the highest-value ADHD
   moment — capture before the thought evaporates — fails without signal.
5. First-run bets against the audience: an irreversible hero-name decision at minute
   zero, then the full 27-feature surface at once.
6. The social layer is sized for a population that doesn't exist yet ("Global Rankings",
   server-wide boss, for a handful of users).
7. Ops fragility: cron-job.org is a single point of failure that both delivers
   notifications *and* keeps the free Render dyno warm; every tick runs ~5 full
   users-table scans; mental-state data (check-ins, reflections) has no delete/export.

**Act thesis:** the differentiator was never feature count — it's reducing the
executive-function cost of starting. Act VII re-points every surface at that thesis.

**Act rule (binding for all 7 quests):** no new game features — no new mechanics,
currencies, content types, or progression systems. Settings, preferences, and trust
plumbing that make *existing* features usable (Quest 1's notification prefs, Quest 7's
delete/export) don't count as features. Copy, layout, consolidation, correctness,
resilience only. The Anti-Shame Design law applies as everywhere else.

## Non-goals (act-wide)

- Body-Doubling Rooms stays an Act IV quest (blocked on realtime) — Quest 6 right-sizes
  existing social surfaces but does not add new ones.
- No visual redesign / theme change; the neon identity stays.
- No pricing, monetization, or Stripe work (Act VI's Cosmetic Premium is separate).
- No schema rewrites beyond the columns each quest names.

---

## Quest 1 — One Voice (unified notification envelope)

**Problem.** `artifacts/api-server/src/lib/notification-scheduler.ts` contains three
eras: (a) `sendDailySummary` — hardcoded `DEFAULT_USER_ID = 1`, gated on *server* clock
`21:00` exactly, so it fires ~4pm Central for one user and never for anyone else;
(b) `checkHeroCare` — quiet hours via `now.getHours()` (server/UTC), so hunger/flavor
pushes can land at 2–3am local, violating the deep-night silence rule the hyperfocus pass
implements correctly via `localHour`; (c) the modern tz-aware passes (context nudges,
reflection, hyperfocus). Each pass self-limits but nothing caps the aggregate: a
subscribed user can receive 6+ pushes/day across systems, and the bell is all-or-nothing.

**Scope.**
- Delete `sendDailySummary` (context nudges + the reflection prompt already cover its job
  with better manners). Its activity types and copy die with it.
- Migrate `checkHeroCare` to per-user `resolveTimeZone`/`localHour`; adopt one shared
  deep-night floor (local `[2,7)` silent, matching hyperfocus) across every pass.
- New pure module `notification-envelope.ts`: all passes become *candidate producers*
  (kind, priority, title/body/tag/url); one selector applies priority ordering
  (rescue/protection > due-today > reflection prompt > milestone > ambient flavor),
  a per-user daily push budget (a constant, 3, in v1 — not a preference), and min
  spacing (90 min, reusing the context-nudge envelope's grammar); one dispatch point
  calls `notify`. *Amended 2026-07-20 (option b, Chad's call):* the budget governs
  non-critical sends only — critical is never blocked by a spent budget and never
  charges it, so a marathon hyperfocus day cannot silence protection. Spacing and
  the deep-night floor still bound critical.
- Per-category preferences + quiet hours: columns or JSONB on `users`, a small sheet off
  the existing notification bell (`layout.tsx` `NotificationBell`). Categories map to
  producer kinds; rescue/protection defaults on, ambient flavor defaults on but first in
  line to drop when the budget is tight.
- Single shared users fetch per tick, passed into all passes (today each pass re-scans
  the table — 5 full scans/minute).

**Out of scope.** New notification kinds; email (recap system already has its own gate).

**Acceptance.** No push outside the user's local allowed window in tests spanning
timezones; a fixture user maximally eligible for every kind receives ≤ budget non-critical
pushes/day (critical rides above the budget, bounded by spacing + floor — 2026-07-20
amendment) with the highest-priority kinds winning; `sendDailySummary` gone; per-category opt-outs
respected; envelope logic is pure and unit-tested like `context-nudges.ts`.

## Quest 2 — The Now Screen (home inversion + nav merge)

**Problem.** `focusquest/src/pages/dashboard.tsx` front-loads status: check-in prompt,
reflection card, 4 stat cards, focus CTA, XP bar, kingdom strip, heatmap/hero/badges,
decay banner, streak shield — all above Today's Quests (3–4 phone screens). The momentum
suggestion renders only on `tasks.tsx`; `QuickAddBar` (with voice) only on `/tasks` and
questline detail. Nav has 12 destinations (`layout.tsx` `allNavItems`), including
"Rewards" → `/dopamine-menu` and "Store" → `/rewards`.

**Scope.**
- `/` becomes a "Now" surface, top to bottom: momentum suggestion (reuse `MomentumCard` +
  its Start/skip flow), `QuickAddBar` with mic, today's remaining quests, then a single
  compact status row (streak · level · today's XP). Brain-check-in and reflection prompts
  keep their slots but render as one-line chips, not cards.
- Relocate, don't delete: stat cards + XP bar + heatmap + streak shield → `/progress`;
  kingdom strip already lives on `/insights` (dashboard copy removed).
- Nav 12 → 7: Home, Quests (tabs: Today / Questlines / Recurring), Focus, Progress
  (absorbs Insights as tabs), Hero, Allies (absorbs Leaderboard as a tab), Rewards
  (single hub — Quest 3 owns its internals). Mobile bar: Home, Quests, Focus, Progress,
  Hero. Wouter redirects keep every old route working.
- The dashboard's own design comment (never compete with "what do I do right now")
  becomes the page's actual acceptance test.

**Out of scope.** Any change to momentum/steering logic itself; visual redesign.

**Acceptance.** On a 375×812 viewport, the momentum suggestion, quick-add bar, and first
pending quest are all visible without scrolling; capture (text or voice) is one tap from
app open; all legacy routes redirect; nav renders 7 desktop / 5 mobile destinations.

## Quest 3 — Honest Coin (economy grammar repair)

**Problem.** `routes/users.ts` `POST` buy-streak-freeze deducts `FREEZE_COST` from
`totalPoints` (and `weeklyPoints`); level is `getLevelInfo(totalPoints)`, so buying
protection can visibly regress level/progress — an anti-shame violation aimed at exactly
the user reaching for help, and a contradiction of PR #43's XP-vs-coins separation.
Reward surfaces are split across `/dopamine-menu` ("Rewards"), `/rewards` ("Store"),
mystery box, and stat perks.

**Scope.**
- Streak Shield priced in coins via the existing atomic never-negative coin spend
  (`award-coins.ts` grammar); `totalPoints` becomes monotonic — after this quest, no
  code path may decrement it or write a negative-points activity row (regression test
  enforces both). Rows written before the change (e.g. old `streak_freeze_bought` at
  −50) remain untouched history; the purchase's activity copy changes to coins.
- Price tuned in the quest plan against the flat-per-action earn rate (target: ~1–2
  typical days of earning; the point is a real but small tradeoff).
- One Rewards hub at `/rewards` with tabs: Treats (dopamine menu + mystery box), Store
  (real-life redemptions), Perks (stat perks). `/dopamine-menu` redirects. One nav label.

**Out of scope.** Earn-rate rebalancing; new reward types; coin backfill/conversion of
previously spent XP.

**Acceptance.** Level/progress bar can never move backwards from any purchase; shield
purchasable with coins and blocked (with the existing gentle copy pattern) when short;
one nav entry reaches all three reward tabs; old URLs redirect.

## Quest 4 — Never Lose a Thought (offline capture)

**Problem.** `focusquest/public/sw.js` has an intentional no-op fetch handler —
installable PWA, nothing works offline; with `retry: false` in the query client, a flaky
connection shows empty states. For a capture tool the dead-zone moment is core.

**Scope.**
- App-shell precache (build-time manifest of hashed Vite assets; cache-first for static,
  network-only for `/api` except as below) so an offline open renders the shell, not a
  white screen, with a visible offline banner.
- Quick-add outbox: when a create-task request fails on network (or `navigator.onLine`
  is false), persist `{title/parsed fields | audio blob, createdAt, tz}` to IndexedDB,
  show optimistic "Saved — will sync" state, replay on reconnect / next app open
  (app-open replay is the baseline; Background Sync is progressive enhancement).
  Replayed creates are idempotent via a client-generated UUID column checked server-side.
- Voice notes recorded offline are stored as blobs and transcribed on replay.

**Out of scope.** Offline reads of stats/kingdoms/anything else; conflict resolution
(capture is append-only); general request caching.

**Acceptance.** Airplane-mode test: open app → shell renders with offline banner → quick
add three quests (one voice) → reconnect → all three exist server-side exactly once, in
order, with correct dates; suite covers the idempotency key path.

## Quest 5 — The Gentle Door (first-run pacing)

**Problem.** Onboarding is one screen whose copy warns "You can't change it later"
(`App.tsx` `OnboardingScreen`) — an irreversible decision at minute zero for a
perfectionism-prone audience — then drops the user into all 27 features at once.

**Scope.**
- Hero name renameable (rate-limited, e.g. once per 7 days, server-enforced); warning
  copy deleted; leaderboard/ally surfaces read the current name (they already join on
  user id).
- Progressive unlock by level, using the game's own grammar: L1 quests + streak + quick
  add; L2 Focus; L3 Hero; L4 Progress/Insights + Kingdoms; L5 Allies + World Boss;
  L6 Rewards economy (coins earn silently from L1 so the wallet isn't empty at reveal).
  Server derives `unlockedFeatures` from level; client hides locked nav and dashboard
  modules. Each unlock is a celebration moment (existing level-up dialog gains an
  "Unlocked: X" line).
- Anti-shame constraint: locked features are invisible or a quiet "unlocks at level N" —
  never a nag, never a countdown.
- **Grandfathering:** every existing user gets everything unlocked (flag or
  level-derived — all current users already exceed the top gate).

**Out of scope.** New onboarding steps/wizard; tutorial content; changing XP curves.

**Acceptance.** A fresh account sees exactly the L1 surface (nav + dashboard) and each
gate opens at its level with a celebration; existing accounts see no change; rename works
and is rate-limited; no locked-feature nag exists anywhere.

## Quest 6 — Right-Sized Fellowship (social honesty at small scale)

**Problem.** "Global Rankings" (`leaderboard.tsx`) and a server-wide World Boss read as
empty rooms at the current population — worse than absence, they signal "dead game".

**Scope.**
- Leaderboard default tab becomes "You vs. last week" — self-comparison from existing
  weekly data (`weeklyPoints` + recap/week-key infrastructure), with the global list as
  the secondary tab. Copy drops "Global Rankings" for something population-honest.
- World Boss weekly HP scales with the active-contributor count of the prior week
  (formula in quest plan; preserves the existing anti-shame floor and the exactly-once
  payout), so a 3-person week is winnable and a 300-person week isn't trivial.

**Out of scope.** New social features (body-doubling stays Act IV); removing any surface;
matchmaking/discovery.

**Acceptance.** A solo user's leaderboard defaults to a meaningful self-view with no
empty-room framing; boss HP responds to cohort size in unit tests; defeat payout
semantics unchanged.

## Quest 7 — Steady Ground (ops resilience + data trust)

**Problem.** cron-job.org's per-minute tick is both the notification engine and the
thing keeping the free Render dyno warm — one silent lapse stops pushes *and* introduces
30–60s cold starts. No alerting exists for tick gaps. Brain check-ins and reflections are
mental-state data with no user-facing delete or export.

**Scope.**
- Backup scheduler: GitHub Actions cron hitting `POST /api/cron/tick` every 5 minutes
  with `CRON_SECRET` (all passes are already idempotent/deduped, so overlap is safe).
- Dead-man's switch: `tick()` pings a heartbeat URL (healthchecks.io free tier) from an
  env var; no-op when unset; alert fires on gap.
- Account deletion: `DELETE /api/me` — cascading removal of all user rows in one
  transaction, session destroyed; documented Auth0-side cleanup (management API if free
  tier allows, else a documented manual step).
- Data export: `GET /api/me/export` — single JSON of the user's rows (tasks, check-ins,
  reflections, activity, coins, etc.), honest and complete.
- A "Danger zone" entry point (settings sheet off the existing header) — plain copy, no
  dark patterns, confirm phrase for delete.

**Out of scope.** Paid infra, multi-region, backups beyond Neon's own; GDPR paperwork.

**Acceptance.** Killing the primary cron in a test window leaves notifications flowing
via the backup within 5 minutes and trips the heartbeat alert; delete removes every
user-keyed row (test walks the schema) and the account can't log back into data; export
round-trips as valid JSON containing all user-keyed tables.

---

## Sequencing & sizing

Recommended order = numbering: 1 (correctness in the app's voice), 2 (the thesis
surface), 3, 4, 5, 6, 7. Quests 1/3/6/7 are independent; 2 and 3 both touch nav and
should not run in parallel; 5 depends on 2's nav shape. Rough sizes: 2 and 4 are the
large ones (multi-day); 3, 6, 7 are small (day-ish); 1 and 5 medium.

## Testing philosophy

Same as every act: pure-function cores (envelope selector, unlock derivation, boss
scaling, outbox replay) get exhaustive unit tests; orchestrators get integration tests;
anything touching sends/spends asserts exactly-once semantics. TDD via the established
subagent workflow. The act adds two standing regression guards: **XP monotonicity** and
**quiet-hours-in-user-tz** — both must survive all future acts.

## Rollout

1. This spec lands via a docs-only PR; the campaign map artifact and roadmap memory gain
   Act VII (31 → 38 quests, 27 cleared = 71%) in the same session.
2. Each quest: own spec (where the charter above leaves real design open — Quests 1, 2,
   4, 5) or straight to plan (Quests 3, 6, 7), own branch, own PR, per repo convention
   (verify branch before commit — shared working tree).
3. Schema changes (prefs columns, idempotency key, rename limit) ride the shared-Neon
   rules: check for live-but-unmerged schema before any drizzle push.
4. Map refresh after each merge, as always.
