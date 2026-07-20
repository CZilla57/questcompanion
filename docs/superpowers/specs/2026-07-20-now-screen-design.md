# The Now Screen — home inversion + nav merge (Act VII quest 2)

**Date:** 2026-07-20 · **Status:** awaiting Chad's approval · **Parent:** `2026-07-19-act7-consolidation-design.md` (Quest 2)
**Depends on:** nothing. **Depended on by:** Quest 5 (Never Lose a Thought) builds its outbox into this page's quick-add; Quest 3 (Honest Coin) inherits the Rewards nav entry this quest creates.

## 1. Problem

`pages/dashboard.tsx` (607 lines) front-loads status. Render order today: check-in prompt →
reflection card → 4 stat cards → focus CTA banner → XP progress bar → kingdom strip →
heatmap + hero + badges → decay banner → Streak Shield card → *finally* Today's Quests +
Activity Log. On a phone that is 3–4 screens of "how am I doing" before "what do I do."

The two highest-leverage tools render everywhere *except* home: the momentum suggestion
(`MomentumCard` + `momentumBoardState`) only on `/tasks`, and `QuickAddBar` (with voice)
only on `/tasks` and questline detail. Capture — the thing an ADHD user opens the app
mid-thought to do — is two taps and a page load away.

Nav: `layout.tsx` `allNavItems` has 12 destinations (sidebar shows all 12; mobile bar
shows 6). Two of them are reward surfaces with confusable labels ("Rewards" →
`/dopamine-menu`, "Store" → `/rewards`).

## 2. Design principles

- The page answers **"what do I do right now."** Status must never render above action.
  The kingdom strip's own comment ("never compete with what-do-I-do-right-now") becomes
  the whole page's rule.
- **Relocate, don't delete.** Every module that leaves `/` reappears on `/progress`.
  Nothing the user knows disappears from the app.
- **Routes are stable; nav consolidates.** No URL changes in this quest — consolidation
  happens by grouping routes under 7 nav entries with tabs-as-links. Every pre-existing
  URL keeps rendering exactly its page (deep links, PWA start URLs, muscle memory all
  survive). Redirect machinery is deferred to the quest that actually moves a URL
  (Quest 3 retires `/dopamine-menu`).
- **Zero server changes.** This quest is purely `focusquest/`.

## 3. The Now surface (`/`)

`dashboard.tsx` is renamed `now.tsx` (component `NowScreen`); `App.tsx` route unchanged.
Top-to-bottom contract (mobile `space-y-4`, desktop may relax):

1. **Prompt chips row.** `BrainCheckinPrompt` and `EveningReflectionCard` keep their
   slots and show-logic but gain a `variant="chip"` rendering: one line each — icon +
   short label, tapping opens the exact same flow (check-in sheet / link to
   `/reflection`). Both visible ⇒ they share a wrapping flex row, max two lines total.
   Existing hide conditions (answered today, hyperfocus muting, not evening) unchanged.
2. **Today's Focus.** The momentum block currently inlined in `tasks.tsx` (lines
   ~384–461) is extracted into a shared `components/todays-focus.tsx` +
   `hooks/use-momentum-board.ts` wrapping its data deps (`useGetTasks(today)`,
   `useGetTasksMomentum`, `useGetMyPatterns`, `momentumBoardState`, the skip mutation +
   minutes state). The Now screen renders the **suggestion card only** (with the
   power-window line and mode-flavor line — each one line of text); the pinned rail
   stays a `/tasks`-only feature via a `showPinned` prop, since pinned quests already
   appear in the quest list below. `tasks.tsx` re-consumes the extracted component
   unchanged in behavior — momentum/steering logic itself does not move or change.
3. **`QuickAddBar`** with `selectedDate={today}` — text + mic, identical component. No
   autofocus (deliberate — the `fix/quick-add-no-autofocus` change); capture is one tap
   from app open.
4. **Today's quests.** The dashboard's existing list: pending `TaskItem`s, then the
   collapsed 60%-opacity Completed section. Empty state keeps its current gentle copy
   but its CTA becomes redundant (quick-add is directly above) — copy becomes "Nothing
   queued today — capture one above." Edit-quest and level-up dialogs stay (TaskItem
   contract).
5. **Compact status row.** One line replaces the 4 stat cards: `🔥 streak · Lv n ·
   today's XP` in muted small text, the whole row a link to `/progress`. No card
   chrome. (Quests-done count intentionally omitted — the list above *is* that number.)
6. **Welcome-back banner** (decay warning) unchanged, below the status row — it only
   renders after ≥3 days away, and its "Pick a small quest" button retargets `#quick-add`
   → simply scrolls/focuses the quick-add bar on this page instead of linking to /tasks.

Gone from `/` (see §4): stat cards, focus CTA banner, XP bar, kingdom strip, heatmap +
hero + badges, Streak Shield, Activity Log. A new compact skeleton mirrors slots 1–5.

## 4. Relocations → `/progress`

`progress.tsx` (255 lines, currently: level/XP/streak/badges summary + XP history chart)
absorbs, in this order after its existing content: the **XP progress bar**, the
**heatmap + HeroSummary + RecentBadges** composite (moved as-is), the **Streak Shield**
card (with its buy flow + `FREEZE_COST` — Quest 3 will re-price it, not this quest),
and the **Activity Log** (full-width at the bottom). The 4 stat cards are *not* copied —
`/progress` already renders those same numbers as its summary header; duplicating them
would be clutter, and the "relocate" promise is satisfied by the numbers being present.
The kingdom strip's dashboard copy is deleted; `KingdomMap` already lives on `/insights`.

`/progress` and `/insights` remain separate routes/pages joined by a tab header (§5).

## 5. Nav consolidation — 12 → 7 desktop, 5 mobile

New `allNavItems` (sidebar order) and the tab groups each entry owns:

| Nav entry | href | Tab group (tabs-as-links) |
|---|---|---|
| Home | `/` | — |
| Quests | `/tasks` | Today `/tasks` · Questlines `/questlines` · Recurring `/recurring` |
| Focus | `/focus` | — |
| Progress | `/progress` | Progress `/progress` · Insights `/insights` |
| Hero | `/avatar` | — |
| Allies | `/partners` | Allies `/partners` · Leaderboard `/leaderboard` |
| Rewards | `/rewards` | Treats `/dopamine-menu` · Store `/rewards` *(interim — Quest 3 owns the real hub and the redirect)* |

- **Tabs-as-links.** New `components/page-tabs.tsx`: a row of wouter `Link`s styled like
  the existing `ui/tabs` triggers, active by `useLocation()`. Each grouped page renders
  `<PageTabs group="quests" />` above its content. Pages stay separate — no mega-page
  mounts, no data-loading changes, deep links intact. A single `NAV_GROUPS` config in
  `page-tabs.tsx` is the one source of truth; `layout.tsx` derives nav active-state from
  it (nav entry highlights when the location is any route in its group — e.g. Quests is
  active on `/questlines`; `/questlines/:id` and `/partners/:id` match by prefix).
- **Mobile bar (5):** Home, Quests, Focus, Progress, Hero. Allies and Rewards are
  sidebar/hamburger-only on mobile. The ally-unread badge currently on the bar's Allies
  item moves to a dot on the hamburger menu icon (count stays on the sidebar entry).
- Sub-pages keep working with zero nav presence loss: `/reflection` (no nav today,
  unchanged), `/partners/:id`, `/questlines/:id`.

## 6. Anti-shame audit

- Status row states streak as a plain fact — no red, no "don't break it" framing.
- The welcome-back banner and its copy are untouched (already audited, PR #38).
- Completed quests stay collapsed and de-emphasized; no new counters anywhere.
- Momentum empty state stays invitation-shaped ("Nothing queued — add a quest…").
- Relocating the Streak Shield to `/progress` removes a daily loss-aversion pitch from
  the home screen — the shield remains one tap away, but the app stops leading with it.

## 7. Edge cases

- **No tasks today:** chips (if due) → momentum empty state → quick-add → empty-list
  state. Capture stays the visual center; nothing scolds.
- **All done:** the board's existing "Focus cleared for today ✦" + optional extra-win
  suggestion render; quest list shows the collapsed completed section.
- **Frozen / Emergency Mode:** overlay contract (z-40) untouched; check-in chip respects
  the same hyperfocus-muting the card respects today.
- **Loading:** skeleton preserves the fold contract (momentum + quick-add + first-item
  placeholders all above the fold at 375×812).
- **Long chip pileup:** both chips + power-window line + flavor line is the worst case;
  chips are one row (two max), and the momentum card's two annotation lines are part of
  its measured height in the acceptance test.

## 8. Acceptance criteria

1. On 375×812, with the chips row present: momentum suggestion card, quick-add bar, and
   the first pending quest are all fully visible without scrolling.
2. Capture is one tap from app open (tap quick-add → type; or tap mic → speak).
3. Desktop sidebar renders exactly 7 entries; mobile bar exactly 5.
4. Every route listed in §5 renders its same page at its same URL; `/questlines/:id`
   and `/partners/:id` still work; nav active-state follows the group.
5. Every relocated module (§4) renders on `/progress`; nothing is deleted.
6. Ally unread: dot on mobile hamburger when unread > 0; count on sidebar entry.
7. No api-server, api-spec, or db diffs in the PR.

## 9. Test plan

- **Pure/unit (vitest):** `NAV_GROUPS`/nav-config invariants (7 desktop, 5 mobile,
  group hrefs unique and complete, every old nav href still reachable in some group);
  active-group resolution (exact + `:id`-prefix matches); status-row formatting helper.
- **Existing suites:** `momentum-board` lib tests unchanged (logic unmoved); component
  extraction must not require test edits — behavior parity on `/tasks` is the bar.
- **Browser verification (implementation-time):** 375×812 fold screenshot on `/`;
  tab-link navigation across all four groups; mobile bar count; hamburger dot.

## 10. Out of scope

Momentum/steering logic changes; visual redesign (existing card/chip idiom only);
Rewards hub internals and `/dopamine-menu` retirement (Quest 3); offline capture/outbox
(Quest 5); any server or schema change; renaming "dopamine menu" concepts.

## 11. Decision points (Chad — defaults applied unless overridden)

1. **Focus CTA banner is dropped from `/`** (not relocated): Focus has a nav entry on
   both surfaces, and a second full-width banner fights the fold budget. *Default: drop.*
2. **Activity Log moves to `/progress`** rather than staying collapsed on Home.
   *Default: move.*
3. **Allies leaves the mobile bar** (5-slot bar per parent spec) with the hamburger-dot
   mitigation for unread nudges. *Default: as specced.*
4. **Interim Rewards tab group** (Treats `/dopamine-menu` · Store `/rewards`) ships now
   so the single nav entry exists before Quest 3 builds the real hub. *Default: ship it.*

## 12. Implementation shape

- **New:** `components/page-tabs.tsx` (+ `NAV_GROUPS`), `components/todays-focus.tsx`,
  `hooks/use-momentum-board.ts`, `components/status-row.tsx`, nav-config test file.
- **Renamed:** `pages/dashboard.tsx` → `pages/now.tsx`.
- **Modified:** `App.tsx` (import), `components/layout.tsx` (nav arrays, group
  active-state, hamburger dot), `pages/tasks.tsx` (consume extraction, add tabs),
  `pages/{questlines,recurring,progress,insights,partners,leaderboard,dopamine-menu,rewards-store}.tsx`
  (tab headers; progress.tsx also absorbs §4), `components/brain-checkin-prompt.tsx` +
  `components/evening-reflection-card.tsx` (`variant="chip"`).
- **Untouched:** everything under `api-server/`, `lib/` (workspace packages), `db/`.
